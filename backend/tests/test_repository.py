import asyncio

import pytest
from planerbot.models import Chat, Topic
from planerbot.repository import ChatRepository
from sqlalchemy import insert, update
from sqlalchemy.exc import IntegrityError


async def test_register_scope_repeat_and_update(engine):
    store = ChatRepository(engine)
    await asyncio.gather(*(store.register(-1, "А", 10, "Встречи") for _ in range(4)))
    await store.register(-2, "Б", 10, "Занятия")
    await store.register(-1, "А новое", 10, "Встречи новые")
    records = await store.candidates(None)
    assert [record.title for record in records] == ["Б", "А новое"]
    assert records[0].topics[0].title == "Занятия"
    assert records[1].topics[0].title == "Встречи новые"
    assert [record.id for record in await store.candidates(-2)] == [-1]
    assert await store.candidates(-1) == []


async def test_foreign_key_and_rollback(engine):
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(insert(Topic).values(chat_id=-9, thread_id=1, title="Unknown"))
    assert await ChatRepository(engine).candidates(None) == []


async def test_discovery_preserves_settings_disabled_topic_and_custom_name(engine):
    store = ChatRepository(engine)
    await store.register(-1, "А", 10, "Встречи")
    async with engine.begin() as connection:
        await connection.execute(update(Topic).values(enabled=False))
        await connection.execute(
            update(Chat).values(timezone="Europe/Moscow", event_tag="#встреча")
        )
    await asyncio.gather(
        *(store.register(-1, "А", 10, "Тема 10", overwrite_title=False) for _ in range(4))
    )
    record = await store.get(-1)
    assert record.timezone == "Europe/Moscow" and record.event_tag == "#встреча"
    assert record.topics[0].title == "Встречи" and not record.topics[0].enabled
    await store.register(-1, "А", 10, "Новое имя", overwrite_title=True)
    record = await store.get(-1)
    assert record.topics[0].title == "Новое имя" and not record.topics[0].enabled
