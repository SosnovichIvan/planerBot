"""Regenerate the canonical HTTP contract without connecting to Telegram or PostgreSQL."""

import json
from pathlib import Path

from planerbot.api import create_app
from planerbot.config import Settings

Path("backend/openapi.json").write_text(
    json.dumps(create_app(Settings(_env_file=None, bot_token="")).openapi(), indent=2) + "\n"
)
