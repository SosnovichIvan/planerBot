import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.access import AccessDenied, AccessUnavailable, ChatAccess
from planerbot.event_contracts import Conflict, EventView, InvalidEvent, MissingEvent
from planerbot.event_repository import EventRepository
from planerbot.models import Event, Publication


class DeliveryRejected(Exception):
    pass


class DeliveryUnknown(Exception):
    pass


class PublicationGateway(Protocol):
    async def send_card(self, event: EventView, message_id: int | None) -> int | None: ...


@dataclass(frozen=True)
class DeliveryJob:
    event: EventView
    editor_id: int
    lease: UUID
    message_id: int | None


class PublicationRepository:
    def __init__(self, engine: AsyncEngine):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def claim(self) -> DeliveryJob | None:
        now = datetime.now(UTC)
        async with self.sessions.begin() as session:
            await session.execute(
                update(Publication)
                .where(
                    Publication.status == "sending",
                    Publication.claimed_at < now - timedelta(seconds=60),
                )
                .values(status="unknown")
            )
            publication = await session.scalar(
                select(Publication)
                .where(Publication.status == "pending")
                .order_by(Publication.event_id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if publication is None:
                return None
            event = await session.get(Event, publication.event_id)
            assert event is not None  # Guaranteed by the foreign key.
            lease = uuid4()
            publication.status, publication.lease, publication.claimed_at = "sending", lease, now
            view = await EventRepository.read(session, event.chat_id, event.id)
            message_id = publication.message_id
            if event.source == "message":
                message_id = event.source_message_id
            return DeliveryJob(view, event.editor_id, lease, message_id)

    async def finish(self, job: DeliveryJob, state: str, message_id: int | None = None) -> None:
        async with self.sessions.begin() as session:
            publication = await session.scalar(
                select(Publication)
                .where(
                    Publication.event_id == job.event.id,
                    Publication.lease == job.lease,
                    Publication.status == "sending",
                )
                .with_for_update()
            )
            if publication is None:
                return
            publication.status = (
                "pending"
                if state == "published" and publication.desired_version > job.event.version
                else state
            )
            if message_id is not None:
                publication.message_id = message_id

    async def retry(self, chat_id: int, event_id: UUID, acknowledge: bool) -> None:
        async with self.sessions.begin() as session:
            publication = await session.scalar(
                select(Publication)
                .join(Event)
                .where(Event.chat_id == chat_id, Event.id == event_id)
                .with_for_update(of=Publication)
            )
            if publication is None:
                raise MissingEvent
            event = await session.get(Event, event_id)
            assert event is not None
            if (
                event.status == "cancelled"
                and publication.status == "unknown"
                and publication.message_id is None
                and event.source != "message"
            ):
                raise Conflict(
                    "ID отправленного сообщения неизвестен. Проверьте чат вручную: "
                    "автоматическое удаление невозможно."
                )
            if publication.status == "unknown" and not acknowledge:
                raise Conflict("Отправка могла состояться. Подтвердите риск дубликата.")
            if publication.status not in {"unknown", "failed"}:
                raise Conflict("Публикация уже отправлена или ожидает обработки")
            publication.status = "pending"


class Delivery:
    def __init__(
        self, store: PublicationRepository, access: ChatAccess, gateway: PublicationGateway
    ):
        self.store, self.access, self.gateway = store, access, gateway

    async def once(self) -> bool:
        job = await self.store.claim()
        if job is None:
            return False
        try:
            target = await self.access.authorize(job.editor_id, int(job.event.chat_id), manage=True)
            if job.event.status != "cancelled" and not any(
                t.thread_id == job.event.data.topic_id and t.enabled for t in target.chat.topics
            ):
                raise InvalidEvent("Тема выключена")
        except (AccessDenied, AccessUnavailable, InvalidEvent):
            await self.store.finish(job, "failed")
            return True
        try:
            message_id = await self.gateway.send_card(job.event, job.message_id)
        except DeliveryRejected:
            await self.store.finish(job, "failed")
        except DeliveryUnknown:
            await self.store.finish(job, "unknown")
        else:
            await self.store.finish(job, "published", message_id)
        return True

    async def run(self) -> None:
        while True:
            if not await self.once():
                await asyncio.sleep(1)
