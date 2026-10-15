from datetime import UTC, datetime
from unittest.mock import AsyncMock

from planerbot.access import ChatAccess, Membership
from planerbot.event_contracts import EventInput
from planerbot.event_repository import EventRepository
from planerbot.events import EventService
from planerbot.repository import ChatRepository

A, B = -100100, -100200
STAMP = datetime(2026, 10, 15, tzinfo=UTC)


def draft(**values):
    return EventInput.model_validate(
        {
            "topic_id": 10,
            "title": "Встреча",
            "start_date": "2026-10-20",
            "start_time": "19:00",
            "place": "Кафе",
            "address": "Москва",
            "place_pending": False,
            "tags": ["#команда"],
            **values,
        }
    )


async def services(engine):
    chats = ChatRepository(engine)
    await chats.register(A, "А", 10, "Встречи")
    await chats.register(B, "Б", 20, "Клуб")
    gateway = AsyncMock()
    roles = {(A, 42): "administrator", (B, 42): "administrator", (A, 43): "member"}

    async def membership(chat_id, user_id):
        return Membership(
            "administrator" if user_id == 1 else roles.get((chat_id, user_id), "left")
        )

    gateway.membership.side_effect = membership
    access = ChatAccess(chats, gateway, 1)
    return EventService(access, chats, EventRepository(engine)), gateway, roles
