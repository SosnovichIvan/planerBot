import hashlib
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, and_, case, cast, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from planerbot.campaigns import enqueue_campaign
from planerbot.event_contracts import Conflict, EventInput, EventsView, EventView, MissingEvent
from planerbot.models import Chat, Event, Publication, Topic


def message_link(chat_id: int, message_id: int | None, topic_id: int = 1) -> str | None:
    chat = str(chat_id)
    topic = f"{topic_id}/" if topic_id != 1 else ""
    return (
        f"https://t.me/c/{chat[4:]}/{topic}{message_id}"
        if chat.startswith("-100") and message_id
        else None
    )


async def enqueue(session: AsyncSession, event: Event) -> None:
    if event.source == "message":
        return
    statement = insert(Publication).values(
        event_id=event.id, status="pending", desired_version=event.version
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[Publication.event_id],
            set_={
                "desired_version": event.version,
                "status": case(
                    (Publication.status.in_(["sending", "unknown"]), Publication.status),
                    else_="pending",
                ),
            },
        )
    )


class EventRepository:
    def __init__(self, engine: AsyncEngine):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    @staticmethod
    async def read(session: AsyncSession, chat_id: int, event_id: UUID) -> EventView:
        row = (
            await session.execute(
                select(Event, Chat.title, Topic.title, Publication.status, Publication.message_id)
                .join(Chat, Chat.id == Event.chat_id)
                .join(
                    Topic, and_(Topic.chat_id == Event.chat_id, Topic.thread_id == Event.topic_id)
                )
                .outerjoin(Publication, Publication.event_id == Event.id)
                .where(Event.id == event_id, Event.chat_id == chat_id)
            )
        ).one_or_none()
        if row is None:
            raise MissingEvent
        event, chat_title, topic_title, publication, published_id = row
        return EventView(
            id=event.id,
            chat_id=str(event.chat_id),
            chat_title=chat_title,
            topic_title=topic_title,
            data=EventInput.model_validate(event.payload),
            timezone=event.timezone,
            starts_at=event.starts_at,
            ends_at=event.ends_at,
            version=event.version,
            status=event.status,
            source=event.source,
            source_message_id=event.source_message_id,
            publication_status=publication,
            message_url=message_link(
                event.chat_id, published_id or event.source_message_id, event.topic_id
            ),
        )

    async def create(
        self,
        chat_id: int,
        user_id: int,
        data: EventInput,
        timezone: str,
        event_id: UUID,
        *,
        status: str = "active",
        source: str = "form",
        message_id: int | None = None,
        source_date: datetime | None = None,
        update_id: int = 0,
    ) -> EventView:
        start, end = data.times(timezone)
        canonical = data.model_dump_json(exclude={"notify_members"})
        # Keep fingerprints and stored payloads compatible with pre-RSVP writers.
        intent = ":notify" if data.notify_members else ""
        fingerprint = hashlib.sha256(
            f"{chat_id}:{user_id}:{canonical}{intent}".encode()
        ).hexdigest()
        async with self.sessions.begin() as session:
            new_id = await session.scalar(
                insert(Event)
                .values(
                    id=event_id,
                    chat_id=chat_id,
                    topic_id=data.topic_id,
                    creator_id=user_id,
                    editor_id=user_id,
                    payload=data.model_dump(mode="json", exclude={"notify_members"}),
                    fingerprint=fingerprint,
                    timezone=timezone,
                    local_date=data.start_date,
                    starts_at=start,
                    ends_at=end,
                    version=1,
                    status=status,
                    source=source,
                    source_message_id=message_id,
                    source_updated_at=source_date,
                    source_update_id=update_id,
                )
                .on_conflict_do_nothing()
                .returning(Event.id)
            )
            event = await session.scalar(
                select(Event).where(Event.id == event_id).with_for_update()
            )
            if (
                event is None
                or event.chat_id != chat_id
                or event.creator_id != user_id
                or event.source != source
            ):
                raise Conflict("Ключ запроса уже использован")
            changed = new_id is not None
            if new_id is None:
                if source == "form":
                    if event.fingerprint != fingerprint:
                        raise Conflict("Ключ запроса уже использован для других данных")
                elif source_date is not None and event.source_updated_at is not None:
                    if (source_date, update_id) > (event.source_updated_at, event.source_update_id):
                        if event.status != "cancelled":
                            self.assign(event, data, timezone)
                            event.status = status
                            event.source_updated_at, event.source_update_id = source_date, update_id
                            changed = True
            await session.flush()
            if changed:
                await enqueue(session, event)
            if new_id is not None and data.notify_members and status == "active":
                from uuid import NAMESPACE_URL, uuid5

                await enqueue_campaign(
                    session,
                    event,
                    user_id,
                    uuid5(NAMESPACE_URL, f"invitation:{event_id}"),
                    "all",
                    "Новое событие. Отметьте, сможете ли вы прийти.",
                )
            return await self.read(session, chat_id, event_id)

    @staticmethod
    def assign(event: Event, data: EventInput, timezone: str) -> None:
        if event.topic_id != data.topic_id:
            raise Conflict("После создания события тему менять нельзя")
        event.starts_at, event.ends_at = data.times(timezone)
        event.payload, event.local_date = (
            data.model_dump(mode="json", exclude={"notify_members"}),
            data.start_date,
        )
        event.timezone = timezone
        event.version += 1

    async def change(
        self,
        chat_id: int,
        event_id: UUID,
        user_id: int,
        version: int,
        *,
        data: EventInput | None = None,
        action: str | None = None,
    ) -> EventView:
        async with self.sessions.begin() as session:
            event = await session.scalar(
                select(Event)
                .where(Event.chat_id == chat_id, Event.id == event_id)
                .with_for_update()
            )
            if event is None:
                raise MissingEvent
            if event.version != version:
                raise Conflict("Событие изменилось. Обновите календарь перед повторной правкой.")
            if event.status == "cancelled":
                raise Conflict("Событие уже отменено")
            if data is not None:
                self.assign(event, data, event.timezone)
            else:
                if action == "approve" and event.status != "pending":
                    raise Conflict("Событие уже подтверждено")
                event.status = "active" if action == "approve" else "cancelled"
                event.version += 1
            event.editor_id = user_id
            await session.flush()
            await enqueue(session, event)
            return await self.read(session, chat_id, event_id)

    async def list(
        self,
        chat_ids: list[int],
        admin_ids: list[int],
        start: date,
        end: date,
        topic_id: int | None,
        tag: str | None,
    ) -> EventsView:
        local_end = func.coalesce(cast(Event.payload["end_date"].astext, Date), Event.local_date)
        query = (
            select(Event.id, Event.chat_id)
            .join(Topic, and_(Topic.chat_id == Event.chat_id, Topic.thread_id == Event.topic_id))
            .where(
                Event.chat_id.in_(chat_ids),
                or_(
                    Event.local_date >= start,
                    local_end > start,
                    and_(local_end == start, Event.payload["end_time"].astext != "00:00"),
                ),
                Event.local_date < end,
                or_(Topic.enabled, Event.chat_id.in_(admin_ids)),
                or_(Event.status != "pending", Event.chat_id.in_(admin_ids)),
            )
            .order_by(Event.local_date, Event.starts_at, Event.id)
            .limit(201)
        )
        if topic_id is not None:
            query = query.where(Event.topic_id == topic_id)
        if tag:
            query = query.where(Event.payload["tags"].contains([tag.casefold()]))
        async with self.sessions() as session:
            rows = (await session.execute(query)).all()
            # A bounded joined query below avoids one read per event.
            ids = [row[0] for row in rows[:200]]
            joined = (
                await session.execute(
                    select(
                        Event, Chat.title, Topic.title, Publication.status, Publication.message_id
                    )
                    .join(Chat, Chat.id == Event.chat_id)
                    .join(
                        Topic,
                        and_(Topic.chat_id == Event.chat_id, Topic.thread_id == Event.topic_id),
                    )
                    .outerjoin(Publication, Publication.event_id == Event.id)
                    .where(Event.id.in_(ids))
                    .order_by(Event.local_date, Event.starts_at, Event.id)
                )
            ).all()
            views = [
                EventView(
                    id=e.id,
                    chat_id=str(e.chat_id),
                    chat_title=chat_title,
                    topic_title=topic_title,
                    data=EventInput.model_validate(e.payload),
                    timezone=e.timezone,
                    starts_at=e.starts_at,
                    ends_at=e.ends_at,
                    version=e.version,
                    status=e.status,
                    source=e.source,
                    source_message_id=e.source_message_id,
                    publication_status=publication,
                    message_url=message_link(
                        e.chat_id, published_id or e.source_message_id, e.topic_id
                    ),
                    can_manage=e.chat_id in admin_ids,
                )
                for e, chat_title, topic_title, publication, published_id in joined
            ]
            return EventsView(events=views, has_more=len(rows) > 200)
