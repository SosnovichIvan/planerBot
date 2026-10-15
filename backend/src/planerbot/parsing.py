import re
from datetime import date, datetime

from pydantic import ValidationError

from planerbot.event_contracts import EventInput, InvalidEvent

TEMPLATE = (
    "Название: Встреча команды\nДата: 20.10.2026\nВремя: 19:00–20:00\n"
    "Место: Кафе Маяк\nАдрес: Москва, ул. Примерная, 10\nОписание: Планы команды"
)


def parse_event(raw: str, topic_id: int) -> EventInput:
    mapping = {
        "название": "title",
        "дата": "start_date",
        "время": "time",
        "окончание": "end_date",
        "описание": "description",
        "место": "place",
        "адрес": "address",
        "карта": "map_url",
        "ссылка": "online_url",
        "формат": "meeting_format",
    }
    fields: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("/event") or re.fullmatch(r"(?:#[\w]+\s*)+", line):
            continue
        label, separator, value = line.partition(":")
        key = mapping.get(label.casefold())
        if not separator and "title" not in fields:
            key, value = "title", line
        if key is None or key in fields:
            raise InvalidEvent(
                "Проверьте названия полей и уберите повторы. Используйте шаблон /event."
            )
        fields[key] = value.strip()

    def day(value: str) -> date:
        if not re.fullmatch(r"\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return (
            datetime.strptime(value, "%d.%m.%Y").date()
            if "." in value
            else date.fromisoformat(value)
        )

    try:
        clock = fields.pop("time", "")
        clocks = re.split(r"\s*[–—-]\s*", clock) if clock else []
        if len(clocks) > 2:
            raise ValueError
        meeting = fields.pop("meeting_format", "Офлайн").casefold()
        formats = {"офлайн": "offline", "онлайн": "online", "гибридная": "hybrid"}
        payload: dict[str, object] = dict(fields)
        payload.update(
            topic_id=topic_id,
            start_date=day(fields.get("start_date", "")),
            end_date=day(fields["end_date"]) if fields.get("end_date") else None,
            start_time=clocks[0] if clocks else None,
            end_time=clocks[1] if len(clocks) == 2 else None,
            meeting_format=formats.get(meeting, meeting),
            place_pending=not any(fields.get(key) for key in ["place", "address", "online_url"]),
            tags=list(dict.fromkeys(re.findall(r"(?<!\w)#[\w]+", raw))),
        )
        return EventInput.model_validate(payload)
    except (ValueError, ValidationError) as exc:
        raise InvalidEvent(
            "Проверьте дату, время, место и ссылки. Шаблон доступен по /event."
        ) from exc
