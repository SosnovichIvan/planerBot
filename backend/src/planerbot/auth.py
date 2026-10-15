import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class Unauthorized(Exception):
    pass


class Viewer(BaseModel):
    model_config = ConfigDict(strict=True)

    id: int = Field(gt=0, le=2**52 - 1)
    first_name: str = Field(min_length=1, max_length=256)


def validate_init_data(raw: str, token: str, ttl: int, *, now: int | None = None) -> Viewer:
    """Verify Telegram HMAC before interpreting any identity fields."""
    if not token or not raw or len(raw) > 16384:
        raise Unauthorized
    try:
        pairs = parse_qsl(raw, strict_parsing=True, keep_blank_values=True, max_num_fields=32)
        values = dict(pairs)
        if len(values) != len(pairs):
            raise Unauthorized
        received_hash = values.pop("hash")
        check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
        key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        expected = hmac.new(key, check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received_hash):
            raise Unauthorized
        age = (int(time.time()) if now is None else now) - int(values["auth_date"])
        if age < -30 or age > ttl:
            raise Unauthorized
        return Viewer.model_validate(json.loads(values["user"]))
    except (ValueError, KeyError, TypeError, ValidationError) as exc:
        raise Unauthorized from exc
