"""Exercise upgrade from populated 0001. This command may touch only planerbot_test."""

import asyncio
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
    await engine.dispose()


alembic("downgrade", "0001")
asyncio.run(seed())
alembic("upgrade", "head")
asyncio.run(verify())
alembic("check")
print("Populated 0001 -> 0002 preserved chat/topic registrations and added valid defaults")
