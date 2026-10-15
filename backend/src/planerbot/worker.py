from sqlalchemy.ext.asyncio import create_async_engine

from planerbot.access import ChatAccess
from planerbot.config import Settings
from planerbot.network import create_bot
from planerbot.publications import Delivery, PublicationRepository
from planerbot.repository import ChatRepository
from planerbot.telegram import TelegramGateway


async def run_worker(settings: Settings | None = None) -> None:
    config = settings or Settings()
    token = config.bot_token.get_secret_value()
    if not token:
        raise ValueError("Set BOT_TOKEN before starting the worker")
    engine = create_async_engine(config.database_url, hide_parameters=True)
    bot = create_bot(config)
    gateway = TelegramGateway(bot)
    delivery = Delivery(
        PublicationRepository(engine), ChatAccess(ChatRepository(engine), gateway, bot.id), gateway
    )
    try:
        await delivery.run()
    finally:
        await bot.session.close()
        await engine.dispose()
