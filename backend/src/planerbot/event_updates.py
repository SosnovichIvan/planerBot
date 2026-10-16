"""Revision visibility belongs to a verified viewer, not a browser or RSVP."""

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from planerbot.event_contracts import EventChange, EventView
from planerbot.models import EventRevision, EventSeen


async def annotate_updates(
    session: AsyncSession, views: list[EventView], user_id: int
) -> list[EventView]:
    rows = (
        await session.execute(
            select(EventRevision.event_id, func.max(EventRevision.version), EventSeen.version)
            .outerjoin(
                EventSeen,
                (EventSeen.event_id == EventRevision.event_id) & (EventSeen.user_id == user_id),
            )
            .where(EventRevision.event_id.in_([view.id for view in views]))
            .group_by(EventRevision.event_id, EventSeen.version)
        )
    ).all()
    unread = {event_id: version > (seen or 0) for event_id, version, seen in rows}
    return [view.model_copy(update={"has_updates": unread.get(view.id, False)}) for view in views]


async def view_updates(session: AsyncSession, view: EventView, user_id: int) -> EventView:
    seen = await session.get(EventSeen, (view.id, user_id))
    # Since the last viewed version; on repeat views retain the latest change summary.
    query = select(EventRevision).where(EventRevision.event_id == view.id)
    baseline = await session.scalar(
        query.where(EventRevision.version > (seen.version if seen else 0))
        .order_by(EventRevision.version)
        .limit(1)
    )
    if baseline is None:
        baseline = await session.scalar(query.order_by(EventRevision.version.desc()).limit(1))
    changes = []
    if baseline:
        current = view.data.model_dump(mode="json", exclude={"notify_members"})
        for field, after in current.items():
            before = baseline.previous_payload.get(field)
            if before != after:
                changes.append(
                    EventChange(field=field, before=display(before), after=display(after))
                )
    await session.execute(
        insert(EventSeen)
        .values(event_id=view.id, user_id=user_id, version=view.version)
        .on_conflict_do_update(
            index_elements=[EventSeen.event_id, EventSeen.user_id],
            set_={"version": func.greatest(EventSeen.version, view.version)},
        )
    )
    return view.model_copy(update={"has_updates": False, "changes": changes})


def display(value: object) -> str:
    if value is None or value == "":
        return "Не указано"
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return str(value)
