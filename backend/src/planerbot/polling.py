from sqlalchemy.ext.asyncio import create_async_engine

from planerbot.access import ChatAccess
from planerbot.bot import create_dispatcher
from planerbot.config import Settings
from planerbot.event_repository import EventRepository
from planerbot.events import EventService
from planerbot.network import create_bot
from planerbot.repository import ChatRepository
from planerbot.rsvp import RsvpService
from planerbot.telegram import TelegramGateway


async def run_polling(settings: Settings | None = None) -> None:
    config = settings or Settings()
    token = config.bot_token.get_secret_value()
    if not token:
        raise ValueError("Set BOT_TOKEN before starting polling")
    engine = create_async_engine(config.database_url, hide_parameters=True)
    bot = create_bot(config)
    store, gateway = ChatRepository(engine), TelegramGateway(bot)
    service = EventService(ChatAccess(store, gateway, bot.id), store, EventRepository(engine))
    dispatcher = create_dispatcher(store, gateway, service, RsvpService(engine, service.access))
    try:
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()
        await engine.dispose()
