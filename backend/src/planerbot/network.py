"""Telegram transport shared by API, polling, worker and deployment preflight."""

import asyncio

from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramNetworkError
from aiogram.methods.base import TelegramMethod, TelegramType
from aiohttp import ClientError, ClientTimeout
from aiohttp_socks import ProxyConnectionError, ProxyError, ProxyTimeoutError

from planerbot.config import Settings


class TelegramSession(AiohttpSession):
    async def make_request(
        self,
        bot: Bot,
        method: TelegramMethod[TelegramType],
        timeout: int | None = None,  # noqa: ASYNC109 -- aiogram override contract
    ) -> TelegramType:
        try:
            return await super().make_request(bot, method, timeout)
        except (ProxyConnectionError, ProxyTimeoutError, ProxyError):
            # aiogram does not normalize these connector-specific exceptions itself.
            raise TelegramNetworkError(
                method=method, message="Telegram proxy unavailable"
            ) from None


def create_bot(settings: Settings) -> Bot:
    proxy = settings.telegram_proxy_url.get_secret_value() or None
    session = TelegramSession(proxy=proxy)
    return Bot(settings.bot_token.get_secret_value(), session=session)


async def check_telegram_connection(settings: Settings | None = None) -> None:
    """Token-free TLS/CONNECT check. No silent fallback to direct requests."""
    config = settings or Settings()
    session = AiohttpSession(proxy=config.telegram_proxy_url.get_secret_value() or None)
    try:
        client = await session.create_session()
        async with client.head(
            "https://api.telegram.org/", allow_redirects=False, timeout=ClientTimeout(total=15)
        ) as response:
            if not 200 <= response.status < 400:
                raise RuntimeError("Telegram connection preflight rejected")
    except (
        ClientError,
        OSError,
        TimeoutError,
        ProxyConnectionError,
        ProxyTimeoutError,
        ProxyError,
    ):
        raise RuntimeError("Telegram connection preflight failed") from None
    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(check_telegram_connection())
