import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.exceptions import TelegramBadRequest, TelegramNetworkError, TelegramRetryAfter
from aiogram.methods import SendMessage
from planerbot.models import SupportTicket
from planerbot.notices import Deferred
from planerbot.publications import DeliveryRejected, DeliveryUnknown
from planerbot.support import SupportDelivery, SupportError, SupportJob, SupportService
from planerbot.telegram import TelegramGateway
from sqlalchemy import event as sql_event
from sqlalchemy import func, insert, select, text


async def ticket(
    service, *, user=42, message=1, body="Не открывается календарь", username="viewer"
):
    return await service.submit(user, message, "Имя\nПользователя", username, body)


async def test_intake_idempotency_throttle_and_concurrent_users(engine):
    service = SupportService(engine, 900)
    one, replay = await asyncio.gather(ticket(service), ticket(service))
    assert one == replay
    with pytest.raises(SupportError, match="минуту"):
        await ticket(service, message=2)
    await ticket(service, user=43, username=None)
    async with service.sessions.begin() as session:
        row = await session.get(SupportTicket, one)
        assert (row.target_id, row.name, row.body) == (
            900,
            "Имя Пользователя",
            "Не открывается календарь",
        )
        assert await session.scalar(select(func.count()).select_from(SupportTicket)) == 2
        row.created_at -= timedelta(minutes=2)
    await ticket(service, message=2)
    async with service.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(SupportTicket)) == 3
    # Separate messages submitted concurrently cannot bypass the per-user rate limit.
    results = await asyncio.gather(
        ticket(service, user=44, message=3),
        ticket(service, user=44, message=4),
        return_exceptions=True,
    )
    assert sum(isinstance(result, SupportError) for result in results) == 1


@pytest.mark.parametrize("body", ["", " \n ", "a" * 3001, "😀" * 1501])
async def test_validation_and_disabled(engine, body):
    with pytest.raises(SupportError, match="3000"):
        await ticket(SupportService(engine, 900), body=body)
    with pytest.raises(SupportError, match="не настроен"):
        await ticket(SupportService(engine, 0))


@pytest.mark.parametrize("user,message", [(0, 1), (-1, 1), (42, 0)])
async def test_invalid_identity(engine, user, message):
    with pytest.raises(SupportError, match="личного аккаунта"):
        await ticket(SupportService(engine, 900), user=user, message=message)


async def test_maximum_emoji_length_and_delivery_does_not_follow_new_target(engine):
    service = SupportService(engine, 900)
    key = await ticket(service, body="😀" * 1500)
    service.target_id = 901
    gateway = AsyncMock()
    delivery = SupportDelivery(engine, gateway)
    assert await delivery.once()
    assert not await delivery.once()
    job = gateway.send_support.call_args.args[0]
    assert job.target_id == 900 and job.id == key and len(job.body) == 1500
    async with service.sessions() as session:
        assert (await session.get(SupportTicket, key)).status == "sent"


@pytest.mark.parametrize(
    "error,status", [(DeliveryRejected(), "failed"), (DeliveryUnknown(), "unknown")]
)
async def test_delivery_failures_never_blindly_resend(engine, error, status, caplog):
    service = SupportService(engine, 900)
    key = await ticket(service)
    gateway = AsyncMock()
    gateway.send_support.side_effect = error
    delivery = SupportDelivery(engine, gateway)
    assert await delivery.once()
    assert not await delivery.once()
    async with service.sessions() as session:
        assert (await session.get(SupportTicket, key)).status == status
    gateway.send_support.assert_awaited_once()
    assert str(key) in caplog.text
    assert "Не открывается" not in caplog.text and "viewer" not in caplog.text


async def test_429_budget_and_delayed_retry(engine):
    service = SupportService(engine, 900)
    key = await ticket(service)
    gateway = AsyncMock()
    gateway.send_support.side_effect = Deferred(10)
    delivery = SupportDelivery(engine, gateway)
    for attempt in range(1, 4):
        assert await delivery.once()
        assert not await delivery.once()
        async with service.sessions.begin() as session:
            row = await session.get(SupportTicket, key)
            assert row.attempts == attempt
            assert row.status == ("pending" if attempt < 3 else "failed")
            assert row.next_attempt > datetime.now(UTC)
            row.next_attempt -= timedelta(seconds=20)
    assert not await delivery.once()


async def test_claim_exclusive_and_stale_lease_is_unknown(engine):
    service = SupportService(engine, 900)
    key = await ticket(service)
    delivery = SupportDelivery(engine, AsyncMock())
    first, second = await asyncio.gather(delivery.claim(), delivery.claim())
    job = first or second
    assert job is not None and (first is None or second is None)
    await delivery.finish(replace(job, lease=uuid4()), "sent")
    async with service.sessions.begin() as session:
        row = await session.get(SupportTicket, key)
        assert row.status == "sending"
        row.claimed_at -= timedelta(seconds=61)
    assert await delivery.claim() is None
    await delivery.finish(job, "sent")  # Late network completion cannot overwrite unknown.
    async with service.sessions() as session:
        assert (await session.get(SupportTicket, key)).status == "unknown"


async def test_gateway_plaintext_identity_and_exact_body():
    bot = AsyncMock()
    job = SupportJob(uuid4(), 900, 42, "User", "viewer", "<b>Не работает</b> 😀", uuid4())
    gateway = TelegramGateway(bot)
    await gateway.send_support(job)
    call = bot.send_message.call_args.kwargs
    assert call["chat_id"] == 900 and call["parse_mode"] is None
    assert call["text"].endswith(job.body)
    assert "@viewer" in call["text"] and "ID: 42" in call["text"]
    assert call["request_timeout"] == 10 and call["link_preview_options"].is_disabled
    await gateway.send_support(replace(job, username=None))
    assert "ник не указан" in bot.send_message.call_args.kwargs["text"]


@pytest.mark.parametrize("kind", ["rate", "rejected", "network", "timeout"])
async def test_gateway_error_mapping(kind):
    method = SendMessage(chat_id=900, text="x")
    errors = {
        "rate": (TelegramRetryAfter(method=method, message="limit", retry_after=2), Deferred),
        "rejected": (TelegramBadRequest(method=method, message="forbidden"), DeliveryRejected),
        "network": (TelegramNetworkError(method=method, message="private"), DeliveryUnknown),
        "timeout": (TimeoutError(), DeliveryUnknown),
    }
    error, expected = errors[kind]
    bot = AsyncMock()
    bot.send_message.side_effect = error
    with pytest.raises(expected):
        await TelegramGateway(bot).send_support(
            SupportJob(uuid4(), 900, 42, "User", None, "Проблема", uuid4())
        )


async def test_loop_shutdown(monkeypatch):
    delivery = SupportDelivery.__new__(SupportDelivery)
    delivery.once = AsyncMock(side_effect=[True, False])
    sleep = AsyncMock(side_effect=[None, asyncio.CancelledError])
    monkeypatch.setattr("planerbot.support.asyncio.sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await delivery.run()
    assert [call.args[0] for call in sleep.call_args_list] == [1, 2]


async def test_actual_intake_and_claim_query_plans(engine):
    service = SupportService(engine, 900)
    now = datetime.now(UTC)
    async with engine.begin() as connection:
        await connection.execute(
            insert(SupportTicket),
            [
                {
                    "id": uuid4(),
                    "user_id": n % 50 + 1,
                    "source_message_id": n + 1,
                    "target_id": 900,
                    "name": "Fixture",
                    "username": None,
                    "body": "Fixture",
                    "created_at": now - timedelta(minutes=2),
                    "next_attempt": now,
                    "status": "pending" if n < 5 else "sent",
                }
                for n in range(1000)
            ],
        )
        await connection.execute(text("ANALYZE support_tickets"))
    queries = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        if statement.startswith("SELECT") and "support_tickets" in statement:
            queries.append((statement, parameters))

    sql_event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        await ticket(service, user=777)
        assert await SupportDelivery(engine, AsyncMock()).claim() is not None
    finally:
        sql_event.remove(engine.sync_engine, "before_cursor_execute", capture)
    assert len(queries) == 3  # Source lookup, user's latest, one pending claim; no N+1.
    reports = []
    async with engine.connect() as connection:
        for label, (sql, parameters) in zip(["source", "latest", "claim"], queries, strict=True):
            raw = (
                await connection.exec_driver_sql(
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, parameters
                )
            ).scalar_one()
            plan = json.loads(raw) if isinstance(raw, str) else raw
            assert plan[0]["Plan"]["Actual Rows"] <= 1
            reports.append(
                {"query": label, "execution_ms": plan[0]["Execution Time"], "plan": plan[0]["Plan"]}
            )
    print("SUPPORT_QUERY_PLANS=" + json.dumps(reports))
