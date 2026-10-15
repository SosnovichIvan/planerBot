from datetime import UTC, datetime

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import (
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)

from planerbot.access import (
    AccessDenied,
    AccessUnavailable,
    ChatStore,
    Membership,
    MembershipGateway,
)
from planerbot.event_contracts import Conflict, InvalidEvent
from planerbot.events import EventService
from planerbot.parsing import TEMPLATE


def create_dispatcher(
    store: ChatStore, gateway: MembershipGateway, events: EventService | None = None
) -> Dispatcher:
    router = Router()

    @router.my_chat_member()
    async def bot_membership(event: ChatMemberUpdated) -> None:
        await store.set_active(event.chat.id, Membership(event.new_chat_member.status).admin)

    @router.message(Command("setup"))
    async def setup(message: Message, bot: Bot) -> None:
        if message.chat.type != "supergroup" or not message.chat.is_forum:
            await message.answer("Выполните /setup в теме супергруппы с включёнными темами.")
            return
        if message.from_user is None or message.sender_chat is not None:
            await message.answer("Отправьте команду от личного аккаунта администратора.")
            return
        try:
            member = await gateway.membership(message.chat.id, message.from_user.id)
            bot_member = await gateway.membership(message.chat.id, bot.id)
        except AccessUnavailable:
            await message.answer("Не удалось проверить права. Попробуйте позже.")
            return
        if not member.admin or not bot_member.admin:
            await message.answer("Для настройки нужны права администратора у вас и у бота.")
            return
        thread_id = message.message_thread_id or 1
        # Existing topic titles are not enumerated by Bot API. Register explicitly in the topic.
        name = (message.text or "").partition(" ")[2].strip()
        topic_title = name[:256] or ("Общая" if thread_id == 1 else f"Тема {thread_id}")
        await store.register(message.chat.id, message.chat.title or "Чат", thread_id, topic_title)
        await message.answer(
            "Чат и тема подключены. Проверьте часовой пояс и темы: /settings. Календарь: /calendar"
        )

    @router.message(Command("calendar", "start", "settings"))
    async def calendar(message: Message, bot: Bot) -> None:
        me = await bot.get_me()
        context = f"chat_{message.chat.id}" if message.chat.type == "supergroup" else "calendar"
        markup = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="Открыть мой календарь",
                        url=f"https://t.me/{me.username}?startapp={context}",
                    )
                ]
            ]
        )
        await message.answer(
            "Ваш календарь откроется персонально. Доступны только чаты, в которых вы состоите.",
            reply_markup=markup,
        )

    if events is not None:

        async def import_event(message: Message, event_update: Update, *, command: bool) -> None:
            if (
                message.chat.type != "supergroup"
                or message.from_user is None
                or message.from_user.is_bot
                or message.sender_chat is not None
            ):
                return
            content = message.text or message.caption or ""
            if command and "\n" not in content:
                await message.answer(
                    "Создайте событие в этой теме, отправив:\n\n/event\n" + TEMPLATE
                )
                return
            try:
                stamp = message.edit_date or message.date
                source_date = (
                    datetime.fromtimestamp(stamp, UTC) if isinstance(stamp, int) else stamp
                )
                result = await events.import_message(
                    message.from_user.id,
                    message.chat.id,
                    message.message_thread_id or 1,
                    content,
                    message.message_id,
                    source_date,
                    event_update.update_id,
                    command=command,
                )
            except AccessDenied:
                if command:
                    await message.answer("Создавать события этой командой могут администраторы.")
                return
            except AccessUnavailable:
                await message.answer("Не удалось проверить права. Попробуйте позже.")
                return
            except (InvalidEvent, Conflict) as exc:
                await message.answer(str(exc))
                return
            if result is not None:
                text = (
                    "Событие ожидает подтверждения администратора."
                    if result.status == "pending"
                    else "Событие сохранено. Публикация ожидает обработки."
                    if command
                    else "Событие добавлено в календарь."
                )
                await message.answer(text)

        @router.message(Command("event"))
        async def command_event(message: Message, event_update: Update, bot: Bot) -> None:
            if message.chat.type == "private":
                await calendar(message, bot)
                return
            await import_event(message, event_update, command=True)

        @router.message()
        async def tagged_event(message: Message, event_update: Update) -> None:
            await import_event(message, event_update, command=False)

        @router.edited_message(Command("event"))
        async def edited_command_event(message: Message, event_update: Update) -> None:
            await import_event(message, event_update, command=True)

        @router.edited_message()
        async def edited_event(message: Message, event_update: Update) -> None:
            await import_event(message, event_update, command=False)

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher
