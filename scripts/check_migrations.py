"""Exercise upgrade from populated 0001. This command may touch only planerbot_test."""

import asyncio
import json
import os
import subprocess
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

url = os.environ["DATABASE_URL"]
if not url.endswith("/planerbot_test"):
    raise SystemExit("Only the isolated planerbot_test database is permitted")


def alembic(*args: str) -> None:
    subprocess.run([sys.executable, "-m", "alembic", *args], check=True)


async def seed() -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO chats (id,title,active) VALUES (-999,'Migration fixture',true) "
                "ON CONFLICT (id) DO NOTHING"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO topics (chat_id,thread_id,title) VALUES (-999,1,'General') "
                "ON CONFLICT DO NOTHING"
            )
        )
    await engine.dispose()


async def verify() -> None:
    engine = create_async_engine(url)
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text("SELECT timezone,event_tag,settings_version FROM chats WHERE id=-999")
            )
        ).one()
        assert tuple(row) == ("UTC", "#событие", 1)
        assert await connection.scalar(text("SELECT enabled FROM topics WHERE chat_id=-999"))
        assert (
            await connection.scalar(
                text(
                    "SELECT message_id FROM publications "
                    "WHERE event_id='00000000-0000-4000-8000-000000000099'"
                )
            )
            == 7
        )
        assert (
            await connection.scalar(
                text(
                    "SELECT payload->>'title' FROM events "
                    "WHERE id='00000000-0000-4000-8000-000000000099'"
                )
            )
            == "Existing event"
        )
        assert await connection.scalar(text("SELECT count(*) FROM calendar_participants")) == 1
        assert (
            await connection.scalar(text("SELECT answer FROM event_responses WHERE user_id=42"))
            == "yes"
        )
        assert await connection.scalar(text("SELECT count(*) FROM event_revisions")) == 0
        assert await connection.scalar(text("SELECT count(*) FROM event_seen")) == 0
        assert (
            await connection.scalar(
                text(
                    "SELECT status FROM publications "
                    "WHERE event_id='00000000-0000-4000-8000-000000000100'"
                )
            )
            == "pending"
        )
        assert await connection.scalar(text("SELECT count(*) FROM support_tickets")) == 0
        assert (
            await connection.scalar(
                text(
                    "SELECT message_id FROM publications "
                    "WHERE event_id='00000000-0000-4000-8000-000000000100'"
                )
            )
            == 88
        )
        assert (
            await connection.scalar(
                text(
                    "SELECT status FROM publications "
                    "WHERE event_id='00000000-0000-4000-8000-000000000101'"
                )
            )
            == "pending"
        )
    await engine.dispose()


async def seed_event() -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(
            text("""
            INSERT INTO events (id,chat_id,topic_id,creator_id,editor_id,payload,fingerprint,
                timezone,local_date,starts_at,version,status,source,source_update_id)
            VALUES ('00000000-0000-4000-8000-000000000099',-999,1,42,42,
                CAST(:payload AS jsonb),
                'migration-fixture','UTC','2026-10-20','2026-10-20T00:00:00Z',1,'active','form',0)
        """),
            {
                "payload": json.dumps(
                    {"title": "Existing event", "topic_id": 1, "start_date": "2026-10-20"}
                )
            },
        )
        await connection.execute(
            text("""
            INSERT INTO publications (event_id,status,desired_version,message_id)
            VALUES ('00000000-0000-4000-8000-000000000099','published',1,7)
        """)
        )
    await engine.dispose()


async def seed_response() -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(
            text("INSERT INTO calendar_participants VALUES (-999,42,'Viewer')")
        )
        await connection.execute(
            text(
                "INSERT INTO event_responses VALUES "
                "('00000000-0000-4000-8000-000000000099',42,'yes')"
            )
        )
    await engine.dispose()


async def seed_cancelled() -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(
            text("""
            INSERT INTO events (id,chat_id,topic_id,creator_id,editor_id,payload,fingerprint,
                timezone,local_date,starts_at,version,status,source,source_message_id,source_update_id)
            SELECT '00000000-0000-4000-8000-000000000100',chat_id,topic_id,creator_id,editor_id,
                payload,fingerprint,timezone,local_date,starts_at,2,'cancelled','message',88,0
            FROM events WHERE id='00000000-0000-4000-8000-000000000099'
        """)
        )
        await connection.execute(
            text("""
            INSERT INTO events (id,chat_id,topic_id,creator_id,editor_id,payload,fingerprint,
                timezone,local_date,starts_at,version,status,source,source_update_id)
            SELECT '00000000-0000-4000-8000-000000000101',chat_id,topic_id,creator_id,editor_id,
                payload,fingerprint,timezone,local_date,starts_at,2,'cancelled','form',0
            FROM events WHERE id='00000000-0000-4000-8000-000000000099'
        """)
        )
        await connection.execute(
            text("""
            INSERT INTO publications(event_id,status,desired_version,message_id)
            VALUES ('00000000-0000-4000-8000-000000000101','published',2,89)
        """)
        )
    await engine.dispose()


alembic("downgrade", "base")
alembic("upgrade", "head")
alembic("check")
alembic("downgrade", "0001")
asyncio.run(seed())
alembic("upgrade", "0002")
asyncio.run(seed_event())
alembic("upgrade", "0003")
asyncio.run(seed_response())
alembic("upgrade", "0004")
asyncio.run(seed_cancelled())
alembic("upgrade", "head")
asyncio.run(verify())
alembic("check")
print("Empty upgrade and populated 0001 -> 0006 preserved data and added empty support queue")
