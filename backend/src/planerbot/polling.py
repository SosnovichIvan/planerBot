from aiogram import Bot
from sqlalchemy.ext.asyncio import create_async_engine

from planerbot.bot import create_dispatcher
from planerbot.config import Settings
from planerbot.repository import ChatRepository
from planerbot.telegram import TelegramGateway


async def run_polling(settings: Settings | None = None) -> None:
    config = settings or Settings()
    token = config.bot_token.get_secret_value()
    if not token:
        raise ValueError("Set BOT_TOKEN before starting polling")
    engine = create_async_engine(config.database_url)
    bot = Bot(token)
    dispatcher = create_dispatcher(ChatRepository(engine), TelegramGateway(bot))
    try:
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()
        await engine.dispose()
