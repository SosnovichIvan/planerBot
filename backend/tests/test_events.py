import asyncio
from datetime import date, timedelta
from uuid import uuid4

import pytest
from event_helpers import STAMP, A, B, draft, services
from planerbot.access import AccessDenied
from planerbot.event_contracts import ChatSettingsInput, Conflict, InvalidEvent, MissingEvent
from planerbot.models import Chat, Event, Publication
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError


def settings(version=1, **kwargs):
    return ChatSettingsInput(
        version=version,
        timezone="Europe/Moscow",
        event_tag="#событие",
        enabled_topic_ids=[10],
        **kwargs,
    )


async def test_settings_scope_and_optimistic_lock(engine):
    service, _, roles = await services(engine)
    with pytest.raises(AccessDenied):
        await service.settings(43, A, settings())
    with pytest.raises(InvalidEvent):
        await service.settings(42, A, settings().model_copy(update={"enabled_topic_ids": [20]}))
    await service.settings(42, A, settings())
    assert (await service.chats.get(A)).timezone == "Europe/Moscow"
    with pytest.raises(Conflict):
        await service.settings(42, A, settings())
    roles[(A, 42)] = "left"
    with pytest.raises(AccessDenied):
        await service.create(42, A, draft(), uuid4())
    assert await service.chats.get(-999) is None


async def test_create_idempotency_topic_scope_and_atomic_queue(engine):
    service, _, _ = await services(engine)
    key = uuid4()
    first, second = await asyncio.gather(*(service.create(42, A, draft(), key) for _ in range(2)))
    assert first.id == second.id and first.version == 1
    assert first.publication_status == "pending" and first.can_manage
    with pytest.raises(Conflict):
        await service.create(42, A, draft(title="Другое"), key)
    other = await service.create(42, B, draft(topic_id=20), key)
    assert other.id != first.id  # Request keys are scoped to a chat and creator.
    with pytest.raises(InvalidEvent):
        await service.create(42, A, draft(topic_id=20), uuid4())
    with pytest.raises(AccessDenied):
        await service.create(43, A, draft(), uuid4())
    with pytest.raises(AccessDenied):
        await service.create(42, -999, draft(), uuid4())
    async with service.events.sessions() as session:
        assert len(list(await session.scalars(select(Event)))) == 2
        assert len(list(await session.scalars(select(Publication)))) == 2
    with pytest.raises(IntegrityError):
        await service.events.create(A, 42, draft(topic_id=20), "UTC", uuid4())


async def test_edit_approve_cancel_conflicts(engine):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    changed = await service.change(42, A, event.id, 1, data=draft(place="Парк"))
    assert changed.data.place == "Парк" and changed.version == 2
    for operation in [
        service.change(42, A, event.id, 1, data=draft()),
        service.change(42, A, event.id, 2, action="approve"),
        service.change(42, B, event.id, 2, action="cancel"),
        service.change(42, A, uuid4(), 1, action="cancel"),
    ]:
        with pytest.raises((Conflict, MissingEvent)):
            await operation
    with pytest.raises(Conflict):
        await service.events.change(A, event.id, 42, 2, data=draft(topic_id=11))
    cancelled = await service.change(42, A, event.id, 2, action="cancel")
    assert cancelled.status == "cancelled"
    with pytest.raises(Conflict):
        await service.change(42, A, event.id, 3, data=draft())
    async with service.events.sessions() as session:
        with pytest.raises(MissingEvent):
            await service.events.read(session, B, event.id)


async def test_import_pending_edit_order_and_isolation(engine):
    service, _, roles = await services(engine)
    text = "#событие #команда\nНазвание: Встреча\nДата: 20.10.2026\nМесто: Кафе"
    assert await service.import_message(42, A, 10, "обычная беседа", 5, STAMP, 1) is None
    assert await service.import_message(42, -999, 10, text, 5, STAMP, 1) is None
    with pytest.raises(AccessDenied):
        await service.import_message(43, A, 10, text, 5, STAMP, 1)
    await service.settings(42, A, settings(confirmation_required=True))
    pending = await service.import_message(42, A, 10, text, 5, STAMP, 2)
    assert pending.status == "pending" and pending.publication_status is None
    assert not (
        await service.list(43, date(2026, 10, 1), date(2026, 11, 1), None, None, None)
    ).events
    approved = await service.change(42, A, pending.id, 1, action="approve")
    assert approved.status == "active"
    assert (
        len((await service.list(43, date(2026, 10, 1), date(2026, 11, 1), None, None, None)).events)
        == 1
    )
    edited = await service.import_message(
        42, A, 10, text.replace("Кафе", "Парк"), 5, STAMP + timedelta(seconds=1), 3
    )
    assert edited.id == pending.id and edited.version == 3 and edited.status == "pending"
    old = await service.import_message(42, A, 10, text, 5, STAMP, 2)
    assert old.version == 3 and old.data.place == "Парк"
    await service.change(42, A, pending.id, 3, action="cancel")
    old = await service.import_message(42, A, 10, text, 5, STAMP + timedelta(seconds=2), 4)
    assert old.status == "cancelled" and old.version == 4
    with pytest.raises(AccessDenied):
        await service.list(43, date(2026, 10, 1), date(2026, 11, 1), B, None, None)
    roles[(A, 43)] = "left"
    assert not (
        await service.list(43, date(2026, 10, 1), date(2026, 11, 1), None, None, None)
    ).events


@pytest.mark.parametrize("command", [False, True])
async def test_legacy_member_policy_cannot_allow_creation(engine, command):
    service, _, _ = await services(engine)
    async with engine.begin() as connection:
        await connection.execute(update(Chat).where(Chat.id == A).values(creation_policy="members"))
    with pytest.raises(AccessDenied):
        await service.import_message(
            43, A, 10, "#событие\nНазвание: A\nДата: 2026-10-20", 7, STAMP, 1, command=command
        )
    async with service.events.sessions() as session:
        assert list(await session.scalars(select(Event))) == []


async def test_filters_disable_topics_and_bot_command(engine):
    service, _, _ = await services(engine)
    await service.import_message(
        42, A, 10, "/event\nНазвание: Встреча\nДата: 2026-10-20", 8, STAMP, 1, command=True
    )
    first = await service.create(42, B, draft(topic_id=20), uuid4())
    result = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), None, 20, "#КОМАНДА")
    assert [item.id for item in result.events] == [first.id]
    with pytest.raises(InvalidEvent):
        await service.list(42, date(2026, 10, 1), date(2027, 11, 1), None, None, None)
    await service.settings(42, A, settings(confirmation_required=True))
    pending = await service.import_message(
        42, A, 10, "#событие\nНазвание: A\nДата: 2026-10-20", 9, STAMP, 1
    )
    assert pending.status == "pending"
    await service.settings(42, A, settings(2).model_copy(update={"enabled_topic_ids": []}))
    with pytest.raises(InvalidEvent):
        await service.create(42, A, draft(), uuid4())
    assert not (await service.list(43, date(2026, 10, 1), date(2026, 11, 1), A, None, None)).events
    assert (await service.list(42, date(2026, 10, 1), date(2026, 11, 1), A, None, None)).events


async def test_store_edge_cases(engine):
    service, _, _ = await services(engine)
    key = uuid4()
    await service.events.create(A, 42, draft(), "UTC", key, source="message")
    await service.events.create(A, 42, draft(), "UTC", key, source="message")
    with pytest.raises(Conflict):
        await service.events.create(A, 43, draft(), "UTC", key)
    await service.chats.set_active(A, False)
    assert await service.chats.get(A) is None
    with pytest.raises(Conflict):
        await service.chats.configure(A, settings())


async def test_multiday_overlap_and_exclusive_midnight(engine):
    service, _, _ = await services(engine)
    included = await service.create(
        42, A, draft(start_date="2026-09-30", end_date="2026-10-02", end_time="10:00"), uuid4()
    )
    await service.create(
        42, A, draft(start_date="2026-09-30", end_date="2026-10-01", end_time="00:00"), uuid4()
    )
    result = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), A, None, None)
    assert [item.id for item in result.events] == [included.id]


async def test_request_key_cannot_reserve_another_chats_import_id(engine):
    from uuid import NAMESPACE_URL, uuid5

    service, _, roles = await services(engine)
    roles[(B, 44)] = "administrator"
    predicted = uuid5(NAMESPACE_URL, f"telegram:{A}:100")
    other = await service.create(44, B, draft(topic_id=20), predicted)
    imported = await service.import_message(
        42, A, 10, "#событие\nНазвание: A\nДата: 2026-10-20", 100, STAMP, 1
    )
    assert other.id != imported.id
    with pytest.raises(AccessDenied):
        await service.change(44, A, imported.id, 1, action="cancel")
