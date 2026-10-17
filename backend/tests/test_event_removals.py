import importlib.util
import json
import re
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramNetworkError
from aiogram.methods import DeleteMessage
from event_helpers import STAMP, A, B, draft, services
from planerbot.event_contracts import Conflict
from planerbot.event_repository import EventRepository
from planerbot.models import Event, EventResponse, Publication, Topic
from planerbot.publications import (
    Delivery,
    DeliveryRejected,
    DeliveryUnknown,
    PublicationRepository,
)
from planerbot.telegram import TelegramGateway
from sqlalchemy import event as sql_event
from sqlalchemy import func, select, text, update


async def test_cancel_excludes_calendar_preserves_votes_and_exposes_admin_cleanup(engine):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    store = PublicationRepository(engine)
    job = await store.claim()
    await store.finish(job, "published", 100)
    async with store.sessions.begin() as session:
        session.add(EventResponse(event_id=event.id, user_id=43, answer="yes"))
    await service.change(42, A, event.id, 1, action="cancel")
    admin = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), A, None, None)
    assert not admin.events and admin.removals[0].id == event.id
    assert admin.removals[0].can_manage and not admin.has_more_removals
    member = await service.list(43, date(2026, 10, 1), date(2026, 11, 1), A, None, None)
    assert not member.events and not member.removals
    other = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), B, None, None)
    assert not other.removals
    # A disabled topic must not prevent deletion of its old message.
    async with store.sessions.begin() as session:
        await session.execute(update(Topic).where(Topic.chat_id == A).values(enabled=False))
    bot = AsyncMock()
    assert await Delivery(store, service.access, TelegramGateway(bot)).once()
    bot.delete_message.assert_awaited_once_with(chat_id=A, message_id=100, request_timeout=10)
    bot.send_message.assert_not_awaited()
    remaining = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), A, None, None)
    assert not remaining.removals
    async with store.sessions() as session:
        assert (await session.get(Event, event.id)).status == "cancelled"
        assert (await session.get(EventResponse, (event.id, 43))).answer == "yes"
        assert (await EventRepository.read(session, A, event.id)).message_url is None


async def test_cancel_import_deletes_original_without_creating_card(engine):
    service, _, _ = await services(engine)
    event = await service.events.create(
        A, 42, draft(), "UTC", uuid4(), source="message", message_id=77, source_date=STAMP
    )
    store = PublicationRepository(engine)
    assert await store.claim() is None
    await service.change(42, A, event.id, 1, action="cancel")
    bot = AsyncMock()
    assert await Delivery(store, service.access, TelegramGateway(bot)).once()
    bot.delete_message.assert_awaited_once_with(chat_id=A, message_id=77, request_timeout=10)
    bot.edit_message_text.assert_not_awaited()


async def test_cancel_during_initial_delivery_queues_deletion_of_returned_message(engine):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    store = PublicationRepository(engine)
    old = await store.claim()
    await service.change(42, A, event.id, 1, action="cancel")
    await store.finish(old, "published", 88)
    cleanup = await store.claim()
    assert cleanup.event.status == "cancelled" and cleanup.message_id == 88
    bot = AsyncMock()
    await TelegramGateway(bot).send_card(cleanup.event, cleanup.message_id)
    bot.delete_message.assert_awaited_once()


async def test_cancel_before_first_send_never_sends_cancellation_card(engine):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    await service.change(42, A, event.id, 1, action="cancel")
    bot = AsyncMock()
    assert await Delivery(
        PublicationRepository(engine), service.access, TelegramGateway(bot)
    ).once()
    bot.delete_message.assert_not_awaited()
    bot.send_message.assert_not_awaited()


@pytest.mark.parametrize(
    "error,expected",
    [
        ("message to delete not found", None),
        ("message can't be deleted", DeliveryRejected),
        ("forbidden", DeliveryRejected),
        ("network", DeliveryUnknown),
        ("timeout", DeliveryUnknown),
    ],
)
async def test_delete_classification_and_idempotency(engine, error, expected):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    cancelled = await service.change(42, A, event.id, 1, action="cancel")
    bot = AsyncMock()
    method = DeleteMessage(chat_id=A, message_id=123)
    bot.delete_message.side_effect = (
        TelegramForbiddenError(method=method, message=error)
        if error == "forbidden"
        else TelegramNetworkError(method=method, message=error)
        if error == "network"
        else TimeoutError()
        if error == "timeout"
        else TelegramBadRequest(method=method, message=error)
    )
    if expected:
        with pytest.raises(expected):
            await TelegramGateway(bot).send_card(cancelled, 123)
    else:
        assert await TelegramGateway(bot).send_card(cancelled, 123) == 123
    bot.send_message.assert_not_awaited()


@pytest.mark.parametrize("source", ["form", "bot"])
async def test_unknown_initial_send_cannot_be_reported_deleted_without_message_id(engine, source):
    service, _, _ = await services(engine)
    event = await service.events.create(
        A, 42, draft(), "UTC", uuid4(), source=source, message_id=77 if source == "bot" else None
    )
    store = PublicationRepository(engine)
    job = await store.claim()
    await store.finish(job, "unknown")
    await service.change(42, A, event.id, 1, action="cancel")
    with pytest.raises(Conflict, match="ID отправленного сообщения неизвестен"):
        await store.retry(A, event.id, True)
    async with store.sessions() as session:
        assert (await session.get(Publication, event.id)).status == "unknown"
        assert (await EventRepository.read(session, A, event.id)).message_url is None
    queue = await service.events.list([A], [A], date(2026, 10, 1), date(2026, 11, 1), None, None)
    assert queue.removals[0].message_url is None


async def test_removal_queue_bounded_separately_from_calendar(engine):
    service, _, _ = await services(engine)
    for i in range(52):
        event = await service.create(42, A, draft(title=f"Cancelled {i}"), uuid4())
        await service.change(42, A, event.id, 1, action="cancel")
    active = await service.create(42, A, draft(), uuid4())
    result = await service.list(42, date(2026, 10, 1), date(2026, 11, 1), A, None, None)
    assert [e.id for e in result.events] == [active.id]
    assert len(result.removals) == 50 and result.has_more_removals and not result.has_more


async def test_legacy_backfill_batches_and_preserves_unknown_work(engine, monkeypatch):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    store = PublicationRepository(engine)
    async with engine.begin() as connection:
        await connection.execute(
            text("""
            INSERT INTO events (id,chat_id,topic_id,creator_id,editor_id,payload,fingerprint,
                timezone,local_date,starts_at,version,status,source,source_update_id)
            SELECT lpad(to_hex(n),32,'0')::uuid,-100100,10,42,42,
                CAST(:payload AS jsonb),
                'migration','UTC','2026-10-20','2026-10-20T00:00:00Z',2,'cancelled','form',0
            FROM generate_series(1,501) AS n
        """),
            {"payload": draft(title="Legacy").model_dump_json()},
        )
        await connection.execute(
            text("""
            INSERT INTO publications(event_id,status,desired_version,message_id)
            SELECT id,'published',version,7 FROM events WHERE status='cancelled'
        """)
        )
        await connection.execute(
            update(Publication).where(Publication.event_id == event.id).values(status="unknown")
        )
        module_path = Path(__file__).parents[1] / "migrations/versions/0005_event_removals.py"
        spec = importlib.util.spec_from_file_location("removal_backfill", module_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)

        def run(sync):
            monkeypatch.setattr(migration.op, "get_bind", lambda: sync)
            migration.upgrade()
            migration.upgrade()  # Idempotent for pending/unknown work.
            migration.downgrade()  # Data-only; must not discard cleanup jobs.

        await connection.run_sync(run)
    async with store.sessions() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(Publication).where(Publication.status == "pending")
            )
            == 501
        )
        assert (await session.get(Publication, event.id)).status == "unknown"

    # Probe actual repository SQL on the populated test DB, not SQLite/estimates.
    async with engine.begin() as connection:
        await connection.execute(text("ANALYZE events, topics, publications"))
    queries = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        if statement.lstrip().startswith("SELECT"):
            queries.append((statement, parameters))

    sql_event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        result = await service.events.list(
            [A], [A], date(2026, 10, 1), date(2026, 11, 1), None, None
        )
    finally:
        sql_event.remove(engine.sync_engine, "before_cursor_execute", capture)
    assert len(queries) == 3  # Constant count: IDs, joined agenda, joined cleanup.
    assert len(result.events) == 1 and len(result.removals) == 50 and result.has_more_removals
    statement, parameters = queries[0]
    before, count = re.subn(
        r"events\.status != (\$\d+::VARCHAR)", r"\1 IS NOT NULL", statement, count=1
    )
    assert count == 1
    reports = []
    async with engine.connect() as connection:
        for name, sql, params in [
            ("before-status-filter", before, parameters),
            ("agenda", statement, parameters),
            ("removal-queue", *queries[2]),
        ]:
            raw = (
                await connection.exec_driver_sql(
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params
                )
            ).scalar_one()
            plan = json.loads(raw) if isinstance(raw, str) else raw
            reports.append(
                {
                    "query": name,
                    "rows": plan[0]["Plan"]["Actual Rows"],
                    "execution_ms": plan[0]["Execution Time"],
                    "plan": plan[0]["Plan"],
                }
            )
    assert reports[0]["rows"] == 201 and reports[1]["rows"] == 1
    print("REMOVAL_QUERY_PLANS=" + json.dumps(reports))
