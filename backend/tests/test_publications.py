import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramServerError,
)
from aiogram.methods import SendMessage
from event_helpers import A, B, draft, services
from planerbot.access import AccessUnavailable
from planerbot.event_contracts import Conflict, MissingEvent
from planerbot.models import Publication
from planerbot.publications import (
    Delivery,
    DeliveryRejected,
    DeliveryUnknown,
    PublicationRepository,
)
from planerbot.telegram import TelegramGateway
from planerbot.worker import run_worker
from sqlalchemy import update


async def test_publish_update_during_delivery_and_retry(engine):
    service, _, _ = await services(engine)
    store = PublicationRepository(engine)
    assert await store.claim() is None
    request_key = uuid4()
    event = await service.create(42, A, draft(), request_key)
    job = await store.claim()
    assert job.event.id == event.id
    assert await store.claim() is None
    await service.change(42, A, event.id, 1, data=draft(title="Новая встреча"))
    await store.finish(job, "published", 100)
    newer = await store.claim()
    assert newer.event.data.title == "Новая встреча" and newer.message_id == 100
    await store.finish(job, "failed")  # Old lease cannot change a new delivery.
    await store.finish(newer, "unknown")
    with pytest.raises(Conflict):
        await store.retry(A, event.id, False)
    await store.retry(A, event.id, True)
    retry = await store.claim()
    await store.finish(retry, "failed")
    await store.retry(A, event.id, False)
    retry = await store.claim()
    await store.finish(retry, "published", 100)
    with pytest.raises(Conflict):
        await store.retry(A, event.id, True)
    with pytest.raises(MissingEvent):
        await store.retry(B, event.id, True)
    with pytest.raises(MissingEvent):
        await store.retry(A, uuid4(), False)
    # Replayed create must not enqueue an already published event again.
    await service.create(42, A, draft(), request_key)
    assert await store.claim() is None


async def test_crashed_sending_becomes_unknown_without_resend(engine):
    service, _, _ = await services(engine)
    store = PublicationRepository(engine)
    event = await service.create(42, A, draft(), uuid4())
    job = await store.claim()
    async with store.sessions.begin() as session:
        await session.execute(
            update(Publication)
            .where(Publication.event_id == event.id)
            .values(claimed_at=datetime.now(UTC) - timedelta(seconds=61))
        )
    assert await store.claim() is None
    await store.finish(job, "published", 999)
    async with store.sessions() as session:
        item = await session.get(Publication, event.id)
        assert item.status == "unknown" and item.message_id is None
    await store.retry(A, event.id, True)
    assert await store.claim() is not None


@pytest.mark.parametrize(
    "error,state",
    [(None, "published"), (DeliveryRejected(), "failed"), (DeliveryUnknown(), "unknown")],
)
async def test_delivery_results(engine, error, state):
    service, _, _ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    gateway = AsyncMock()
    gateway.send_card.side_effect = error
    gateway.send_card.return_value = 123
    store = PublicationRepository(engine)
    worker = Delivery(store, service.access, gateway)
    assert await worker.once()
    assert not await worker.once()
    async with store.sessions() as session:
        publication = await session.get(Publication, event.id)
        assert publication.status == state


@pytest.mark.parametrize("scenario", ["left", "disabled", "outage", "cancel"])
async def test_preflight_and_cancel_before_first_send(engine, scenario):
    service, gateway, roles = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    if scenario == "left":
        roles[(A, 42)] = "left"
    elif scenario == "disabled":
        async with service.chats.sessions.begin() as session:
            from planerbot.models import Topic

            await session.execute(update(Topic).where(Topic.chat_id == A).values(enabled=False))
    elif scenario == "outage":
        gateway.membership.side_effect = AccessUnavailable
    else:
        await service.change(42, A, event.id, 1, action="cancel")
    telegram = AsyncMock()
    telegram.send_card.return_value = 123
    assert await Delivery(PublicationRepository(engine), service.access, telegram).once()
    if scenario == "cancel":
        assert telegram.send_card.call_args.args[0].status == "cancelled"
    else:
        telegram.send_card.assert_not_awaited()


async def test_run_loop_cancels(monkeypatch):
    worker = Delivery(AsyncMock(), AsyncMock(), AsyncMock())
    worker.once = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr(
        "planerbot.publications.asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)
    )
    with pytest.raises(asyncio.CancelledError):
        await worker.run()


async def test_telegram_card_and_error_classification(engine):
    service, _, _ = await services(engine)
    event = await service.create(
        42,
        A,
        draft(end_time="20:00", map_url="https://example.test/map", description="Описание"),
        uuid4(),
    )
    bot = AsyncMock()
    bot.send_message.return_value.message_id = 123
    gateway = TelegramGateway(bot)
    assert await gateway.send_card(event, None) == 123
    kwargs = bot.send_message.call_args.kwargs
    assert kwargs["message_thread_id"] == 10 and "Кафе" in kwargs["text"]
    assert "https://example.test/map" in kwargs["text"]
    assert await gateway.send_card(event, 123) == 123
    general = event.model_copy(
        update={"data": draft(topic_id=1, place_pending=True), "status": "cancelled"}
    )
    await gateway.send_card(general, None)
    assert bot.send_message.call_args.kwargs["message_thread_id"] is None
    assert "Отменено" in bot.send_message.call_args.kwargs["text"]
    method = SendMessage(chat_id=A, text="test")
    for error, expected in [
        (TelegramBadRequest(method=method, message="bad"), DeliveryRejected),
        (TelegramForbiddenError(method=method, message="forbidden"), DeliveryRejected),
        (TelegramNetworkError(method=method, message="network"), DeliveryUnknown),
        (TelegramServerError(method=method, message="server"), DeliveryUnknown),
        (TimeoutError(), DeliveryUnknown),
    ]:
        bot.send_message.side_effect = error
        with pytest.raises(expected):
            await gateway.send_card(event, None)
    bot.edit_message_text.side_effect = TelegramBadRequest(
        method=method, message="message is not modified"
    )
    assert await gateway.send_card(event, 123) == 123
    bot.edit_message_text.side_effect = TelegramBadRequest(method=method, message="deleted")
    with pytest.raises(DeliveryRejected):
        await gateway.send_card(event, 123)


async def test_worker_cleanup(monkeypatch):
    from conftest import TOKEN
    from planerbot.config import Settings

    with pytest.raises(ValueError, match="BOT_TOKEN"):
        await run_worker(Settings(_env_file=None, bot_token=""))
    bot, engine, delivery = AsyncMock(), AsyncMock(), AsyncMock()
    bot.id = 1
    delivery.run.side_effect = asyncio.CancelledError
    monkeypatch.setattr("planerbot.worker.Bot", lambda token: bot)
    monkeypatch.setattr("planerbot.worker.create_async_engine", lambda url, **kwargs: engine)
    monkeypatch.setattr("planerbot.worker.Delivery", lambda *args: delivery)
    with pytest.raises(asyncio.CancelledError):
        await run_worker(Settings(_env_file=None, bot_token=TOKEN))
    bot.session.close.assert_awaited_once()
    engine.dispose.assert_awaited_once()
