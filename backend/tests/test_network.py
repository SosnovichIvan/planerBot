import runpy
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramNetworkError
from aiogram.methods import GetMe
from aiohttp import ClientConnectionError, ClientTimeout
from aiohttp_socks import ProxyConnectionError, ProxyError, ProxyTimeoutError
from conftest import TOKEN
from planerbot.config import Settings
from planerbot.network import check_telegram_connection, create_bot

PROXY = "http://proxy.internal:19840"


@pytest.mark.parametrize("proxy", ["", PROXY, "http://[::1]:19840/"])
async def test_shared_bot_factory(proxy):
    config = Settings(_env_file=None, bot_token=TOKEN, telegram_proxy_url=proxy)
    bot = create_bot(config)
    assert bot.id == int(TOKEN.split(":")[0])
    assert isinstance(bot.session, AiohttpSession)
    assert bot.session.proxy == (proxy or None)
    assert PROXY not in repr(config)
    await bot.session.close()


@pytest.mark.parametrize(
    "proxy",
    [
        "https://proxy:443",
        "socks5://proxy:1080",
        "http://proxy",
        "http://proxy:0",
        "http://proxy:70000",
        "http://proxy:bad",
        "http://user:secret@proxy:3128",
        "http://proxy:3128/path",
        "http://proxy:3128?secret=value",
        "http://proxy:3128#secret",
        "http://proxy:3128/\n",
        "http://[broken",
    ],
)
def test_reject_malformed_proxy_without_logging_value(proxy):
    with pytest.raises(ValueError) as exc:
        Settings(_env_file=None, telegram_proxy_url=proxy)
    assert proxy not in str(exc.value)


@pytest.fixture
def session_stub(monkeypatch):
    session, client, response = AsyncMock(), MagicMock(), MagicMock()
    response.status = 302
    client.head.return_value.__aenter__ = AsyncMock(return_value=response)
    client.head.return_value.__aexit__ = AsyncMock(return_value=False)
    session.create_session.return_value = client
    factory = MagicMock(return_value=session)
    monkeypatch.setattr("planerbot.network.AiohttpSession", factory)
    return session, client, response, factory


async def test_proxy_preflight_and_direct_default(session_stub, monkeypatch):
    session, client, response, factory = session_stub
    config = Settings(_env_file=None, telegram_proxy_url=PROXY)
    await check_telegram_connection(config)
    factory.assert_called_once_with(proxy=PROXY)
    client.head.assert_called_once_with(
        "https://api.telegram.org/", allow_redirects=False, timeout=ClientTimeout(total=15)
    )
    session.close.assert_awaited_once()
    factory.reset_mock()
    monkeypatch.setattr("planerbot.network.Settings", lambda: Settings(_env_file=None))
    response.status = 200
    await check_telegram_connection()
    factory.assert_called_once_with(proxy=None)


async def test_preflight_rejected_status_closes_session(session_stub):
    session, _, response, _ = session_stub
    response.status = 407
    with pytest.raises(RuntimeError, match="rejected"):
        await check_telegram_connection(Settings(_env_file=None, telegram_proxy_url=PROXY))
    session.close.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [
        ClientConnectionError("private-data"),
        OSError("private-data"),
        TimeoutError("private-data"),
        ProxyConnectionError("private-data"),
        ProxyTimeoutError("private-data"),
        ProxyError("private-data"),
    ],
)
async def test_failed_proxy_never_falls_back_or_discloses(session_stub, error):
    session, client, _, factory = session_stub
    client.head.side_effect = error
    with pytest.raises(RuntimeError, match="preflight failed") as exc:
        await check_telegram_connection(Settings(_env_file=None, telegram_proxy_url=PROXY))
    assert "private-data" not in str(exc.value)
    assert exc.value.__suppress_context__
    factory.assert_called_once_with(proxy=PROXY)
    assert client.head.call_count == 1
    session.close.assert_awaited_once()


@pytest.mark.parametrize("error", [None, ProxyError, ProxyTimeoutError, ProxyConnectionError])
async def test_connector_errors_are_classified_for_access_and_delivery(monkeypatch, error):
    underlying = AsyncMock(return_value="result")
    if error:
        underlying.side_effect = error("private-data")
    monkeypatch.setattr(AiohttpSession, "make_request", underlying)
    bot = create_bot(Settings(_env_file=None, bot_token=TOKEN, telegram_proxy_url=PROXY))
    method = GetMe()
    try:
        if error:
            with pytest.raises(TelegramNetworkError, match="proxy unavailable") as exc:
                await bot.session.make_request(bot, method, 5)
            assert "private-data" not in str(exc.value)
            assert exc.value.__suppress_context__
        else:
            assert await bot.session.make_request(bot, method, 5) == "result"
        underlying.assert_awaited_once_with(bot, method, 5)
    finally:
        await bot.session.close()


def test_token_free_cli_uses_proxy_and_closes_session(monkeypatch):
    client = MagicMock()
    client.head.return_value.__aenter__ = AsyncMock(return_value=MagicMock(status=302))
    client.head.return_value.__aexit__ = AsyncMock(return_value=False)
    create, close = AsyncMock(return_value=client), AsyncMock()
    monkeypatch.setattr(AiohttpSession, "create_session", create)
    monkeypatch.setattr(AiohttpSession, "close", close)
    monkeypatch.setenv("BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_PROXY_URL", PROXY)
    path = Path(__file__).resolve().parents[1] / "src/planerbot/network.py"
    runpy.run_path(str(path), run_name="__main__")
    create.assert_awaited_once()
    close.assert_awaited_once()
    client.head.assert_called_once_with(
        "https://api.telegram.org/", allow_redirects=False, timeout=ClientTimeout(total=15)
    )
