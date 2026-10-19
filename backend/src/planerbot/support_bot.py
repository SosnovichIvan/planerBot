"""Telegram transport: opt-in text only, never collect ordinary messages from groups."""

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandObject, CommandStart, Filter
from aiogram.types import ForceReply, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy.exc import SQLAlchemyError

from planerbot.support import SupportError, SupportService

SUPPORT_PROMPT = (
    "Техподдержка planerBot\n\n"
    "Ответьте на это сообщение и опишите проблему (до 3000 символов). "
    "Что вы делали, чего ожидали и что произошло?\n\n"
    "Текст, ваше имя, Telegram ID и ник будут переданы @ivanSVladimirovich "
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
            and reply.text == SUPPORT_PROMPT
            and reply.forward_origin is None
            and not (message.text or "").startswith("/")
        )


def support_router(service: SupportService) -> Router:
    router = Router()

    async def prompt(message: Message) -> None:
        if not service.target_id:
            await message.answer("Приём обращений пока не настроен. Контакт: @ivanSVladimirovich.")
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
