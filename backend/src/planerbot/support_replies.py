"""Durable answers to opt-in support tickets; independent of calendar notifications."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.models import SupportReply, SupportTicket
from planerbot.notices import Deferred
from planerbot.publications import DeliveryRejected, DeliveryUnknown

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SupportReplyJob:
    id: UUID
    ticket_id: UUID
    user_id: int
    name: str
    username: str | None
    body: str
    lease: UUID


def reply_text(job: SupportReplyJob) -> str:
    recipient = f"@{job.username}" if job.username else " ".join(job.name.split())
    greeting = f"Здравствуйте, {recipient}!" if recipient else "Здравствуйте!"
    return (
        f"{greeting}\n\n{job.body}\n\n"
        "Спасибо, что помогаете улучшать planerBot!\n"
        "Присылайте пожелания и замеченные дефекты через /support.\n"
        "С уважением, команда поддержки planerBot."
    )


class SupportReplyGateway(Protocol):
    async def send_support_reply(self, job: SupportReplyJob) -> None: ...


class SupportReplyDelivery:
    def __init__(self, engine: AsyncEngine, gateway: SupportReplyGateway):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.gateway = gateway

    async def claim(self) -> SupportReplyJob | None:
        now = datetime.now(UTC)
        async with self.sessions.begin() as session:
            await session.execute(
                update(SupportReply)
                .where(
                    SupportReply.status == "sending",
                    SupportReply.claimed_at < now - timedelta(seconds=60),
                )
                .values(status="unknown")
            )
            reply = await session.scalar(
                select(SupportReply)
                .where(
                    SupportReply.status == "pending",
                    SupportReply.next_attempt <= now,
                )
                .order_by(SupportReply.next_attempt, SupportReply.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if reply is None:
                return None
            ticket = await session.get(SupportTicket, reply.ticket_id)
            assert ticket is not None  # FK
            reply.status, reply.lease, reply.claimed_at = "sending", uuid4(), now
            reply.attempts += 1
            return SupportReplyJob(
                reply.id,
                ticket.id,
                ticket.user_id,
                ticket.name,
                ticket.username,
                reply.body,
                reply.lease,
            )

    async def finish(self, job: SupportReplyJob, status: str, delay: int = 0) -> None:
        async with self.sessions.begin() as session:
            reply = await session.scalar(
                select(SupportReply)
                .where(
                    SupportReply.id == job.id,
                    SupportReply.lease == job.lease,
                    SupportReply.status == "sending",
                )
                .with_for_update()
            )
            if reply is not None:
                reply.status = "failed" if status == "pending" and reply.attempts >= 3 else status
                reply.next_attempt = datetime.now(UTC) + timedelta(seconds=delay)

    async def once(self) -> bool:
        job = await self.claim()
        if job is None:
            return False
        try:
            await self.gateway.send_support_reply(job)
        except Deferred as exc:
            await self.finish(job, "pending", exc.seconds)
        except DeliveryRejected:
            await self.finish(job, "failed")
            logger.warning("Support reply delivery failed: reply=%s", job.id)
        except DeliveryUnknown:
            await self.finish(job, "unknown")
            logger.warning("Support reply outcome unknown: reply=%s", job.id)
        else:
            await self.finish(job, "sent")
        return True

    async def run(self) -> None:
        while True:
            worked = await self.once()
            await asyncio.sleep(1 if worked else 2)
