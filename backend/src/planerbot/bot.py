from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import ChatMemberUpdated, InlineKeyboardButton, InlineKeyboardMarkup, Message

from planerbot.access import AccessUnavailable, ChatStore, Membership, MembershipGateway


def create_dispatcher(store: ChatStore, gateway: MembershipGateway) -> Dispatcher:
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
        await message.answer("Чат и тема подключены. Открыть календарь: /calendar")

    @router.message(Command("calendar", "start"))
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

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher
