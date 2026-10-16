"""Fail closed before deployment; never print environment values."""

import re
import sys
from pathlib import Path


def validate(contents: str) -> bool:
    values: dict[str, str] = {}
    for line in contents.splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            return False
        values[key] = value
    return (
        set(values) == {"BOT_TOKEN", "POSTGRES_PASSWORD", "ACME_AGREE_TOS", "TELEGRAM_PROXY_URL"}
        and re.fullmatch(r"[0-9]{5,20}:[A-Za-z0-9_-]{30,60}", values["BOT_TOKEN"]) is not None
        and re.fullmatch(r"[a-fA-F0-9]{32,128}", values["POSTGRES_PASSWORD"]) is not None
        and values["ACME_AGREE_TOS"] == "yes"
        and values["TELEGRAM_PROXY_URL"] == "http://telegram-proxy:19840"
    )


if __name__ == "__main__":
    if not validate(Path(sys.argv[1]).read_text()):
        sys.exit(
            "Invalid runtime.env: require token, hex DB password, ACME agreement and proxy URL"
        )
