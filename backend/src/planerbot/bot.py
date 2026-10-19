from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.types import (
    BotCommand,
    BotCommandScopeChat,
    BotCommandScopeChatAdministrators,
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    TelegramObject,
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
from planerbot.rsvp import RsvpService
from planerbot.support import SupportService
from planerbot.support_bot import support_router


def create_dispatcher(
    store: ChatStore,
    gateway: MembershipGateway,
    events: EventService | None = None,
    rsvp: RsvpService | None = None,
    support: SupportService | None = None,
) -> Dispatcher:
    router = Router()

    if rsvp is not None:

        @router.chat_member()
        async def participant_changed(event: ChatMemberUpdated) -> None:
            if not Membership(
                event.new_chat_member.status, getattr(event.new_chat_member, "is_member", False)
            ).present:
                await rsvp.remove(event.chat.id, event.new_chat_member.user.id)

        @router.message(F.chat.type == "private", F.write_access_allowed)
        async def write_access(message: Message) -> None:
            if message.from_user is not None:
                await rsvp.contact(message.from_user.id, True)

        @router.message(F.chat.type == "private", Command("stop"))
        async def stop_personal(message: Message) -> None:
            if message.from_user is not None:
                await rsvp.contact(message.from_user.id, False)
                await message.answer(
                    "Личные уведомления отключены. Чтобы включить их снова, отправьте /start."
                )

    def calendar_keyboard() -> ReplyKeyboardMarkup:
        return ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text="Календарь")]],
            resize_keyboard=True,
            is_persistent=True,
            one_time_keyboard=False,
        )

    async def calendar_markup(bot: Bot, chat_id: int) -> InlineKeyboardMarkup:
        me = await bot.get_me()
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="Открыть календарь",
                        url=f"https://t.me/{me.username}?startapp=chat_{chat_id}",
                    )
                ]
            ]
        )

    async def discover(
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        message: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if isinstance(message, Message) and message.chat.type in {"group", "supergroup"}:
            chat = await store.get(message.chat.id)
            if chat is not None:
                thread = (message.message_thread_id or 1) if message.chat.is_forum else 1
                created, edited = message.forum_topic_created, message.forum_topic_edited
                name = created.name if created else edited.name if edited else None
                if name or not any(t.thread_id == thread for t in chat.topics):
                    await store.register(
                        message.chat.id,
                        message.chat.title or "Чат",
                        thread,
                        name
                        or (
                            "Общая"
                            if message.chat.is_forum and thread == 1
                            else f"Тема {thread}"
                            if message.chat.is_forum
                            else "Чат"
                        ),
                        overwrite_title=bool(name),
                    )
        return await handler(message, data)

    router.message.outer_middleware(discover)
    router.edited_message.outer_middleware(discover)

    @router.my_chat_member()
    async def bot_membership(event: ChatMemberUpdated, bot: Bot) -> None:
        if rsvp is not None and event.chat.type == "private":
            await rsvp.contact(event.chat.id, event.new_chat_member.status != "kicked")
        if event.chat.type not in {"group", "supergroup"}:
            return
        active = Membership(event.new_chat_member.status).admin
        if not active:
            await store.set_active(event.chat.id, False)
            if event.new_chat_member.status == "member":
                await bot.send_message(
                    event.chat.id, "Назначьте бота администратором, чтобы подключить календарь."
                )
            return
        await store.register(
            event.chat.id,
            event.chat.title or "Чат",
            1,
            "Общая" if event.chat.is_forum else "Чат",
            overwrite_title=False,
        )
        commands = [
            BotCommand(command="calendar", description="Открыть календарь"),
            BotCommand(command="support", description="Техподдержка"),
        ]
        await bot.set_my_commands(commands, scope=BotCommandScopeChat(chat_id=event.chat.id))
        await bot.set_my_commands(
            commands
            + [
                BotCommand(command="event", description="Создать событие"),
                BotCommand(command="settings", description="Настройки календаря"),
            ],
            scope=BotCommandScopeChatAdministrators(chat_id=event.chat.id),
        )
        if not Membership(event.old_chat_member.status).admin:
            await bot.send_message(
                event.chat.id,
                "Кнопка «Календарь» доступна на клавиатуре чата.",
                reply_markup=calendar_keyboard(),
            )
            await bot.send_message(
                event.chat.id,
                "Календарь подключён.",
                reply_markup=await calendar_markup(bot, event.chat.id),
            )

    @router.message(Command("setup"))
    async def setup(message: Message, bot: Bot) -> None:
        if message.chat.type not in {"group", "supergroup"}:
            await message.answer("Выполните /setup в группе.")
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
        thread_id = (message.message_thread_id or 1) if message.chat.is_forum else 1
        # Existing topic titles are not enumerated by Bot API. Register explicitly in the topic.
        name = (message.text or "").partition(" ")[2].strip()
        topic_title = name[:256] or (
            "Чат"
            if not message.chat.is_forum
            else "Общая"
            if thread_id == 1
            else f"Тема {thread_id}"
        )
        await store.register(message.chat.id, message.chat.title or "Чат", thread_id, topic_title)
        await message.answer(
            "Чат и тема подключены. Проверьте часовой пояс и темы: /settings. Календарь: /calendar",
            reply_markup=calendar_keyboard(),
        )

    @router.message(F.text == "Календарь")
    @router.message(Command("calendar", "start", "settings"))
    async def calendar(message: Message, bot: Bot) -> None:
        if (
            rsvp is not None
            and message.chat.type == "private"
            and message.from_user is not None
            and (message.text or "").split()[0].split("@")[0] == "/start"
        ):
            await rsvp.contact(message.from_user.id, True)
        if message.chat.type in {"group", "supergroup"} and message.text != "Календарь":
            await message.answer(
                "Кнопка «Календарь» доступна на клавиатуре чата.",
                reply_markup=calendar_keyboard(),
            )
        me = await bot.get_me()
        context = (
            f"chat_{message.chat.id}"
            if message.chat.type in {"group", "supergroup"}
            else "calendar"
        )
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
                message.chat.type not in {"group", "supergroup"}
                or message.from_user is None
                or message.from_user.is_bot
                or message.sender_chat is not None
            ):
                return
            content = message.text or message.caption or ""
            try:
                stamp = message.edit_date or message.date
                source_date = (
                    datetime.fromtimestamp(stamp, UTC) if isinstance(stamp, int) else stamp
                )
                result = await events.import_message(
                    message.from_user.id,
                    message.chat.id,
                    (message.message_thread_id or 1) if message.chat.is_forum else 1,
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
            if "\n" in (message.text or "") and message.chat.type != "private":
                await import_event(message, event_update, command=True)
                return
            if message.chat.type not in {"private", "group", "supergroup"}:
                return
            context = "create"
            if message.chat.type != "private":
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
                    await message.answer(
                        "Для создания события нужны права администратора у вас и у бота."
                    )
                    return
                thread = (message.message_thread_id or 1) if message.chat.is_forum else 1
                context = f"create_{message.chat.id}_{thread}"
            me = await bot.get_me()
            await message.answer(
                "Заполните форму события. "
                "После сохранения бот опубликует карточку в выбранном чате.",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [
                            InlineKeyboardButton(
                                text="Создать событие",
                                url=f"https://t.me/{me.username}?startapp={context}",
                            )
                        ]
                    ]
                ),
            )

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
    if support is not None:
        dispatcher.include_router(support_router(support))
    dispatcher.include_router(router)
    return dispatcher
