from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from aiogram.types import Update
from planerbot.models import SupportReply
from planerbot.support import SUPPORT_UNAVAILABLE, SupportError, SupportService
from planerbot.support_bot import SUPPORT_PROMPT, SUPPORT_PROMPT_INTRO
from planerbot.support_replies import SupportReplyDelivery
from planerbot.telegram import TelegramGateway
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from test_bot import bot_stub
from test_support_bot import dispatcher, incoming


def owner_update(ticket, body="Исправлено", **changes):
    data = incoming(body, reply=True).model_dump(by_alias=True)
    msg = data["message"]
    msg["chat"]["id"] = 900
    msg["from"]["id"] = 900
    msg["message_id"] = 15
    parent = msg["reply_to_message"]
    parent["chat"]["id"] = 900
    parent["text"] = (
        f"Техподдержка planerBot\nОбращение №{ticket.hex}\nПользователь: User\nID: 999999\nПроблема"
    )
    msg.update(changes)
    return Update.model_validate(data)


async def test_owner_reply_survives_restart_and_has_honest_queue_confirmation():
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    ticket, answer = uuid4(), uuid4()
    service.reply.return_value = answer
    await dispatcher(service).feed_update(bot, owner_update(ticket))
    service.reply.assert_awaited_once_with(900, 900, 15, ticket, "Исправлено")
    value = bot.session.call_args.args[1].text
    assert answer.hex in value and "ещё не подтверждение доставки" in value
    service.submit.assert_not_awaited()


@pytest.mark.parametrize(
    "case",
    [
        "wrong_user",
        "wrong_chat",
        "group",
        "bot",
        "anonymous",
        "missing_user",
        "missing_parent",
        "missing_parent_user",
        "other_bot",
        "forwarded",
        "wrong_header",
        "bad_uuid",
        "command",
        "no_parent_text",
    ],
)
async def test_untrusted_or_unrelated_messages_do_not_send_replies(case):
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    data = owner_update(uuid4()).model_dump(by_alias=True)
    msg, parent = data["message"], data["message"]["reply_to_message"]
    if case == "wrong_user":
        msg["from"]["id"] = 42
    if case == "wrong_chat":
        msg["chat"]["id"] = 901
    if case == "group":
        msg["chat"]["type"] = "group"
    if case == "bot":
        msg["from"]["is_bot"] = True
    if case == "anonymous":
        msg["sender_chat"] = {"id": -1001, "type": "channel", "title": "Channel"}
    if case == "missing_user":
        msg.pop("from")
    if case == "missing_parent":
        msg.pop("reply_to_message")
    if case == "missing_parent_user":
        parent.pop("from")
    if case == "other_bot":
        parent["from"]["id"] = 987
    if case == "forwarded":
        parent["forward_origin"] = {"type": "hidden_user", "date": 0, "sender_user_name": "User"}
    if case == "wrong_header":
        parent["text"] = "ID: 42\nОтветьте пользователю"
    if case == "bad_uuid":
        parent["text"] = "Техподдержка planerBot\nОбращение №not-a-uuid\n"
    if case == "command":
        msg["text"] = "/support"
        msg["entities"] = [{"type": "bot_command", "offset": 0, "length": 8}]
    if case == "no_parent_text":
        parent.pop("text")
    await dispatcher(service).feed_update(bot, Update.model_validate(data))
    service.reply.assert_not_awaited()


@pytest.mark.parametrize("kind", ["validation", "database", "nontext"])
async def test_owner_reply_errors_are_private_and_recoverable(kind):
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    if kind == "database":
        service.reply.side_effect = OperationalError("query", {}, RuntimeError("private SQL"))
    else:
        service.reply.side_effect = SupportError("Ответьте текстом: от 1 до 3000 символов.")
    await dispatcher(service).feed_update(
        bot, owner_update(uuid4(), None if kind == "nontext" else "Ответ")
    )
    message = bot.session.call_args.args[1].text
    assert ("Не удалось подтвердить сохранение ответа" if kind == "database" else "3000") in message
    if kind == "database":
        assert "мог попасть в очередь" in message and "не отправляйте его повторно" in message
    assert "private SQL" not in message
    if kind == "nontext":
        assert service.reply.call_args.args[-1] == ""


async def test_prompt_privacy_and_previous_prompt_compatibility():
    assert "@" not in SUPPORT_PROMPT and "@" not in SUPPORT_UNAVAILABLE
    service, bot = AsyncMock(), bot_stub()
    service.target_id = 900
    service.submit.return_value = uuid4()
    data = incoming("Проблема", reply=True).model_dump(by_alias=True)
    data["message"]["reply_to_message"]["text"] = SUPPORT_PROMPT_INTRO + "Legacy privacy notice"
    await dispatcher(service).feed_update(bot, Update.model_validate(data))
    service.submit.assert_awaited_once_with(42, 5, "User", "viewer", "Проблема")


async def test_old_card_to_database_to_private_answer_without_calendar_membership(engine):
    service = SupportService(engine, 900)
    ticket = await service.submit(42, 1, "User", "viewer", "Описание")
    bot, network = bot_stub(), AsyncMock()
    update = owner_update(ticket, "Спасибо, проверяем <ошибку>")
    # Also works with old tickets: no delivered message ID is required or fabricated.
    await dispatcher(service).feed_update(bot, update)
    await dispatcher(service).feed_update(bot, update)
    async with service.sessions() as session:
        replies = (await session.scalars(select(SupportReply))).all()
        assert len(replies) == 1 and replies[0].ticket_id == ticket
    worker = SupportReplyDelivery(engine, TelegramGateway(network))
    assert await worker.once() and not await worker.once()
    network.send_message.assert_awaited_once()
    args = network.send_message.call_args.kwargs
    assert args["chat_id"] == 42  # Not the forged ID: 999999 in the card text.
    assert args["text"].startswith("Здравствуйте, @viewer!\n\nСпасибо, проверяем <ошибку>\n\n")
    assert args["parse_mode"] is None
