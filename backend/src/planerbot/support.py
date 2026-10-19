"""Private support intake and durable delivery; no calendar membership is required."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.models import SupportTicket
from planerbot.notices import Deferred
from planerbot.publications import DeliveryRejected, DeliveryUnknown

logger = logging.getLogger(__name__)


class SupportError(ValueError):
    pass


@dataclass(frozen=True)
class SupportJob:
    id: UUID
    target_id: int
    user_id: int
    name: str
    username: str | None
    body: str
    lease: UUID


class SupportGateway(Protocol):
    async def send_support(self, job: SupportJob) -> None: ...


class SupportService:
    def __init__(self, engine: AsyncEngine, target_id: int):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.target_id = target_id

    async def submit(
        self, user_id: int, message_id: int, name: str, username: str | None, body: str
    ) -> UUID:
        if not self.target_id:
            raise SupportError("Приём обращений пока не настроен. Контакт: @ivanSVladimirovich.")
        body = body.strip()
        if not body or len(body.encode("utf-16-le")) // 2 > 3000:
            raise SupportError("Отправьте описание проблемы текстом: от 1 до 3000 символов.")
        if user_id <= 0 or message_id <= 0:
            raise SupportError("Отправьте обращение из личного аккаунта в личку боту.")
        now = datetime.now(UTC)
        async with self.sessions.begin() as session:
            # Support-only advisory-lock namespace; serializes intake per user, not globally.
            await session.execute(select(func.pg_advisory_xact_lock(-(2**52 + user_id))))
            existing = await session.scalar(
                select(SupportTicket.id).where(
                    SupportTicket.user_id == user_id, SupportTicket.source_message_id == message_id
                )
            )
            if existing is not None:
                return existing
            latest = await session.scalar(
                select(SupportTicket.created_at)
                .where(SupportTicket.user_id == user_id)
                .order_by(SupportTicket.created_at.desc())
                .limit(1)
            )
            if latest is not None and latest > now - timedelta(minutes=1):
                raise SupportError("Можно отправлять не больше одного обращения в минуту.")
            ticket_id = uuid4()
            session.add(
                SupportTicket(
                    id=ticket_id,
                    user_id=user_id,
                    source_message_id=message_id,
                    target_id=self.target_id,
                    name=" ".join(name.split())[:128],
                    username=username[:64] if username else None,
                    body=body,
                    created_at=now,
                    status="pending",
                    next_attempt=now,
                )
            )
            return ticket_id


class SupportDelivery:
    def __init__(self, engine: AsyncEngine, gateway: SupportGateway):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.gateway = gateway

    async def claim(self) -> SupportJob | None:
        now = datetime.now(UTC)
        async with self.sessions.begin() as session:
            await session.execute(
                update(SupportTicket)
                .where(
                    SupportTicket.status == "sending",
                    SupportTicket.claimed_at < now - timedelta(seconds=60),
                )
                .values(status="unknown")
            )
            ticket = await session.scalar(
                select(SupportTicket)
                .where(SupportTicket.status == "pending", SupportTicket.next_attempt <= now)
                .order_by(SupportTicket.next_attempt, SupportTicket.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if ticket is None:
                return None
            ticket.status, ticket.lease, ticket.claimed_at = "sending", uuid4(), now
            ticket.attempts += 1
            return SupportJob(
                ticket.id,
                ticket.target_id,
                ticket.user_id,
                ticket.name,
                ticket.username,
                ticket.body,
                ticket.lease,
            )

    async def finish(self, job: SupportJob, status: str, delay: int = 0) -> None:
        async with self.sessions.begin() as session:
            ticket = await session.scalar(
                select(SupportTicket)
                .where(
                    SupportTicket.id == job.id,
                    SupportTicket.lease == job.lease,
                    SupportTicket.status == "sending",
                )
                .with_for_update()
            )
            if ticket is not None:
                ticket.status = "failed" if status == "pending" and ticket.attempts >= 3 else status
                ticket.next_attempt = datetime.now(UTC) + timedelta(seconds=delay)

    async def once(self) -> bool:
        job = await self.claim()
        if job is None:
            return False
        try:
            await self.gateway.send_support(job)
        except Deferred as exc:
            await self.finish(job, "pending", exc.seconds)
        except DeliveryRejected:
            await self.finish(job, "failed")
            logger.warning("Support delivery failed: ticket=%s", job.id)
        except DeliveryUnknown:
            await self.finish(job, "unknown")
            logger.warning("Support delivery outcome unknown: ticket=%s", job.id)
        else:
            await self.finish(job, "sent")
        return True

    async def run(self) -> None:
        while True:
            worked = await self.once()
            await asyncio.sleep(1 if worked else 2)
