from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    database_url: str = "postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot"
    bot_token: SecretStr = SecretStr("")
    webhook_secret: SecretStr = SecretStr("")
    telegram_proxy_url: SecretStr = SecretStr("")
    init_data_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    support_chat_id: int = Field(default=0, ge=0, le=2**52 - 1)

    @field_validator("telegram_proxy_url")
    @classmethod
    def validate_proxy(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw:
            return value
        try:
            url = urlsplit(raw)
            valid = (
                url.scheme == "http"
                and url.hostname
                and url.port
                and not url.username
                and not url.password
                and url.path in ("", "/")
                and not url.query
                and not url.fragment
                and not any(char.isspace() for char in raw)
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("TELEGRAM_PROXY_URL must be an HTTP host:port without credentials")
        return value
