import re
from datetime import UTC, date, datetime, time
from typing import Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TAG = r"#[\w]{1,32}"


class Conflict(Exception):
    pass


class InvalidEvent(Exception):
    pass


class MissingEvent(Exception):
    pass


class ChatSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    version: int = Field(ge=1)
    timezone: str = Field(min_length=1, max_length=64)
    event_tag: str = Field(pattern=f"^{TAG}$")
    creation_policy: Literal["admins"] = "admins"
    confirmation_required: bool = False
    enabled_topic_ids: list[int] = Field(max_length=1000)

    @field_validator("event_tag")
    @classmethod
    def normalized_tag(cls, value: str) -> str:
        value = value.casefold()
        if not re.fullmatch(TAG, value):
            raise ValueError("Тег слишком длинный после нормализации")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Укажите часовой пояс IANA, например Europe/Moscow") from exc
        return value


class EventInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    topic_id: int = Field(ge=1, le=2**52)
    title: str = Field(min_length=1, max_length=120)
    start_date: date
    start_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end_date: date | None = None
    end_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    description: str = Field(default="", max_length=1200)
    meeting_format: Literal["offline", "online", "hybrid"] = "offline"
    place: str = Field(default="", max_length=120)
    address: str = Field(default="", max_length=300)
    map_url: str = Field(default="", max_length=400)
    online_url: str = Field(default="", max_length=400)
    place_pending: bool = True
    tags: list[str] = Field(default_factory=list, max_length=8)
    notify_members: bool = False

    @field_validator("map_url", "online_url")
    @classmethod
    def safe_url(cls, value: str) -> str:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if value and (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or any(char.isspace() for char in value)
        ):
            raise ValueError("Ссылка должна начинаться с https:// или http://")
        return value

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, values: list[str]) -> list[str]:
        values = [value.casefold() for value in values]
        if any(not re.fullmatch(TAG, tag) for tag in values):
            raise ValueError("Теги: #слово, не больше 32 символов после #")
        return list(dict.fromkeys(tag.casefold() for tag in values))

    @model_validator(mode="after")
    def valid_fields(self) -> Self:
        content = " ".join(
            [
                self.title,
                self.description,
                self.place,
                self.address,
                self.map_url,
                self.online_url,
                *self.tags,
            ]
        )
        if len(content.encode("utf-16-le")) // 2 > 3600:
            raise ValueError("Сократите описание и место: карточка слишком длинная для Telegram")
        if self.start_time is None and self.end_time is not None:
            raise ValueError("Укажите время начала")
        if self.end_date is not None and self.end_date != self.start_date and self.end_time is None:
            raise ValueError("Для многодневной встречи укажите время окончания")
        if not self.place_pending:
            self.require_location()
        return self

    def require_location(self) -> None:
        if not (self.place or self.address or self.map_url or self.online_url):
            raise ValueError("Укажите место встречи или ссылку подключения")

    def times(self, timezone: str) -> tuple[datetime, datetime | None]:
        zone = ZoneInfo(timezone)

        def convert(day: date, clock: str | None) -> datetime:
            local = datetime.combine(day, time.fromisoformat(clock or "00:00"))
            aware = local.replace(tzinfo=zone)
            try:
                utc = aware.astimezone(UTC)
            except OverflowError as exc:
                raise InvalidEvent("Дата выходит за допустимый диапазон") from exc
            if utc.astimezone(zone).replace(tzinfo=None) != local:
                raise InvalidEvent("Такого местного времени нет из-за перевода часов")
            if aware.utcoffset() != local.replace(tzinfo=zone, fold=1).utcoffset():
                raise InvalidEvent("Время неоднозначно из-за перевода часов")
            return utc

        start = convert(self.start_date, self.start_time)
        end = convert(self.end_date or self.start_date, self.end_time) if self.end_time else None
        if end is not None and end <= start:
            raise InvalidEvent("Окончание должно быть позже начала")
        return start, end


class EventEdit(EventInput):
    version: int = Field(ge=1)


class VersionInput(BaseModel):
    version: int = Field(ge=1)


class RetryInput(BaseModel):
    ack_duplicate_risk: bool = False


class EventChange(BaseModel):
    field: str
    before: str
    after: str


class EventView(BaseModel):
    id: UUID
    chat_id: str
    chat_title: str
    topic_title: str
    data: EventInput
    timezone: str
    starts_at: datetime
    ends_at: datetime | None
    version: int
    status: str
    source: str
    source_message_id: int | None
    publication_status: str | None
    message_url: str | None = None
    can_manage: bool = False
    my_response: Literal["yes", "no", "unanswered"] = "unanswered"
    has_updates: bool = False
    changes: list[EventChange] = Field(default_factory=list)


class EventsView(BaseModel):
    events: list[EventView]
    has_more: bool
