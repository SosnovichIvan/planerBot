"""Telegram transport: opt-in text only, never collect ordinary messages from groups."""

import re
from uuid import UUID

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandObject, CommandStart, Filter
from aiogram.types import ForceReply, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy.exc import SQLAlchemyError

from planerbot.support import SUPPORT_UNAVAILABLE, SupportError, SupportService

SUPPORT_PROMPT_INTRO = (
    "Техподдержка planerBot\n\n"
    "Ответьте на это сообщение и опишите проблему (до 3000 символов). "
    "Что вы делали, чего ожидали и что произошло?\n\n"
)
SUPPORT_PROMPT = (
    SUPPORT_PROMPT_INTRO + "Текст, ваше имя, Telegram ID и ник будут переданы команде техподдержки "
    "для обратной связи. Не присылайте пароли и токены. "
    "Если передумали, не отвечайте на это сообщение."
)


class SupportReply(Filter):
    async def __call__(self, message: Message, bot: Bot) -> bool:
        reply = message.reply_to_message
        return bool(
            message.chat.type == "private"
            and reply
            and reply.from_user
            and reply.from_user.id == bot.id
            and (reply.text or "").startswith(SUPPORT_PROMPT_INTRO)
            and reply.forward_origin is None
            and not (message.text or "").startswith("/")
        )


class SupportOwnerReply(Filter):
    def __init__(self, target_id: int):
        self.target_id = target_id

    async def __call__(self, message: Message, bot: Bot) -> bool | dict[str, UUID]:
        user, reply = message.from_user, message.reply_to_message
        if not (
            self.target_id
            and message.chat.type == "private"
            and user
            and user.id == self.target_id == message.chat.id
            and not user.is_bot
            and message.sender_chat is None
            and reply
            and reply.from_user
            and reply.from_user.id == bot.id
            and reply.forward_origin is None
            and not (message.text or "").startswith("/")
        ):
            return False
        match = re.match(r"^Техподдержка planerBot\nОбращение №([0-9a-f]{32})\n", reply.text or "")
        return {"support_ticket_id": UUID(hex=match[1])} if match else False


def support_router(service: SupportService) -> Router:
    router = Router()

    async def prompt(message: Message) -> None:
        if not service.target_id:
            await message.answer(SUPPORT_UNAVAILABLE)
            return
        await message.answer(
            SUPPORT_PROMPT, reply_markup=ForceReply(input_field_placeholder="Опишите проблему")
        )

    async def submit(message: Message, text: str) -> None:
        user = message.from_user
        if user is None or user.is_bot or message.sender_chat is not None:
            return
        if message.chat.id != user.id:
            return
        try:
            ticket = await service.submit(
                user.id, message.message_id, user.full_name, user.username, text
            )
        except SupportError as exc:
            await message.answer(str(exc))
            if service.target_id:
                await prompt(message)
        except SQLAlchemyError:
            await message.answer("Не удалось сохранить обращение. Попробуйте позже: /support.")
        else:
            await message.answer(
                f"Обращение №{ticket.hex} сохранено и поставлено в очередь техподдержки. "
                "Не отправляйте его повторно."
            )

    @router.message(SupportOwnerReply(service.target_id))
    async def answer_support(message: Message, support_ticket_id: UUID) -> None:
        assert message.from_user is not None  # filter
        try:
            answer_id = await service.reply(
                message.from_user.id,
                message.chat.id,
                message.message_id,
                support_ticket_id,
                message.text or "",
            )
        except SupportError as exc:
            await message.answer(str(exc))
        except SQLAlchemyError:
            await message.answer(
                "Не удалось подтвердить сохранение ответа. Он мог попасть в очередь; "
                "не отправляйте его повторно, чтобы избежать дубля."
            )
        else:
            await message.answer(
                f"Ответ №{answer_id.hex} сохранён и поставлен в очередь. "
                "Это ещё не подтверждение доставки. Не отправляйте его повторно."
            )

    @router.message(Command("support"))
    async def support(message: Message, command: CommandObject, bot: Bot) -> None:
        if message.chat.type in {"group", "supergroup"}:
            me = await bot.get_me()
            await message.answer(
                "Опишите проблему в личке боту — так её не увидят участники чата.",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [
                            InlineKeyboardButton(
                                text="Написать в техподдержку",
                                url=f"https://t.me/{me.username}?start=support",
                            )
                        ]
                    ]
                ),
            )
        elif message.chat.type == "private":
            if command.args:
                await submit(message, command.args)
            else:
                await prompt(message)

    @router.message(
        F.chat.type == "private", CommandStart(deep_link=True, magic=F.args == "support")
    )
    async def start_support(message: Message) -> None:
        await prompt(message)

    @router.message(SupportReply())
    async def reply_support(message: Message) -> None:
        await submit(message, message.text or "")

    return router
