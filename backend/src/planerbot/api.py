import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated
from uuid import UUID

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.middleware.base import RequestResponseEndpoint
from starlette.requests import Request

from planerbot.access import AccessDenied, AccessUnavailable, ChatAccess
from planerbot.auth import Unauthorized, Viewer, validate_init_data
from planerbot.bot import create_dispatcher
from planerbot.config import Settings
from planerbot.event_contracts import (
    ChatSettingsInput,
    Conflict,
    EventEdit,
    EventInput,
    EventsView,
    EventView,
    InvalidEvent,
    MissingEvent,
    RetryInput,
    VersionInput,
)
from planerbot.event_repository import EventRepository
from planerbot.events import EventService
from planerbot.network import create_bot
from planerbot.publications import PublicationRepository
from planerbot.repository import ChatRepository
from planerbot.rsvp import (
    CampaignInput,
    CampaignView,
    EventDetails,
    ResponseInput,
    RsvpService,
    UnansweredView,
)
from planerbot.telegram import TelegramGateway


class TopicResponse(BaseModel):
    id: str
    title: str
    enabled: bool = True


class ChatResponse(BaseModel):
    id: str
    title: str
    can_manage: bool
    topics: list[TopicResponse]
    timezone: str = "UTC"
    event_tag: str = "#событие"
    creation_policy: str = "admins"
    confirmation_required: bool = False
    settings_version: int = 1


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
    event_service: EventService | None = None,
) -> FastAPI:
    config = settings or Settings()
    db = engine or create_async_engine(
        config.database_url, pool_pre_ping=True, hide_parameters=True
    )
    token = config.bot_token.get_secret_value()
    store = ChatRepository(db)
    telegram_bot = bot or (create_bot(config) if token else None)
    if telegram_bot is not None:
        gateway = TelegramGateway(telegram_bot)
        access = access or ChatAccess(store, gateway, telegram_bot.id)
        event_service = event_service or EventService(access, store, EventRepository(db))
        dispatcher = dispatcher or create_dispatcher(
            store, gateway, event_service, RsvpService(db, access)
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await db.dispose()
        if telegram_bot is not None:
            await telegram_bot.session.close()

    app = FastAPI(title="planerBot", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(AccessDenied)
    async def denied(_: Request, exc: AccessDenied) -> Response:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Нет доступа к этому действию."}, status_code=403)

    @app.exception_handler(Conflict)
    async def conflict(_: Request, exc: Conflict) -> Response:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(InvalidEvent)
    async def invalid(_: Request, exc: InvalidEvent) -> Response:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(MissingEvent)
    async def missing(_: Request, exc: MissingEvent) -> Response:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Событие не найдено."}, status_code=404)

    @app.exception_handler(AccessUnavailable)
    async def unavailable(_: Request, exc: AccessUnavailable) -> Response:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            {"detail": "Не удалось проверить доступ. Попробуйте позже."}, status_code=503
        )

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

    def rsvp_service() -> RsvpService:
        if access is None:
            raise HTTPException(503, "Бот ещё не настроен.")
        return RsvpService(db, access)

    @app.post("/api/calendar/visit", status_code=204)
    async def visit_calendar(user: Annotated[Viewer, Depends(viewer)]) -> Response:
        await rsvp_service().visit(user)
        return Response(status_code=204)

    @app.delete("/api/calendar/notifications", status_code=204)
    async def disable_notifications(user: Annotated[Viewer, Depends(viewer)]) -> Response:
        await rsvp_service().contact(user.id, False)
        return Response(status_code=204)

    @app.get("/api/chats/{chat_id}/events/{event_id}", response_model=EventDetails)
    async def event_details(
        chat_id: int, event_id: UUID, user: Annotated[Viewer, Depends(viewer)]
    ) -> EventDetails:
        return await rsvp_service().detail(user, chat_id, event_id)

    @app.put("/api/chats/{chat_id}/events/{event_id}/response", response_model=EventDetails)
    async def respond_event(
        chat_id: int, event_id: UUID, data: ResponseInput, user: Annotated[Viewer, Depends(viewer)]
    ) -> EventDetails:
        return await rsvp_service().detail(user, chat_id, event_id, data.answer)

    @app.get("/api/chats/{chat_id}/events/{event_id}/unanswered", response_model=UnansweredView)
    async def unanswered_participants(
        chat_id: int,
        event_id: UUID,
        user: Annotated[Viewer, Depends(viewer)],
        after: Annotated[int, Query(ge=0, le=2**52 - 1)] = 0,
    ) -> UnansweredView:
        return await rsvp_service().unanswered(user, chat_id, event_id, after)

    @app.post("/api/chats/{chat_id}/events/{event_id}/campaigns", response_model=CampaignView)
    async def send_campaign(
        chat_id: int,
        event_id: UUID,
        data: CampaignInput,
        key: Annotated[UUID, Header(alias="Idempotency-Key")],
        user: Annotated[Viewer, Depends(viewer)],
    ) -> CampaignView:
        return await rsvp_service().campaign(user, chat_id, event_id, key, data)

    @app.get(
        "/api/chats/{chat_id}/events/{event_id}/campaigns/{campaign_id}",
        response_model=CampaignView,
    )
    async def campaign_status(
        chat_id: int, event_id: UUID, campaign_id: UUID, user: Annotated[Viewer, Depends(viewer)]
    ) -> CampaignView:
        return await rsvp_service().campaign_status(user, chat_id, event_id, campaign_id)

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
                        TopicResponse(
                            id=str(topic.thread_id), title=topic.title, enabled=topic.enabled
                        )
                        for topic in item.chat.topics
                        if topic.enabled or item.can_manage
                    ],
                    timezone=item.chat.timezone,
                    event_tag=item.chat.event_tag,
                    creation_policy="admins",
                    confirmation_required=item.chat.confirmation_required,
                    settings_version=item.chat.settings_version,
                )
                for item in result
            ],
            next_cursor=cursor,
        )

    def service() -> EventService:
        if event_service is None:
            raise HTTPException(503, "Бот ещё не настроен.")
        return event_service

    @app.put("/api/chats/{chat_id}/settings", status_code=204)
    async def configure(
        chat_id: int, data: ChatSettingsInput, user: Annotated[Viewer, Depends(viewer)]
    ) -> Response:
        await service().settings(user.id, chat_id, data)
        return Response(status_code=204)

    @app.get("/api/events", response_model=EventsView)
    async def list_events(
        user: Annotated[Viewer, Depends(viewer)],
        start: date,
        end: date,
        chat_id: int | None = None,
        topic_id: int | None = None,
        tag: Annotated[str | None, Query(max_length=33)] = None,
    ) -> EventsView:
        return await service().list(user.id, start, end, chat_id, topic_id, tag)

    @app.post("/api/chats/{chat_id}/events", response_model=EventView)
    async def create_event(
        chat_id: int,
        data: EventInput,
        key: Annotated[UUID, Header(alias="Idempotency-Key")],
        user: Annotated[Viewer, Depends(viewer)],
    ) -> EventView:
        return await service().create(user.id, chat_id, data, key)

    @app.put("/api/chats/{chat_id}/events/{event_id}", response_model=EventView)
    async def edit_event(
        chat_id: int, event_id: UUID, data: EventEdit, user: Annotated[Viewer, Depends(viewer)]
    ) -> EventView:
        payload = EventInput.model_validate(data.model_dump(exclude={"version"}))
        return await service().change(user.id, chat_id, event_id, data.version, data=payload)

    @app.post("/api/chats/{chat_id}/events/{event_id}/cancel", response_model=EventView)
    async def cancel_event(
        chat_id: int, event_id: UUID, data: VersionInput, user: Annotated[Viewer, Depends(viewer)]
    ) -> EventView:
        return await service().change(user.id, chat_id, event_id, data.version, action="cancel")

    @app.post("/api/chats/{chat_id}/events/{event_id}/approve", response_model=EventView)
    async def approve_event(
        chat_id: int, event_id: UUID, data: VersionInput, user: Annotated[Viewer, Depends(viewer)]
    ) -> EventView:
        return await service().change(user.id, chat_id, event_id, data.version, action="approve")

    @app.post("/api/chats/{chat_id}/events/{event_id}/retry", status_code=204)
    async def retry_publication(
        chat_id: int, event_id: UUID, data: RetryInput, user: Annotated[Viewer, Depends(viewer)]
    ) -> Response:
        await service().access.authorize(user.id, chat_id, manage=True)
        await PublicationRepository(db).retry(chat_id, event_id, data.ack_duplicate_risk)
        return Response(status_code=204)

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
