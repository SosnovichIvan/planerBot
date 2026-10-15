from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import GetChatMember
from aiogram.types import ChatMemberMember, Update, User
from conftest import TOKEN
from planerbot.access import AccessUnavailable, Membership
from planerbot.bot import create_dispatcher
from planerbot.polling import run_polling
from planerbot.telegram import TelegramGateway


def update(
    command="/setup", *, chat_type="supergroup", forum=True, thread=10, sender=True, anonymous=False
):
    data = {
        "message_id": 1,
        "date": 0,
        "chat": {"id": -1, "type": chat_type, "title": "А", "is_forum": forum},
        "text": command,
        "entities": [{"type": "bot_command", "offset": 0, "length": len(command.split()[0])}],
    }
    if sender:
        data["from"] = {"id": 42, "is_bot": False, "first_name": "User"}
    if anonymous:
        data["sender_chat"] = {"id": -1, "type": "supergroup", "title": "А"}
    if thread:
        data["message_thread_id"] = thread
    return Update.model_validate({"update_id": 1, "message": data})


def bot_stub():
    bot = Bot(TOKEN)
    bot.session = AsyncMock()
    bot.get_me = AsyncMock(
        return_value=User(id=123456789, is_bot=True, first_name="Bot", username="planer_test_bot")
    )
    return bot


@pytest.mark.parametrize(
    "kwargs,reply",
    [
        ({"chat_type": "private"}, "супергруппы"),
        ({"forum": False}, "супергруппы"),
        ({"sender": False}, "личного аккаунта"),
        ({"anonymous": True}, "личного аккаунта"),
    ],
)
async def test_setup_invalid_context(kwargs, reply):
    store, gateway, bot = AsyncMock(), AsyncMock(), bot_stub()
    await create_dispatcher(store, gateway).feed_update(bot, update(**kwargs))
    assert reply in bot.session.call_args[0][1].text
    store.register.assert_not_awaited()


@pytest.mark.parametrize(
    "memberships,expected",
    [
        ([Membership("member"), Membership("administrator")], "права администратора"),
        ([Membership("creator"), Membership("member")], "права администратора"),
        (AccessUnavailable, "проверить права"),
    ],
)
async def test_setup_authorization(memberships, expected):
    store, gateway, bot = AsyncMock(), AsyncMock(), bot_stub()
    gateway.membership.side_effect = memberships
    await create_dispatcher(store, gateway).feed_update(bot, update())
    assert expected in bot.session.call_args[0][1].text
    store.register.assert_not_awaited()


@pytest.mark.parametrize(
    "command,thread,name",
    [("/setup Встречи", 10, "Встречи"), ("/setup", 10, "Тема 10"), ("/setup", None, "Общая")],
)
async def test_register_topic(command, thread, name):
    store, gateway, bot = AsyncMock(), AsyncMock(), bot_stub()
    gateway.membership.return_value = Membership("administrator")
    await create_dispatcher(store, gateway).feed_update(bot, update(command, thread=thread))
    store.register.assert_awaited_once_with(-1, "А", thread or 1, name)


@pytest.mark.parametrize("chat_type,context", [("supergroup", "chat_-1"), ("private", "calendar")])
async def test_calendar_link(chat_type, context):
    bot = bot_stub()
    await create_dispatcher(AsyncMock(), AsyncMock()).feed_update(
        bot, update("/calendar", chat_type=chat_type)
    )
    markup = bot.session.call_args[0][1].reply_markup
    assert markup.inline_keyboard[0][0].url == f"https://t.me/planer_test_bot?startapp={context}"


async def test_gateway_success_and_failure():
    bot = AsyncMock()
    bot.get_chat_member.return_value = ChatMemberMember(
        user=User(id=42, is_bot=False, first_name="x")
    )
    assert (await TelegramGateway(bot).membership(-1, 42)).present
    for error in [
        TelegramBadRequest(method=GetChatMember(chat_id=-1, user_id=42), message="no"),
        TimeoutError(),
    ]:
        bot.get_chat_member.side_effect = error
        with pytest.raises(AccessUnavailable):
            await TelegramGateway(bot).membership(-1, 42)


async def test_polling_missing_token(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "")
    with pytest.raises(ValueError, match="BOT_TOKEN"):
        await run_polling()


async def test_polling_cleanup(monkeypatch):
    from planerbot.config import Settings

    bot, engine, dispatcher = bot_stub(), AsyncMock(), AsyncMock()
    dispatcher.start_polling.side_effect = RuntimeError("stopped")
    dispatcher.resolve_used_update_types = lambda: ["message"]
    monkeypatch.setattr("planerbot.polling.Bot", lambda token: bot)
    monkeypatch.setattr("planerbot.polling.create_async_engine", lambda url, **kwargs: engine)
    monkeypatch.setattr("planerbot.polling.create_dispatcher", lambda *args: dispatcher)
    with pytest.raises(RuntimeError, match="stopped"):
        await run_polling(Settings(_env_file=None, bot_token=TOKEN))
    bot.session.close.assert_awaited_once()
    engine.dispose.assert_awaited_once()
