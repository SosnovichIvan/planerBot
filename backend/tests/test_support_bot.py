from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.types import ForceReply, Update
from planerbot.bot import create_dispatcher
from planerbot.config import Settings
from planerbot.support import SupportError
from planerbot.support_bot import SUPPORT_PROMPT
from sqlalchemy.exc import OperationalError
from test_bot import bot_stub, store_stub


def incoming(text, *, chat="private", reply=False, bot_id=123456789, user=True, sender=False):
    message = {
        "message_id": 5,
        "date": 0,
        "chat": {"id": 42 if chat == "private" else -1001, "type": chat},
    }
    if user:
        message["from"] = {"id": 42, "is_bot": False, "first_name": "User", "username": "viewer"}
    if text is not None:
        message["text"] = text
        if text.startswith("/"):
            message["entities"] = [
                {"type": "bot_command", "offset": 0, "length": len(text.split()[0])}
            ]
    else:
        message["sticker"] = {
            "file_id": "test",
            "file_unique_id": "test",
            "type": "regular",
            "width": 10,
            "height": 10,
            "is_animated": False,
            "is_video": False,
        }
    if sender:
        message["sender_chat"] = {"id": -1001, "type": "channel", "title": "Channel"}
    if reply:
        message["reply_to_message"] = {
            "message_id": 4,
            "date": 0,
            "chat": message["chat"],
            "text": SUPPORT_PROMPT,
            "from": {"id": bot_id, "is_bot": True, "first_name": "Bot"},
        }
    return Update.model_validate({"update_id": 10, "message": message})


def dispatcher(service):
    return create_dispatcher(store_stub(), AsyncMock(), support=service)


@pytest.mark.parametrize("command", ["/support", "/support@planer_test_bot", "/start support"])
async def test_prompt_and_deep_link(command):
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    await dispatcher(service).feed_update(bot, incoming(command))
    reply = bot.session.call_args.args[1]
    assert reply.text == SUPPORT_PROMPT
    assert isinstance(reply.reply_markup, ForceReply) and reply.reply_markup.force_reply
    service.submit.assert_not_awaited()


@pytest.mark.parametrize("chat", ["group", "supergroup"])
async def test_group_only_links_to_private_and_never_collects_text(chat):
    service, bot = AsyncMock(), bot_stub()
    dp = dispatcher(service)
    await dp.feed_update(bot, incoming("/support личная проблема", chat=chat))
    reply = bot.session.call_args.args[1]
    assert reply.reply_markup.inline_keyboard[0][0].url.endswith("?start=support")
    assert "личная проблема" not in reply.text
    await dp.feed_update(bot, incoming("Групповое сообщение", chat=chat, reply=True))
    service.submit.assert_not_awaited()


@pytest.mark.parametrize("direct", [True, False])
async def test_submit_only_intended_text_and_correct_identity(direct):
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    key = uuid4()
    service.submit.return_value = key
    text = "/support Не работает" if direct else "Не работает"
    await dispatcher(service).feed_update(bot, incoming(text, reply=not direct))
    service.submit.assert_awaited_once_with(42, 5, "User", "viewer", "Не работает")
    assert key.hex in bot.session.call_args.args[1].text
    assert "очередь" in bot.session.call_args.args[1].text


async def test_replies_survive_dispatcher_restart_and_other_messages_not_captured():
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    service.submit.return_value = uuid4()
    await dispatcher(service).feed_update(bot, incoming("/support"))
    dp = dispatcher(service)  # No in-memory conversation state is needed.
    await dp.feed_update(bot, incoming("Просто текст"))
    await dp.feed_update(bot, incoming("Проблема", reply=True, bot_id=987))
    forwarded = incoming("Проблема", reply=True).model_dump(by_alias=True)
    forwarded["message"]["reply_to_message"]["forward_origin"] = {
        "type": "hidden_user",
        "date": 0,
        "sender_user_name": "User",
    }
    await dp.feed_update(bot, Update.model_validate(forwarded))
    service.submit.assert_not_awaited()
    await dp.feed_update(bot, incoming("Новая проблема", reply=True))
    service.submit.assert_awaited_once()


@pytest.mark.parametrize("kwargs", [{"user": False}, {"sender": True}])
async def test_reject_anonymous_senders(kwargs):
    service = AsyncMock()
    await dispatcher(service).feed_update(bot_stub(), incoming("/support text", **kwargs))
    service.submit.assert_not_awaited()


async def test_reject_bot_and_mismatched_private_user():
    service, bot = AsyncMock(), bot_stub()
    for field, value in [("is_bot", True), ("id", 99)]:
        data = incoming("/support text").model_dump(by_alias=True)
        data["message"]["from"][field] = value
        await dispatcher(service).feed_update(bot, Update.model_validate(data))
    service.submit.assert_not_awaited()


async def test_disabled_and_nontext_and_expected_errors():
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 0
    dp = dispatcher(service)
    await dp.feed_update(bot, incoming("/support"))
    assert "не настроен" in bot.session.call_args.args[1].text
    service.submit.assert_not_awaited()
    service.submit.side_effect = SupportError("Не настроено")
    await dp.feed_update(bot, incoming("/support text"))
    assert "Не настроено" == bot.session.call_args.args[1].text
    service.target_id = 900
    service.submit.side_effect = SupportError("Отправьте текст")
    await dp.feed_update(bot, incoming(None, reply=True))
    service.submit.assert_awaited_with(42, 5, "User", "viewer", "")
    assert bot.session.call_args_list[-2].args[1].text == "Отправьте текст"
    assert bot.session.call_args.args[1].text == SUPPORT_PROMPT
    service.submit.side_effect = OperationalError("query", {}, RuntimeError("private"))
    await dp.feed_update(bot, incoming("/support text"))
    assert "Не удалось сохранить" in bot.session.call_args.args[1].text
    assert "private" not in bot.session.call_args.args[1].text


async def test_existing_calendar_commands_do_not_become_support_requests():
    service, bot = AsyncMock(), bot_stub()
    dp = dispatcher(service)
    for command in ["/calendar", "/start", "/start calendar"]:
        await dp.feed_update(bot, incoming(command, reply=True))
        assert "календарь" in bot.session.call_args.args[1].text
    service.submit.assert_not_awaited()
    await dp.feed_update(bot, incoming("/support", chat="channel"))
    service.submit.assert_not_awaited()


@pytest.mark.parametrize("value", [-1, "@ivanSVladimirovich", "", 2**52])
def test_recipient_must_be_numeric_private_id(value):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(_env_file=None, support_chat_id=value)


async def test_transport_database_delivery_end_to_end_without_calendar_membership(engine):
    from planerbot.models import SupportTicket
    from planerbot.support import SupportDelivery, SupportService
    from planerbot.telegram import TelegramGateway
    from sqlalchemy import select

    service, bot = SupportService(engine, 900), bot_stub()
    gateway = AsyncMock()
    delivery = SupportDelivery(engine, TelegramGateway(gateway))
    await dispatcher(service).feed_update(bot, incoming("Не работает <календарь>", reply=True))
    async with service.sessions() as session:
        row = (await session.scalars(select(SupportTicket))).one()
        assert row.status == "pending" and row.user_id == 42
    assert await delivery.once()
    gateway.send_message.assert_awaited_once()
    assert gateway.send_message.call_args.kwargs["text"].endswith("Не работает <календарь>")
    assert gateway.send_message.call_args.kwargs["chat_id"] == 900
