import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.exceptions import TelegramBadRequest, TelegramNetworkError, TelegramRetryAfter
from aiogram.methods import SendMessage
from planerbot.models import SupportReply, SupportTicket
from planerbot.notices import Deferred
from planerbot.publications import DeliveryRejected, DeliveryUnknown
from planerbot.support import SupportError, SupportService
from planerbot.support_replies import SupportReplyDelivery, SupportReplyJob, reply_text
from planerbot.telegram import TelegramGateway
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy import event as sql_event
from sqlalchemy.exc import IntegrityError


async def setup(engine, **kwargs):
    service = SupportService(engine, 900)
    ticket = await service.submit(42, 1, "User", "viewer", "Проблема")
    reply = await service.reply(900, 900, 10, ticket, kwargs.get("body", "Исправлено"))
    return service, ticket, reply


async def test_concurrent_replay_exact_target_and_plaintext_delivery(engine):
    service, ticket, key = await setup(engine, body="Ответ <b>без HTML</b>")
    results = await asyncio.gather(
        *[service.reply(900, 900, 10, ticket, "Ответ <b>без HTML</b>") for _ in range(3)]
    )
    assert results == [key] * 3
    # A different reply, even with the same text, is an intentional new answer.
    await service.reply(900, 900, 11, ticket, "Ответ <b>без HTML</b>")
    bot = AsyncMock()
    delivery = SupportReplyDelivery(engine, TelegramGateway(bot))
    assert await delivery.once() and await delivery.once()
    assert not await delivery.once()
    bot.send_message.assert_awaited()
    call = bot.send_message.call_args.kwargs
    assert bot.send_message.await_count == 2
    assert call["chat_id"] == 42 and call["parse_mode"] is None
    assert call["text"].startswith("Здравствуйте, @viewer!\n\nОтвет <b>без HTML</b>\n\n")
    assert call["text"].endswith("С уважением, команда поддержки planerBot.")
    assert "/support" in call["text"] and "900" not in call["text"]
    assert call["request_timeout"] == 10 and call["link_preview_options"].is_disabled
    bot.forward_message.assert_not_awaited()
    bot.copy_message.assert_not_awaited()
    async with service.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(SupportReply)) == 2
        assert (await session.get(SupportReply, key)).status == "sent"


@pytest.mark.parametrize("target,sender,chat", [(0, 900, 900), (900, 42, 42), (900, 900, -900)])
async def test_owner_authorization(engine, target, sender, chat):
    service = SupportService(engine, target)
    with pytest.raises(SupportError, match="Нет доступа"):
        await service.reply(sender, chat, 10, uuid4(), "Ответ")


@pytest.mark.parametrize("body", ["", " \n", "a" * 3001, "😀" * 1501])
async def test_reply_body_validation(engine, body):
    with pytest.raises(SupportError, match="3000"):
        await SupportService(engine, 900).reply(900, 900, 1, uuid4(), body)


async def test_missing_ticket_wrong_owner_source_and_replay_conflict(engine):
    service, ticket, key = await setup(engine)
    with pytest.raises(SupportError, match="карточку"):
        await service.reply(900, 900, 0, ticket, "Ответ")
    with pytest.raises(SupportError, match="Обращение не найдено"):
        await service.reply(900, 900, 11, uuid4(), "Ответ")
    with pytest.raises(SupportError, match="Обращение не найдено"):
        await SupportService(engine, 901).reply(901, 901, 11, ticket, "Ответ")
    with pytest.raises(SupportError, match="уже использовано"):
        await service.reply(900, 900, 10, ticket, "Подмена текста")
    other = await service.submit(43, 1, "Other", None, "Другое обращение")
    with pytest.raises(SupportError, match="уже использовано"):
        await service.reply(900, 900, 10, other, "Исправлено")
    async with service.sessions() as session:
        assert (await session.get(SupportReply, key)).body == "Исправлено"
        assert await session.scalar(select(func.count()).select_from(SupportReply)) == 1


@pytest.mark.parametrize(
    "error,status", [(DeliveryRejected(), "failed"), (DeliveryUnknown(), "unknown")]
)
async def test_terminal_failures_not_retried_and_no_body_in_logs(engine, error, status, caplog):
    service, _, key = await setup(engine)
    gateway = AsyncMock()
    gateway.send_support_reply.side_effect = error
    delivery = SupportReplyDelivery(engine, gateway)
    assert await delivery.once() and not await delivery.once()
    gateway.send_support_reply.assert_awaited_once()
    async with service.sessions() as session:
        assert (await session.get(SupportReply, key)).status == status
    assert str(key) in caplog.text
    assert "Исправлено" not in caplog.text and "viewer" not in caplog.text


async def test_retry_budget_and_exclusive_claim_and_late_completion(engine):
    service, _, key = await setup(engine)
    gateway = AsyncMock()
    gateway.send_support_reply.side_effect = Deferred(10)
    delivery = SupportReplyDelivery(engine, gateway)
    for attempt in range(1, 4):
        assert await delivery.once() and not await delivery.once()
        async with service.sessions.begin() as session:
            row = await session.get(SupportReply, key)
            assert row.attempts == attempt
            assert row.status == ("pending" if attempt < 3 else "failed")
            assert row.next_attempt > datetime.now(UTC)
            row.next_attempt -= timedelta(seconds=20)
    assert not await delivery.once()
    second = await service.reply(900, 900, 12, (await setup_other(service)), "Ответ")
    a, b = await asyncio.gather(delivery.claim(), delivery.claim())
    job = a or b
    assert job and (a is None or b is None)
    await delivery.finish(replace(job, lease=uuid4()), "sent")
    async with service.sessions.begin() as session:
        row = await session.get(SupportReply, second)
        assert row.status == "sending"
        row.claimed_at -= timedelta(seconds=61)
    assert await delivery.claim() is None
    await delivery.finish(job, "sent")
    async with service.sessions() as session:
        assert (await session.get(SupportReply, second)).status == "unknown"


async def setup_other(service):
    return await service.submit(43, 1, "Another", None, "Проблема")


@pytest.mark.parametrize(
    "username,name,greeting",
    [
        ("viewer", "User", "Здравствуйте, @viewer!"),
        (None, "User\nName", "Здравствуйте, User Name!"),
        (None, " ", "Здравствуйте!"),
    ],
)
def test_template_fallback_and_utf16_budget(username, name, greeting):
    job = SupportReplyJob(uuid4(), uuid4(), 42, name, username, "😀" * 1500, uuid4())
    value = reply_text(job)
    assert value.startswith(greeting + "\n\n")
    assert job.body in value and "замеченные дефекты" in value and "/support" in value
    assert len(value.encode("utf-16-le")) // 2 < 4096


@pytest.mark.parametrize("kind", ["rate", "rejected", "network", "timeout"])
async def test_reply_gateway_error_mapping(kind):
    method = SendMessage(chat_id=42, text="x")
    errors = {
        "rate": (TelegramRetryAfter(method=method, message="limit", retry_after=2), Deferred),
        "rejected": (TelegramBadRequest(method=method, message="blocked"), DeliveryRejected),
        "network": (TelegramNetworkError(method=method, message="private"), DeliveryUnknown),
        "timeout": (TimeoutError(), DeliveryUnknown),
    }
    error, expected = errors[kind]
    bot = AsyncMock()
    bot.send_message.side_effect = error
    with pytest.raises(expected):
        await TelegramGateway(bot).send_support_reply(
            SupportReplyJob(uuid4(), uuid4(), 42, "User", None, "Ответ", uuid4())
        )


async def test_loop_shutdown(monkeypatch):
    delivery = SupportReplyDelivery.__new__(SupportReplyDelivery)
    delivery.once = AsyncMock(side_effect=[True, False])
    sleep = AsyncMock(side_effect=[None, asyncio.CancelledError])
    monkeypatch.setattr("planerbot.support_replies.asyncio.sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await delivery.run()
    assert [call.args[0] for call in sleep.call_args_list] == [1, 2]


@pytest.mark.parametrize(
    "changes",
    [
        {"body": ""},
        {"sender_id": -1},
        {"source_message_id": 0},
        {"attempts": -1},
        {"status": "wrong"},
        {"ticket_id": uuid4()},
    ],
)
async def test_reply_constraints_and_rollback(engine, changes):
    service, ticket, _ = await setup(engine)
    with pytest.raises(IntegrityError):
        async with service.sessions.begin() as session:
            values = dict(
                id=uuid4(),
                ticket_id=ticket,
                sender_id=900,
                source_message_id=50,
                body="Ответ",
                created_at=datetime.now(UTC),
                status="pending",
                next_attempt=datetime.now(UTC),
            )
            values.update(changes)
            session.add(SupportReply(**values))
    async with service.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(SupportReply)) == 1
    async with service.sessions.begin() as session:
        await session.execute(delete(SupportTicket).where(SupportTicket.id == ticket))
    assert not await SupportReplyDelivery(engine, AsyncMock()).once()


async def test_actual_replay_and_claim_query_plans(engine):
    service, ticket, _ = await setup(engine)
    now = datetime.now(UTC)
    async with engine.begin() as connection:
        await connection.execute(
            insert(SupportReply),
            [
                {
                    "id": uuid4(),
                    "ticket_id": ticket,
                    "sender_id": 900,
                    "source_message_id": n + 100,
                    "body": "Fixture",
                    "created_at": now,
                    "next_attempt": now,
                    "status": "pending" if n < 5 else "sent",
                }
                for n in range(1000)
            ],
        )
        await connection.execute(text("ANALYZE support_replies"))
    queries = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        if statement.startswith("SELECT") and (
            "support_replies" in statement or "support_tickets" in statement
        ):
            queries.append((statement, parameters))

    sql_event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        await service.reply(900, 900, 10, ticket, "Исправлено")
        assert await SupportReplyDelivery(engine, AsyncMock()).claim() is not None
    finally:
        sql_event.remove(engine.sync_engine, "before_cursor_execute", capture)
    assert len(queries) == 4  # Ticket PK, unique source replay, bounded claim, ticket PK.
    reports = []
    async with engine.connect() as connection:
        for label, (sql, params) in zip(
            ["owner-ticket", "source", "claim", "recipient-ticket"], queries, strict=True
        ):
            raw = (
                await connection.exec_driver_sql(
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params
                )
            ).scalar_one()
            plan = json.loads(raw) if isinstance(raw, str) else raw
            assert plan[0]["Plan"]["Actual Rows"] <= 1
            reports.append(
                {"query": label, "execution_ms": plan[0]["Execution Time"], "plan": plan[0]["Plan"]}
            )
    print("SUPPORT_REPLY_QUERY_PLANS=" + json.dumps(reports))
