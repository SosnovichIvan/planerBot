from unittest.mock import AsyncMock

import pytest
from aiogram.types import Update
from planerbot.access import AccessDenied, AccessUnavailable
from planerbot.bot import create_dispatcher
from planerbot.event_contracts import Conflict, InvalidEvent
from test_bot import bot_stub, update


@pytest.mark.parametrize(
    "kwargs", [{"chat_type": "private"}, {"sender": False}, {"anonymous": True}]
)
async def test_ignore_invalid_senders(kwargs):
    events = AsyncMock()
    await create_dispatcher(AsyncMock(), AsyncMock(), events).feed_update(
        bot_stub(), update("#событие", **kwargs)
    )
    events.import_message.assert_not_awaited()


@pytest.mark.parametrize(
    "content,command,result,reply",
    [
        ("/event", True, "active", "отправив"),
        ("/event\nНазвание: A", True, "active", "Публикация"),
        ("#событие\nНазвание: A", False, "pending", "подтверждения"),
        ("#событие\nНазвание: A", False, "active", "добавлено"),
    ],
)
async def test_event_bot_success(content, command, result, reply):
    bot, events = bot_stub(), AsyncMock()
    events.import_message.return_value.status = result
    await create_dispatcher(AsyncMock(), AsyncMock(), events).feed_update(bot, update(content))
    assert reply in bot.session.call_args[0][1].text
    if "\n" in content:
        assert events.import_message.call_args.kwargs["command"] is command


@pytest.mark.parametrize(
    "error,reply",
    [
        (AccessDenied(), "администраторы"),
        (AccessUnavailable(), "проверить права"),
        (InvalidEvent("Ошибка полей"), "Ошибка полей"),
        (Conflict("Конфликт"), "Конфликт"),
    ],
)
async def test_event_bot_errors(error, reply):
    bot, events = bot_stub(), AsyncMock()
    events.import_message.side_effect = error
    await create_dispatcher(AsyncMock(), AsyncMock(), events).feed_update(
        bot, update("/event\nНазвание: A")
    )
    assert reply in bot.session.call_args[0][1].text


async def test_edited_caption_bot_sender_and_ordinary_messages():
    bot, events = bot_stub(), AsyncMock()
    events.import_message.return_value = None
    dispatcher = create_dispatcher(AsyncMock(), AsyncMock(), events)
    payload = update("ignored").model_dump(mode="json", by_alias=True, exclude_none=True)
    payload["message"].pop("text")
    payload["message"].pop("entities")
    payload["message"]["caption"] = "#событие\nНазвание: A"
    payload["edited_message"] = payload.pop("message")
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    assert "#событие" in events.import_message.call_args.args[3]
    bot.session.assert_not_awaited()
    payload["edited_message"]["from"]["is_bot"] = True
    events.import_message.reset_mock()
    await dispatcher.feed_update(bot, Update.model_validate(payload))
    events.import_message.assert_not_awaited()
    events.import_message.side_effect = AccessDenied
    await dispatcher.feed_update(bot, update("#событие\nНазвание: A"))
    bot.session.assert_not_awaited()


async def test_private_event_opens_personal_calendar():
    bot, events = bot_stub(), AsyncMock()
    await create_dispatcher(AsyncMock(), AsyncMock(), events).feed_update(
        bot, update("/event", chat_type="private")
    )
    markup = bot.session.call_args[0][1].reply_markup
    assert "startapp=calendar" in markup.inline_keyboard[0][0].url
    events.import_message.assert_not_awaited()


async def test_edited_command_uses_the_same_command_filter():
    bot, events = bot_stub(), AsyncMock()
    events.import_message.return_value = None
    payload = update("/event\nНазвание: A").model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    payload["edited_message"] = payload.pop("message")
    await create_dispatcher(AsyncMock(), AsyncMock(), events).feed_update(
        bot, Update.model_validate(payload)
    )
    assert events.import_message.call_args.kwargs["command"] is True
