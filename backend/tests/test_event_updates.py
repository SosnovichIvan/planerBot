from datetime import date
from uuid import uuid4

import pytest
from event_helpers import A, B, draft, services
from planerbot.access import AccessDenied
from planerbot.auth import Viewer
from planerbot.event_contracts import Conflict
from planerbot.event_updates import display
from planerbot.models import EventRevision, MessageCampaign
from planerbot.rsvp import RsvpService
from sqlalchemy import func, select


async def listed(service, user=43):
    return (await service.list(user, date(2026, 10, 1), date(2026, 11, 1), A, None, None)).events


async def test_personal_updates_preserve_rsvp_and_accumulate_since_last_view(engine):
    service, _, roles = await services(engine)
    rsvp = RsvpService(engine, service.access)
    member = Viewer(id=43, first_name="Участник")
    admin = Viewer(id=42, first_name="Администратор")
    event = await service.create(42, A, draft(), uuid4())
    assert not (await listed(service))[0].has_updates
    assert (await rsvp.detail(member, A, event.id, "yes")).event.changes == []
    changed = await service.change(42, A, event.id, 1, data=draft(place="Парк"))
    assert changed.version == 2
    assert (await listed(service))[0].has_updates
    await service.change(42, A, event.id, 2, data=draft(place="Парк", title="Новая тема"))
    detail = await rsvp.detail(member, A, event.id)
    assert detail.event.my_response == "yes" and detail.counts.yes == 1
    assert {row.field: row.before for row in detail.event.changes} == {
        "place": "Кафе",
        "title": "Встреча",
    }
    assert not (await listed(service))[0].has_updates
    assert (await listed(service, 42))[0].has_updates
    repeat = await rsvp.detail(member, A, event.id)
    assert [row.field for row in repeat.event.changes] == ["title"]
    await rsvp.detail(admin, A, event.id)
    await service.change(
        42,
        A,
        event.id,
        3,
        data=draft(place="Парк", title="Новая тема", tags=["#новое"], end_time="20:00"),
    )
    detail = await rsvp.detail(member, A, event.id)
    assert {row.field: row.before for row in detail.event.changes} == {
        "tags": "#команда",
        "end_time": "Не указано",
    }
    assert (await listed(service, 42))[0].has_updates
    roles[(A, 43)] = "left"
    with pytest.raises(AccessDenied):
        await rsvp.detail(member, A, event.id)
    with pytest.raises(AccessDenied):
        await rsvp.detail(member, B, event.id)


async def test_noop_and_notification_intent_are_separate_from_event_content(engine):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    same = await service.change(42, A, event.id, 1, data=draft(notify_members=True))
    assert same.version == 1
    async with service.events.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(EventRevision)) == 0
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 1
    changed = await service.change(
        42, A, event.id, 1, data=draft(place="Парк", notify_members=True)
    )
    async with service.events.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(EventRevision)) == 1
        campaign = await session.scalar(
            select(MessageCampaign).where(MessageCampaign.body.contains("изменилось"))
        )
        assert campaign.audience == "all" and "изменилось" in campaign.body
    with pytest.raises(Conflict):
        await service.change(42, A, event.id, 1, data=draft(place="Парк", notify_members=True))
    assert (
        await service.change(42, A, event.id, changed.version, data=draft(place="Парк"))
    ).version == changed.version
    assert display(12) == "12"
    assert display("") == "Не указано"
