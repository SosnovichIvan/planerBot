import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlencode

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot_test",
)


def signed(values=None, *, user_id=42, token=TOKEN):
    values = (
        values
        if values is not None
        else {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": user_id, "first_name": "Иван"}),
        }
    )
    check = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    return urlencode({**values, "hash": hmac.new(key, check.encode(), hashlib.sha256).hexdigest()})


@pytest.fixture
async def engine():
    assert TEST_DB.endswith("/planerbot_test"), "Only the isolated test database may be cleared"
    db = create_async_engine(TEST_DB)
    async with db.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE support_replies, support_tickets, event_revisions, event_seen, "
                "personal_notices, "
                "message_campaigns, event_responses, "
                "calendar_participants, personal_contacts, publications, events, topics, chats"
            )
        )
    yield db
    await db.dispose()
