from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot"
    bot_token: SecretStr = SecretStr("")
    webhook_secret: SecretStr = SecretStr("")
    init_data_ttl_seconds: int = Field(default=300, ge=30, le=3600)
