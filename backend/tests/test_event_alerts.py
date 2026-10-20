from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.types import Update
from conftest import TOKEN, signed
from event_helpers import STAMP, A, B, draft, services
from httpx import ASGITransport, AsyncClient
from planerbot.access import AccessDenied, AccessUnavailable
from planerbot.api import create_app
from planerbot.auth import Viewer
from planerbot.bot import create_dispatcher
from planerbot.campaigns import invitation_id
from planerbot.config import Settings
from planerbot.event_contracts import Conflict, MissingEvent
from planerbot.models import CalendarParticipant, EventResponse, MessageCampaign, PersonalNotice
from planerbot.notices import NoticeDelivery
from planerbot.rsvp import RsvpService
from sqlalchemy import func, select
from test_bot import bot_stub
from test_bot import update as message_update


async def audience(engine):
    service, gateway, roles = await services(engine)
    rsvp = RsvpService(engine, service.access)
    await rsvp.observe(A, 43, "Мария")
    await rsvp.contact(43, True)
    return service, gateway, roles, rsvp


@pytest.mark.parametrize("source", ["form", "bot", "message"])
@pytest.mark.parametrize("notify", [False, True])
async def test_automatic_invitation_is_atomic_once_for_all_sources(engine, source, notify):
    service, _, _, rsvp = await audience(engine)
    key = uuid4()
    for _ in range(2):
        event = await service.events.create(
            A, 42, draft(notify_members=notify), "UTC", key, source=source
        )
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 1
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 1
        assert await session.get(PersonalNotice, (invitation_id(event.id), 43))
    await service.change(42, A, event.id, 1, data=draft(title="Другое название"))
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 1


@pytest.mark.parametrize("activate", ["approve", "import"])
async def test_pending_event_invites_only_on_activation(engine, activate):
    service, _, _, rsvp = await audience(engine)
    event = await service.events.create(
        A, 42, draft(), "UTC", uuid4(), status="pending", source="message", source_date=STAMP
    )
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 0
    if activate == "approve":
        await service.change(42, A, event.id, event.version, action="approve")
    else:
        from datetime import timedelta

        await service.events.create(
            A,
            42,
            draft(),
            "UTC",
            event.id,
            source="message",
            source_date=STAMP + timedelta(minutes=1),
        )
    async with rsvp.sessions() as session:
        assert await session.get(PersonalNotice, (invitation_id(event.id), 43))


@pytest.mark.parametrize("outcome", ["sent", "stop", "left", "cancelled", "sender_left"])
async def test_new_event_private_delivery_rechecks_recipient_not_former_admin(engine, outcome):
    service, _, roles, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    if outcome == "stop":
        await rsvp.contact(43, False)
    elif outcome == "left":
        roles[(A, 43)] = "left"
    elif outcome == "sender_left":
        roles[(A, 42)] = "left"
    elif outcome == "cancelled":
        await service.change(42, A, event.id, 1, action="cancel")
    gateway = AsyncMock()
    delivery = NoticeDelivery(engine, service.access, gateway)
    assert await delivery.once()
    assert not await delivery.once()
    if outcome in {"sent", "sender_left"}:
        gateway.send_personal.assert_awaited_once()
        assert gateway.send_personal.call_args.args[0] == 43
        assert gateway.send_personal.call_args.args[1].id == event.id
    else:
        gateway.send_personal.assert_not_awaited()


async def test_unanswered_is_scoped_private_and_author_can_read_without_vote(engine):
    service, _, roles, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    admin, member = Viewer(id=42, first_name="Автор"), Viewer(id=43, first_name="Мария")
    assert (await rsvp.detail(admin, A, event.id)).can_view_unanswered
    assert (await rsvp.detail(admin, A, event.id)).counts is None
    assert not (await rsvp.detail(member, A, event.id)).can_view_unanswered
    with pytest.raises(AccessDenied):
        await rsvp.unanswered(member, A, event.id)
    roles[(A, 42)] = "member"
    page = await rsvp.unanswered(admin, A, event.id)
    assert [(p.user_id, p.name) for p in page.participants] == [
        ("42", "Автор"),
        ("43", "Мария"),
    ]
    roles[(A, 44)] = "administrator"
    assert (
        await rsvp.unanswered(Viewer(id=44, first_name="Другой админ"), A, event.id)
    ).participants
    with pytest.raises(AccessDenied):
        await service.change(42, A, event.id, 1, action="cancel")
    roles[(A, 42)] = "left"
    with pytest.raises(AccessDenied):
        await rsvp.unanswered(admin, A, event.id)
    with pytest.raises(MissingEvent):
        await rsvp.unanswered(Viewer(id=44, first_name="Админ"), A, uuid4())
    with pytest.raises(AccessDenied):
        await rsvp.unanswered(member, B, event.id)


async def test_roster_cursor_skips_departed_voted_and_other_chat(engine):
    service, _, roles, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    for user_id in range(100, 152):
        roles[(A, user_id)] = "member"
        await rsvp.observe(A, user_id, f"Участник {user_id}")
    await rsvp.observe(B, 99, "Другой чат")
    roles[(A, 43)] = "left"
    await rsvp.detail(Viewer(id=100, first_name="Участник 100"), A, event.id, "yes")
    page = await rsvp.unanswered(Viewer(id=42, first_name="Автор"), A, event.id)
    assert len(page.participants) == 49
    assert page.next_cursor == "149"
    assert page.participants[0].user_id == "101"
    last = await rsvp.unanswered(Viewer(id=42, first_name="Автор"), A, event.id, 149)
    assert [p.user_id for p in last.participants] == ["150", "151"]
    assert last.next_cursor is None
    assert not (
        await rsvp.unanswered(Viewer(id=42, first_name="Автор"), A, event.id, 999)
    ).participants


async def test_roster_rechecks_votes_after_network_and_propagates_outage(engine):
    service, gateway, _, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    original = gateway.membership.side_effect

    async def membership(chat_id, user_id):
        if user_id == 43:
            async with rsvp.sessions.begin() as session:
                session.add(EventResponse(event_id=event.id, user_id=43, answer="no"))
        return await original(chat_id, user_id)

    gateway.membership.side_effect = membership
    admin = Viewer(id=42, first_name="Автор")
    assert not (await rsvp.unanswered(admin, A, event.id)).participants
    gateway.membership.side_effect = AccessUnavailable
    with pytest.raises(AccessUnavailable):
        await rsvp.unanswered(admin, A, event.id)


async def test_roster_http_auth_scope_validation_and_cancelled(engine):
    service, _, _, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    app = create_app(
        Settings(bot_token=TOKEN), access=service.access, engine=engine, bot=bot_stub()
    )
    url = f"/api/chats/{A}/events/{event.id}/unanswered"
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        assert (await client.get(url)).status_code == 401
        headers = {"Authorization": f"tma {signed()}"}
        response = await client.get(url, headers=headers)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["participants"] == [{"user_id": "43", "name": "Мария"}]
        assert (await client.get(url + "?after=-1", headers=headers)).status_code == 422
        assert (
            await client.get(url, headers={"Authorization": f"tma {signed(user_id=43)}"})
        ).status_code == 403
        await service.change(42, A, event.id, 1, action="cancel")
        assert (await client.get(url, headers=headers)).status_code == 409
        with pytest.raises(Conflict):
            await rsvp.unanswered(Viewer(id=42, first_name="Автор"), A, event.id)


async def test_observed_chat_messages_register_participants_without_opting_them_in(engine):
    service, gateway, _, rsvp = await audience(engine)
    dispatcher = create_dispatcher(service.chats, gateway, service, rsvp)
    payload = message_update("Обычное сообщение").model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    payload["message"]["chat"]["id"] = A
    payload["message"]["entities"] = []
    await dispatcher.feed_update(bot_stub(), Update.model_validate(payload))
    await rsvp.observe(A, 42, "Новое имя")
    async with rsvp.sessions() as session:
        assert (await session.get(CalendarParticipant, (A, 42))).name == "Новое имя"


async def test_dispatcher_import_to_database_worker_and_telegram_adapter_is_once(engine):
    from aiogram.methods import SendMessage
    from planerbot.telegram import TelegramGateway

    service, gateway, _, rsvp = await audience(engine)
    bot = bot_stub()
    dispatcher = create_dispatcher(service.chats, gateway, service, rsvp)
    payload = message_update(
        "#событие\nНазвание: Приглашение\nДата: 2026-10-20\nМесто: Парк"
    ).model_dump(mode="json", by_alias=True, exclude_none=True)
    payload["message"]["chat"]["id"] = A
    payload["message"]["entities"] = []
    for _ in range(2):
        await dispatcher.feed_update(bot, Update.model_validate(payload))
    delivery = NoticeDelivery(engine, service.access, TelegramGateway(bot))
    assert await delivery.once()  # observer records author 42, no private consent
    assert await delivery.once()  # consenting member 43
    assert not await delivery.once()
    sent = [
        call.args[1]
        for call in bot.session.call_args_list
        if isinstance(call.args[1], SendMessage) and call.args[1].chat_id == 43
    ]
    assert len(sent) == 1
    assert "Приглашение" in sent[0].text
    assert "Новое событие" in sent[0].text
    assert (
        sent[0]
        .reply_markup.inline_keyboard[0][0]
        .url.startswith("https://t.me/planer_test_bot?startapp=event_")
    )


async def test_membership_updates_observe_real_members_of_registered_chats(engine):
    from test_onboarding import membership_update

    service, gateway, _, rsvp = await audience(engine)
    payload = membership_update("member").model_dump(mode="json", by_alias=True, exclude_none=True)
    event = payload.pop("my_chat_member")
    event["chat"]["id"] = A
    for item in ("old_chat_member", "new_chat_member"):
        event[item]["user"] = {"id": 44, "is_bot": False, "first_name": "Ирина"}
    payload["chat_member"] = event
    dispatcher = create_dispatcher(service.chats, gateway, service, rsvp)
    await dispatcher.feed_update(bot_stub(), Update.model_validate(payload))
    async with rsvp.sessions() as session:
        assert (await session.get(CalendarParticipant, (A, 44))).name == "Ирина"


@pytest.mark.parametrize("change", ["revoke_admin", "cancel", "disable_topic"])
async def test_roster_does_not_leak_after_permissions_or_state_change_during_lookup(engine, change):
    from planerbot.models import Topic
    from sqlalchemy import update

    service, gateway, roles, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    roles[(A, 44)] = "administrator"
    original = gateway.membership.side_effect

    async def membership(chat_id, user_id):
        if user_id == 43:
            if change == "revoke_admin":
                roles[(A, 44)] = "member"
            elif change == "cancel":
                await service.events.change(A, event.id, 42, 1, action="cancel")
            else:
                async with rsvp.sessions.begin() as session:
                    await session.execute(
                        update(Topic)
                        .where(
                            Topic.chat_id == A,
                            Topic.thread_id == 10,
                        )
                        .values(enabled=False)
                    )
        return await original(chat_id, user_id)

    gateway.membership.side_effect = membership
    with pytest.raises(Conflict if change == "cancel" else AccessDenied):
        await rsvp.unanswered(Viewer(id=44, first_name="Админ"), A, event.id)


async def test_roster_actual_sql_plan_is_bounded_on_synthetic_audience(engine):
    import json

    from sqlalchemy import event as sql_event
    from sqlalchemy import insert, text

    service, _, roles, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    async with engine.begin() as connection:
        await connection.execute(
            insert(CalendarParticipant),
            [
                {"chat_id": A, "user_id": user_id, "name": "Synthetic"}
                for user_id in range(1000, 2000)
            ],
        )
        await connection.execute(text("ANALYZE calendar_participants"))
    roles.update({(A, user_id): "member" for user_id in range(1000, 2000)})
    queries = []
    selects = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        if statement.startswith("SELECT"):
            selects.append(statement)
        if statement.startswith("SELECT") and "calendar_participants" in statement:
            queries.append((statement, parameters))

    sql_event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        page = await rsvp.unanswered(Viewer(id=42, first_name="Админ"), A, event.id)
    finally:
        sql_event.remove(engine.sync_engine, "before_cursor_execute", capture)
    assert len(page.participants) == 50 and page.next_cursor is not None
    assert len(queries) == 1
    assert len(selects) <= 10  # Fixed page query count, not a SELECT per participant.
    print("ROSTER_SQL_COUNT=" + str(len(selects)))
    sql, params = queries[0]
    async with engine.connect() as connection:
        raw = (
            await connection.exec_driver_sql(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql,
                params,
            )
        ).scalar_one()
    plan = json.loads(raw) if isinstance(raw, str) else raw
    assert plan[0]["Plan"]["Actual Rows"] == 51
    print("ROSTER_QUERY_PLAN=" + json.dumps(plan))


async def test_roster_page_deadline_is_reported_as_access_unavailable(engine):
    from unittest.mock import patch

    service, _, _, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    with patch("planerbot.rsvp.asyncio.timeout", side_effect=TimeoutError):
        with pytest.raises(AccessUnavailable):
            await rsvp.unanswered(Viewer(id=42, first_name="Админ"), A, event.id)


async def test_roster_cancellation_stops_in_flight_membership_work(engine):
    import asyncio

    service, gateway, _, rsvp = await audience(engine)
    event = await service.create(42, A, draft(), uuid4())
    entered, stopped = asyncio.Event(), asyncio.Event()
    original = gateway.membership.side_effect

    async def membership(chat_id, user_id):
        if user_id == 43:
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        return await original(chat_id, user_id)

    gateway.membership.side_effect = membership
    task = asyncio.create_task(rsvp.unanswered(Viewer(id=42, first_name="Админ"), A, event.id))
    await asyncio.wait_for(entered.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stopped.is_set()


async def test_concurrent_creation_commits_only_one_invitation(engine):
    import asyncio

    service, _, _, rsvp = await audience(engine)
    key = uuid4()
    left, right = await asyncio.gather(
        service.create(42, A, draft(), key),
        service.create(42, A, draft(), key),
    )
    assert left.id == right.id
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 1
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 1


async def test_failed_invitation_intent_rolls_back_event_and_retry_can_succeed(engine):
    from unittest.mock import patch

    from planerbot.models import Event

    service, _, _, rsvp = await audience(engine)
    key = uuid4()
    with patch("planerbot.event_repository.enqueue_invitation", side_effect=RuntimeError):
        with pytest.raises(RuntimeError):
            await service.create(42, A, draft(), key)
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Event)) == 0
        assert await session.scalar(select(func.count()).select_from(MessageCampaign)) == 0
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 0
    await service.create(42, A, draft(), key)
    async with rsvp.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(PersonalNotice)) == 1
