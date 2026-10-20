"""Durable personal-message delivery, separate from chat publications."""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.access import AccessDenied, AccessUnavailable, ChatAccess
from planerbot.campaigns import invitation_id
from planerbot.event_contracts import EventView
from planerbot.event_repository import EventRepository
from planerbot.models import (
    CalendarParticipant,
    Event,
    EventResponse,
    MessageCampaign,
    PersonalContact,
    PersonalNotice,
)
from planerbot.publications import DeliveryRejected, DeliveryUnknown


class Deferred(Exception):
    def __init__(self, seconds: int):
        self.seconds = max(1, min(seconds, 3600))


class NoticeGateway(Protocol):
    async def send_personal(self, user_id: int, event: EventView, body: str) -> None: ...


@dataclass(frozen=True)
class NoticeJob:
    campaign_id: UUID
    user_id: int
    sender_id: int
    audience: str
    body: str
    event: EventView
    lease: UUID


class NoticeDelivery:
    def __init__(self, engine: AsyncEngine, access: ChatAccess, gateway: NoticeGateway):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.access, self.gateway = access, gateway

    async def claim(self) -> NoticeJob | None:
        now = datetime.now(UTC)
        async with self.sessions.begin() as session:
            await session.execute(
                update(PersonalNotice)
                .where(
                    PersonalNotice.status == "sending",
                    PersonalNotice.claimed_at < now - timedelta(seconds=60),
                )
                .values(status="unknown")
            )
            notice = await session.scalar(
                select(PersonalNotice)
                .where(PersonalNotice.status == "pending", PersonalNotice.next_attempt <= now)
                .order_by(
                    PersonalNotice.next_attempt, PersonalNotice.campaign_id, PersonalNotice.user_id
                )
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if notice is None:
                return None
            campaign = await session.get(MessageCampaign, notice.campaign_id)
            assert campaign is not None  # FK
            event = await session.get(Event, campaign.event_id)
            assert event is not None  # FK
            notice.status, notice.lease, notice.claimed_at = "sending", uuid4(), now
            notice.attempts += 1
            view = await EventRepository.read(session, event.chat_id, event.id)
            return NoticeJob(
                campaign.id,
                notice.user_id,
                campaign.sender_id,
                campaign.audience,
                campaign.body,
                view,
                notice.lease,
            )

    async def finish(self, job: NoticeJob, status: str, delay: int = 0) -> None:
        async with self.sessions.begin() as session:
            notice = await session.scalar(
                select(PersonalNotice)
                .where(
                    PersonalNotice.campaign_id == job.campaign_id,
                    PersonalNotice.user_id == job.user_id,
                    PersonalNotice.lease == job.lease,
                    PersonalNotice.status == "sending",
                )
                .with_for_update()
            )
            if notice is not None:
                notice.status = "failed" if status == "pending" and notice.attempts >= 5 else status
                notice.next_attempt = datetime.now(UTC) + timedelta(seconds=delay)

    async def eligible(self, job: NoticeJob) -> bool:
        chat_id = int(job.event.chat_id)
        if job.campaign_id != invitation_id(job.event.id):
            await self.access.authorize(job.sender_id, chat_id, manage=True)
        target = await self.access.authorize(job.user_id, chat_id)
        if not any(
            t.thread_id == job.event.data.topic_id and t.enabled for t in target.chat.topics
        ):
            return False
        async with self.sessions() as session:
            event = await session.get(Event, job.event.id)
            contact = await session.get(PersonalContact, job.user_id)
            member = await session.get(CalendarParticipant, (chat_id, job.user_id))
            answer = await session.get(EventResponse, (job.event.id, job.user_id))
            return bool(
                event
                and event.status == "active"
                and member
                and contact
                and contact.enabled
                and (
                    job.audience == "all"
                    or (answer.answer if answer else "unanswered") == job.audience
                )
            )

    async def once(self) -> bool:
        job = await self.claim()
        if job is None:
            return False
        try:
            eligible = await self.eligible(job)
        except AccessDenied:
            await self.finish(job, "skipped")
            return True
        except AccessUnavailable:
            await self.finish(job, "pending", 15)
            return True
        if not eligible:
            await self.finish(job, "skipped")
            return True
        try:
            await self.gateway.send_personal(job.user_id, job.event, job.body)
        except Deferred as exc:
            await self.finish(job, "pending", exc.seconds)
        except DeliveryRejected:
            await self.finish(job, "failed")
        except DeliveryUnknown:
            await self.finish(job, "unknown")
        else:
            await self.finish(job, "sent")
        return True

    async def run(self) -> None:
        while True:
            worked = await self.once()
            await asyncio.sleep(1 if worked else 2)
