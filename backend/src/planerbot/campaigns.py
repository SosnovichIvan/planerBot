"""Transactional personal-message intent; no network or application dependencies."""

import hashlib
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from planerbot.event_contracts import Conflict
from planerbot.models import (
    CalendarParticipant,
    Event,
    EventResponse,
    MessageCampaign,
    PersonalNotice,
)


def invitation_id(event_id: UUID) -> UUID:
    return uuid5(NAMESPACE_URL, f"invitation:{event_id}")


async def enqueue_invitation(session: AsyncSession, event: Event) -> None:
    await enqueue_campaign(
        session,
        event,
        event.creator_id,
        invitation_id(event.id),
        "all",
        "Новое событие. Отметьте, сможете ли вы прийти.",
    )


async def enqueue_campaign(
    session: AsyncSession,
    event: Event,
    sender_id: int,
    campaign_id: UUID,
    audience: str,
    body: str,
) -> None:
    fingerprint = hashlib.sha256(f"{audience}:{body}".encode()).hexdigest()
    new = await session.scalar(
        insert(MessageCampaign)
        .values(
            id=campaign_id,
            event_id=event.id,
            sender_id=sender_id,
            audience=audience,
            body=body,
            fingerprint=fingerprint,
        )
        .on_conflict_do_nothing()
        .returning(MessageCampaign.id)
    )
    if new is None:
        prior = await session.get(MessageCampaign, campaign_id)
        if prior is None or prior.fingerprint != fingerprint:
            raise Conflict("Ключ рассылки уже использован для другого сообщения")
        return
    # Snapshot only registered participants; the worker rechecks consent and access.
    query = (
        select(CalendarParticipant.user_id)
        .outerjoin(
            EventResponse,
            (
                (EventResponse.user_id == CalendarParticipant.user_id)
                & (EventResponse.event_id == event.id)
            ),
        )
        .where(CalendarParticipant.chat_id == event.chat_id)
    )
    if audience != "all":
        query = query.where(func.coalesce(EventResponse.answer, "unanswered") == audience)
    # INSERT SELECT avoids materializing an unbounded audience in application memory.
    await session.execute(
        insert(PersonalNotice).from_select(
            ["campaign_id", "user_id", "status", "next_attempt"],
            query.with_only_columns(
                literal(campaign_id),
                CalendarParticipant.user_id,
                literal("pending"),
                literal(datetime.now(UTC)),
            ),
        )
    )
