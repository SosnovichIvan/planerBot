from unittest.mock import AsyncMock

from aiogram import Bot
from conftest import TEST_DB, TOKEN, signed
from fastapi.testclient import TestClient
from planerbot.access import AccessibleChat, AccessUnavailable
from planerbot.api import create_app
from planerbot.config import Settings
from planerbot.repository import ChatRecord, TopicRecord
from sqlalchemy.exc import OperationalError


def settings(**kwargs):
    return Settings(_env_file=None, database_url=TEST_DB, **kwargs)


def test_auth_and_private_headers():
    with TestClient(create_app(settings(bot_token=TOKEN), access=AsyncMock())) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        response = client.get("/api/me", headers={"Authorization": "tma " + signed()})
        assert response.status_code == 200
        assert response.json() == {"id": 42, "first_name": "Иван"}
        assert response.headers["cache-control"] == "no-store"
        for header in [{}, {"Authorization": "Bearer x"}, {"Authorization": "tma invalid"}]:
            assert client.get("/api/me", headers=header).status_code == 401


def test_chats_and_unavailable():
    access = AsyncMock()
    access.list_for.return_value = (
        [AccessibleChat(ChatRecord(-1, "А", (TopicRecord(10, "Тема"),)), True)],
        None,
    )
    with TestClient(create_app(settings(bot_token=TOKEN), access=access)) as client:
        headers = {"Authorization": "tma " + signed()}
        result = client.get("/api/chats?after=-2", headers=headers)
        assert result.json() == {
            "chats": [
                {
                    "id": "-1",
                    "title": "А",
                    "can_manage": True,
                    "topics": [{"id": "10", "title": "Тема", "enabled": True}],
                    "timezone": "UTC",
                    "event_tag": "#событие",
                    "creation_policy": "admins",
                    "confirmation_required": False,
                    "settings_version": 1,
                }
            ],
            "next_cursor": None,
        }
        access.list_for.assert_awaited_once_with(42, -2)
        assert client.get("/api/chats?after=bad", headers=headers).status_code == 422
        access.list_for.side_effect = AccessUnavailable
        assert client.get("/api/chats", headers=headers).status_code == 503


def test_not_configured(monkeypatch):
    # Token configuration and authorization are separate gates.
    monkeypatch.setattr(
        "planerbot.api.validate_init_data",
        lambda *args: __import__("planerbot.auth", fromlist=["Viewer"]).Viewer(
            id=42, first_name="x"
        ),
    )
    with TestClient(create_app(settings())) as client:
        assert client.get("/api/chats", headers={"Authorization": "tma x"}).status_code == 503
        assert client.post("/telegram/webhook", json={"update_id": 1}).status_code == 403
    with TestClient(create_app(settings(webhook_secret="secret"))) as client:
        assert (
            client.post(
                "/telegram/webhook",
                json={"update_id": 1},
                headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
            ).status_code
            == 503
        )


def test_webhook():
    dispatcher = AsyncMock()
    bot = Bot(TOKEN)
    with TestClient(
        create_app(settings(webhook_secret="secret"), bot=bot, dispatcher=dispatcher)
    ) as client:
        assert (
            client.post(
                "/telegram/webhook",
                json={"update_id": 1},
                headers={"X-Telegram-Bot-Api-Secret-Token": "bad"},
            ).status_code
            == 403
        )
        result = client.post(
            "/telegram/webhook",
            json={"update_id": 1},
            headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
        )
        assert result.status_code == 204
        dispatcher.feed_update.assert_awaited_once()


async def test_default_settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    app = create_app()
    async with app.router.lifespan_context(app):
        assert app.title == "planerBot"


def test_readiness():
    with TestClient(create_app(settings())) as client:
        assert client.get("/health/ready").status_code == 200


def test_readiness_failure():
    engine = AsyncMock()
    engine.connect = lambda: BrokenConnection()
    with TestClient(create_app(settings(), engine=engine)) as client:
        assert client.get("/health/ready").status_code == 503


class BrokenConnection:
    async def __aenter__(self):
        raise OperationalError("connect", {}, None)

    async def __aexit__(self, *args):
        pass
