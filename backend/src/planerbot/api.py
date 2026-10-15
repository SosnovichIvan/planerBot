import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.middleware.base import RequestResponseEndpoint
from starlette.requests import Request

from planerbot.access import AccessUnavailable, ChatAccess
from planerbot.auth import Unauthorized, Viewer, validate_init_data
from planerbot.bot import create_dispatcher
from planerbot.config import Settings
from planerbot.repository import ChatRepository
from planerbot.telegram import TelegramGateway


class TopicResponse(BaseModel):
    id: str
    title: str


class ChatResponse(BaseModel):
    id: str
    title: str
    can_manage: bool
    topics: list[TopicResponse]


class ChatsResponse(BaseModel):
    chats: list[ChatResponse]
    next_cursor: str | None


def create_app(
    settings: Settings | None = None,
    *,
    access: ChatAccess | None = None,
    engine: AsyncEngine | None = None,
    bot: Bot | None = None,
    dispatcher: Dispatcher | None = None,
) -> FastAPI:
    config = settings or Settings()
    db = engine or create_async_engine(config.database_url, pool_pre_ping=True)
    token = config.bot_token.get_secret_value()
    telegram_bot = bot or (Bot(token) if token else None)
    if telegram_bot is not None:
        gateway = TelegramGateway(telegram_bot)
        store = ChatRepository(db)
        access = access or ChatAccess(store, gateway, telegram_bot.id)
        dispatcher = dispatcher or create_dispatcher(store, gateway)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await db.dispose()
        if telegram_bot is not None:
            await telegram_bot.session.close()

    app = FastAPI(title="planerBot", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def private_responses(request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def viewer(authorization: Annotated[str | None, Header()] = None) -> Viewer:
        if authorization is None or not authorization.startswith("tma "):
            raise HTTPException(401, "Откройте календарь заново через Telegram.")
        try:
            return validate_init_data(authorization[4:], token, config.init_data_ttl_seconds)
        except Unauthorized as exc:
            raise HTTPException(401, "Откройте календарь заново через Telegram.") from exc

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready() -> dict[str, str]:
        try:
            async with db.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except (SQLAlchemyError, OSError) as exc:
            raise HTTPException(503, "Database unavailable") from exc
        return {"status": "ok"}

    @app.get("/api/me")
    async def me(user: Annotated[Viewer, Depends(viewer)]) -> Viewer:
        return user

    @app.get("/api/chats", response_model=ChatsResponse)
    async def chats(
        user: Annotated[Viewer, Depends(viewer)],
        after: Annotated[int | None, Query(ge=-(2**52), le=2**52)] = None,
    ) -> ChatsResponse:
        if access is None:
            raise HTTPException(503, "Бот ещё не настроен.")
        try:
            result, cursor = await access.list_for(user.id, after)
        except AccessUnavailable as exc:
            raise HTTPException(503, "Не удалось проверить доступ. Попробуйте позже.") from exc
        return ChatsResponse(
            chats=[
                ChatResponse(
                    id=str(item.chat.id),
                    title=item.chat.title,
                    can_manage=item.can_manage,
                    topics=[
                        TopicResponse(id=str(topic.thread_id), title=topic.title)
                        for topic in item.chat.topics
                    ],
                )
                for item in result
            ],
            next_cursor=cursor,
        )

    @app.post("/telegram/webhook", status_code=204, include_in_schema=False)
    async def webhook(
        update: Update,
        secret: Annotated[str | None, Header(alias="X-Telegram-Bot-Api-Secret-Token")] = None,
    ) -> Response:
        expected = config.webhook_secret.get_secret_value()
        if not expected or secret is None or not hmac.compare_digest(secret, expected):
            raise HTTPException(403, "Forbidden")
        if dispatcher is None or telegram_bot is None:
            raise HTTPException(503, "Бот ещё не настроен.")
        await dispatcher.feed_update(telegram_bot, update)
        return Response(status_code=204)

    return app
