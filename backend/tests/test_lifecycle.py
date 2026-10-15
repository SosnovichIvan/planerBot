from unittest.mock import AsyncMock

from aiogram.types import Update
from planerbot.bot import create_dispatcher
from planerbot.repository import ChatRepository
from test_bot import bot_stub


async def test_losing_bot_rights_deactivates_existing_chat():
    store = AsyncMock()
    payload = {
        "update_id": 2,
        "my_chat_member": {
            "chat": {"id": -1, "type": "supergroup", "title": "А"},
            "from": {"id": 42, "is_bot": False, "first_name": "User"},
            "date": 0,
            "old_chat_member": {
                "status": "member",
                "user": {"id": 123456789, "is_bot": True, "first_name": "Bot"},
            },
            "new_chat_member": {
                "status": "left",
                "user": {"id": 123456789, "is_bot": True, "first_name": "Bot"},
            },
        },
    }
    await create_dispatcher(store, AsyncMock()).feed_update(
        bot_stub(), Update.model_validate(payload)
    )
    store.set_active.assert_awaited_once_with(-1, False)


async def test_deactivated_chat_is_not_a_candidate(engine):
    store = ChatRepository(engine)
    await store.register(-1, "А", 1, "Общая")
    await store.set_active(-1, False)
    assert await store.candidates(None) == []
    await store.set_active(-1, True)
    assert len(await store.candidates(None)) == 1
    await store.set_active(-99, True)
    assert len(await store.candidates(None)) == 1
