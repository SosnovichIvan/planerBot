import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from conftest import TOKEN, signed
from event_helpers import A, B, draft, services
from httpx import ASGITransport, AsyncClient
from planerbot.access import AccessDenied, AccessUnavailable
from planerbot.api import create_app
from planerbot.auth import Viewer
from planerbot.config import Settings
from planerbot.event_contracts import Conflict, MissingEvent
from planerbot.models import (
    Event,
    EventResponse,
    PersonalNotice,
    Topic,
)
from planerbot.notices import Deferred, NoticeDelivery
from planerbot.publications import DeliveryRejected, DeliveryUnknown
from planerbot.rsvp import CampaignInput, RsvpService
from sqlalchemy import func, select, update


async def setup(engine):
    service, gateway, roles = await services(engine)
    rsvp = RsvpService(engine, service.access)
    admin = Viewer(id=42, first_name="Админ", allows_write_to_pm=True)
    member = Viewer(id=43, first_name="Участник", allows_write_to_pm=True)
    await rsvp.visit(admin)
    await rsvp.visit(member)
    event = await service.create(42, A, draft(), uuid4())
    return service, gateway, roles, rsvp, admin, member, event


async def test_private_ballot_and_audience(engine):
    service, _, roles, rsvp, admin, member, event = await setup(engine)
    assert (await rsvp.detail(admin, A, event.id)).counts is None
    assert (await rsvp.detail(member, A, event.id)).counts is None
    result = await rsvp.detail(member, A, event.id, "no")
    assert result.counts.model_dump() == {"yes": 0, "no": 1, "unanswered": 1}
    assert not result.event.can_manage and result.event.my_response == "no"
    # Another person's vote does not reveal results to an administrator.
    assert (await rsvp.detail(admin, A, event.id)).counts is None
    yes = await rsvp.detail(admin, A, event.id, "yes")
    assert yes.counts.yes == 1 and yes.counts.no == 1
    assert (await rsvp.detail(admin, A, event.id, "unanswered")).counts is None
    await asyncio.gather(
        rsvp.detail(admin, A, event.id, "yes"), rsvp.detail(admin, A, event.id, "no")
    )
    async with rsvp.sessions() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(EventResponse).where(EventResponse.user_id == 42)
            )
            == 1
        )
    month = await service.list(
        43, draft().start_date, draft(start_date="2026-11-01").start_date, A, None, None
    )
    assert month.events[0].my_response == "no"
    with pytest.raises(AccessDenied):
        await rsvp.detail(member, B, event.id)
    with pytest.raises(MissingEvent):
        await rsvp.detail(admin, B, event.id)
    roles[(A, 43)] = "left"
    with pytest.raises(AccessDenied):
        await rsvp.detail(member, A, event.id)
    await rsvp.remove(A, 43)
    assert (await rsvp.detail(admin, A, event.id)).counts.no == 1
    await rsvp.contact(42, False)
    await rsvp.visit(admin)
    assert not (await rsvp.detail(admin, A, event.id)).personal_messages_enabled
    async with rsvp.sessions.begin() as session:
        await session.execute(update(Event).where(Event.id == event.id).values(status="pending"))
        await session.execute(
            update(Topic).where(Topic.chat_id == A, Topic.thread_id == 10).values(enabled=False)
        )
    roles[(A, 43)] = "member"
    with pytest.raises(AccessDenied):
        await rsvp.detail(member, A, event.id)
    with pytest.raises(Conflict):
        await rsvp.detail(admin, A, event.id, "yes")


async def test_campaign_snapshots_permissions_replay_and_new_event(engine):
    service, _, roles, rsvp, admin, member, event = await setup(engine)
    data, key = CampaignInput(audience="unanswered", text="Ответьте, пожалуйста"), uuid4()
    with pytest.raises(AccessDenied):
        await rsvp.campaign(admin, A, event.id, key, data)
    await rsvp.detail(admin, A, event.id, "yes")
    with pytest.raises(AccessDenied):
        await rsvp.campaign(member, A, event.id, key, data)
    first, second = await asyncio.gather(
        *(rsvp.campaign(admin, A, event.id, key, data) for _ in range(2))
    )
    assert first.id == second.id
    assert (await rsvp.campaign_status(admin, A, event.id, first.id)).statuses == {"pending": 1}
    with pytest.raises(Conflict):
        await rsvp.campaign(
            admin, A, event.id, key, data.model_copy(update={"text": "Другой текст"})
        )
    with pytest.raises(MissingEvent):
        await rsvp.campaign_status(admin, A, event.id, uuid4())
    with pytest.raises(MissingEvent):
        await rsvp.campaign_status(admin, B, event.id, first.id)
    await rsvp.detail(admin, A, event.id, "unanswered")
    with pytest.raises(AccessDenied):
        await rsvp.campaign_status(admin, A, event.id, first.id)
    invite_key = uuid4()
    invited = await service.create(42, A, draft(notify_members=True), invite_key)
    await service.create(42, A, draft(notify_members=True), invite_key)
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 3
        stored = await session.get(Event, invited.id)
        assert "notify_members" not in stored.payload
    await service.change(42, A, invited.id, 1, data=draft(title="Изменено"))
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 3
    await rsvp.detail(admin, A, event.id, "yes")
    await service.change(42, A, event.id, 1, action="cancel")
    with pytest.raises(Conflict):
        await rsvp.campaign(admin, A, event.id, uuid4(), data)
    roles[(A, 42)] = "member"
    with pytest.raises(AccessDenied):
        await rsvp.campaign(admin, A, invited.id, uuid4(), data)


async def test_http_contracts_and_hidden_statistics(engine):
    service, gateway, _, rsvp, admin, _, event = await setup(engine)
    app = create_app(
        Settings(_env_file=None, bot_token=TOKEN),
        engine=engine,
        access=service.access,
        event_service=service,
    )
    path = f"/api/chats/{A}/events/{event.id}"
    headers = {"Authorization": "tma " + signed(), "Idempotency-Key": str(uuid4())}
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        assert (await client.get(path)).status_code == 401
        assert (await client.post("/api/calendar/visit", headers=headers)).status_code == 204
        assert (await client.get(path, headers=headers)).json()["counts"] is None
        assert (
            await client.put(path + "/response", headers=headers, json={"answer": "maybe"})
        ).status_code == 422
        assert (
            await client.put(
                path + "/response", headers=headers, json={"answer": "yes", "user_id": 43}
            )
        ).status_code == 422
        vote = await client.put(path + "/response", headers=headers, json={"answer": "yes"})
        assert vote.status_code == 200 and vote.json()["counts"]["yes"] == 1
        campaign = await client.post(
            path + "/campaigns", headers=headers, json={"audience": "no", "text": "До встречи"}
        )
        assert campaign.status_code == 200
        status = await client.get(path + "/campaigns/" + campaign.json()["id"], headers=headers)
        assert status.status_code == 200 and status.json()["statuses"] == {}
        assert (
            await client.delete("/api/calendar/notifications", headers=headers)
        ).status_code == 204
        gateway.membership.side_effect = AccessUnavailable
        assert (await client.get(path, headers=headers)).status_code == 503
    await rsvp.contact(admin.id, False)


async def test_telegram_personal_payload_and_errors(engine):
    from aiogram.exceptions import TelegramBadRequest, TelegramNetworkError, TelegramRetryAfter
    from aiogram.methods import SendMessage
    from planerbot.telegram import TelegramGateway

    service, *_ = await services(engine)
    event = await service.create(42, A, draft(), uuid4())
    bot = AsyncMock()
    bot.get_me.return_value.username = "calendar_bot"
    gateway = TelegramGateway(bot)
    await gateway.send_personal(43, event, "Напоминание")
    sent = bot.send_message.call_args.kwargs
    assert sent["chat_id"] == 43 and event.data.title in sent["text"]
    assert event.data.place in sent["text"]
    assert sent["reply_markup"].inline_keyboard[0][0].url.endswith(f"event_{A}_{event.id.hex}")
    long = event.model_copy(
        update={
            "chat_title": "😀" * 256,
            "data": draft(title="😀" * 120, place="😀" * 120, address="😀" * 300),
        }
    )
    await gateway.send_personal(43, long, "😀" * 1500)
    assert len(bot.send_message.call_args.kwargs["text"].encode("utf-16-le")) // 2 <= 4096
    method = SendMessage(chat_id=43, text="test")
    for error, expected in [
        (TelegramBadRequest(method=method, message="blocked"), DeliveryRejected),
        (TelegramNetworkError(method=method, message="network"), DeliveryUnknown),
        (TimeoutError(), DeliveryUnknown),
        (TelegramRetryAfter(method=method, message="slow down", retry_after=12), Deferred),
    ]:
        bot.send_message.side_effect = error
        with pytest.raises(expected):
            await gateway.send_personal(43, event, "Напоминание")


async def test_bot_personal_consent_and_departure_updates():
    from aiogram.types import Update
    from planerbot.bot import create_dispatcher
    from test_bot import bot_stub
    from test_bot import update as message_update
    from test_onboarding import membership_update

    rsvp, bot = AsyncMock(), bot_stub()
    dispatcher = create_dispatcher(AsyncMock(), AsyncMock(), rsvp=rsvp)
    for command, enabled in [("/start", True), ("/stop", False)]:
        await dispatcher.feed_update(bot, message_update(command, chat_type="private"))
        assert rsvp.contact.call_args.args == (42, enabled)
    rsvp.contact.reset_mock()
    await dispatcher.feed_update(bot, message_update("/calendar", chat_type="private"))
    rsvp.contact.assert_not_awaited()
    payload = message_update("ignored", chat_type="private").model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    payload["message"].pop("text")
    payload["message"].pop("entities")
    payload["message"]["write_access_allowed"] = {"from_request": True}
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    rsvp.contact.assert_awaited_with(42, True)
    payload["message"].pop("from")
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    await dispatcher.feed_update(bot, message_update("/stop", chat_type="private", sender=False))
    payload = membership_update("left").model_dump(mode="json", by_alias=True, exclude_none=True)
    payload["chat_member"] = payload.pop("my_chat_member")
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    rsvp.remove.assert_awaited_once()
    payload["chat_member"]["new_chat_member"]["status"] = "member"
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    rsvp.remove.assert_awaited_once()
    private = membership_update("member", chat_type="private").model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    private["my_chat_member"]["new_chat_member"]["status"] = "kicked"
    private["my_chat_member"]["new_chat_member"]["until_date"] = 0
    await dispatcher.feed_update(bot, Update.model_validate(private))
    rsvp.contact.assert_awaited_with(-1, False)


@pytest.mark.parametrize(
    "outcome",
    [
        "sent",
        "declined",
        "missing_permission",
        "left",
        "outage",
        "rate_limit",
        "failed",
        "unknown",
        "cancelled",
        "disabled_topic",
    ],
)
async def test_personal_delivery_rechecks_and_classifies(engine, outcome):
    service, gateway, roles, rsvp, admin, member, event = await setup(engine)
    await rsvp.detail(admin, A, event.id, "yes")
    campaign = await rsvp.campaign(
        admin, A, event.id, uuid4(), CampaignInput(audience="unanswered", text="Напоминание")
    )
    telegram = AsyncMock()
    delivery = NoticeDelivery(engine, service.access, telegram)
    if outcome == "declined":
        await rsvp.detail(member, A, event.id, "no")
    if outcome == "missing_permission":
        await rsvp.contact(member.id, False)
    if outcome == "left":
        roles[(A, 43)] = "left"
    if outcome == "outage":
        gateway.membership.side_effect = AccessUnavailable
    if outcome == "rate_limit":
        telegram.send_personal.side_effect = Deferred(12)
    if outcome == "failed":
        telegram.send_personal.side_effect = DeliveryRejected
    if outcome == "unknown":
        telegram.send_personal.side_effect = DeliveryUnknown
    if outcome == "cancelled":
        await service.change(42, A, event.id, 1, action="cancel")
    if outcome == "disabled_topic":
        async with rsvp.sessions.begin() as session:
            await session.execute(
                update(Topic).where(Topic.chat_id == A, Topic.thread_id == 10).values(enabled=False)
            )
    assert await delivery.once()
    async with rsvp.sessions() as session:
        notice = await session.get(PersonalNotice, (campaign.id, 43))
        expected = {
            "outage": "pending",
            "rate_limit": "pending",
            "failed": "failed",
            "unknown": "unknown",
            "sent": "sent",
        }.get(outcome, "skipped")
        assert notice.status == expected
    assert not await delivery.once()
    if outcome == "sent":
        telegram.send_personal.assert_awaited_once()
    if outcome in {
        "declined",
        "missing_permission",
        "left",
        "outage",
        "cancelled",
        "disabled_topic",
    }:
        telegram.send_personal.assert_not_awaited()


async def test_expired_leases_retry_budget_and_late_completion(engine):
    service, _, _, rsvp, admin, _, event = await setup(engine)
    await rsvp.detail(admin, A, event.id, "yes")
    campaign = await rsvp.campaign(
        admin, A, event.id, uuid4(), CampaignInput(audience="unanswered", text="Ответьте")
    )
    delivery = NoticeDelivery(engine, service.access, AsyncMock())
    job = await delivery.claim()
    async with rsvp.sessions.begin() as session:
        await session.execute(
            update(PersonalNotice).values(claimed_at=datetime.now(UTC) - timedelta(minutes=5))
        )
    assert await delivery.claim() is None
    await delivery.finish(job, "sent")
    assert (await rsvp.campaign_status(admin, A, event.id, campaign.id)).statuses == {"unknown": 1}
    async with rsvp.sessions.begin() as session:
        await session.execute(update(PersonalNotice).values(status="pending", attempts=4))
    job = await delivery.claim()
    await delivery.finish(job, "pending", 20)
    assert (await rsvp.campaign_status(admin, A, event.id, campaign.id)).statuses == {"failed": 1}
    assert Deferred(-1).seconds == 1 and Deferred(99999).seconds == 3600


async def test_notice_loop_is_cancellable(monkeypatch):
    worker = NoticeDelivery.__new__(NoticeDelivery)
    worker.once = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "planerbot.notices.asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)
    )
    with pytest.raises(asyncio.CancelledError):
        await worker.run()
