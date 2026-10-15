from datetime import UTC, datetime

import pytest
from event_helpers import draft
from planerbot.event_contracts import ChatSettingsInput, InvalidEvent
from planerbot.parsing import parse_event
from pydantic import ValidationError


def test_settings_and_fields():
    with pytest.raises(ValidationError):
        ChatSettingsInput(version=1, timezone="UTC", event_tag="#" + "ß" * 32, enabled_topic_ids=[])
    assert ChatSettingsInput(
        version=1, timezone="Europe/Moscow", event_tag="#событие", enabled_topic_ids=[]
    )
    for zone in ["Missing/Zone", "../etc/passwd"]:
        with pytest.raises(ValidationError):
            ChatSettingsInput(version=1, timezone=zone, event_tag="#событие", enabled_topic_ids=[])
    item = draft(tags=["#КОМАНДА", "#команда"], map_url="https://maps.example/path")
    assert item.tags == ["#команда"]
    assert item.times("Europe/Moscow")[0] == datetime(2026, 10, 20, 16, tzinfo=UTC)
    assert draft(start_time=None).times("UTC")[1] is None


@pytest.mark.parametrize(
    "fields",
    [
        {"title": " "},
        {"tags": ["no-tag"]},
        {"start_time": "25:90"},
        {"map_url": "javascript:alert(1)"},
        {"map_url": "https://user:pass@maps.test"},
        {"map_url": "https://maps.test/a b"},
        {"online_url": "https:///missing"},
        {"start_time": None, "end_time": "20:00"},
        {"end_date": "2026-10-21", "end_time": None},
        {"place": "", "address": ""},
        {"meeting_format": "online", "online_url": ""},
    ],
)
def test_invalid_fields(fields):
    with pytest.raises(ValidationError):
        draft(**fields)


def test_time_order_and_dst():
    with pytest.raises(InvalidEvent):
        draft(start_date="0001-01-01", start_time="00:00").times("Europe/Moscow")
    with pytest.raises(ValidationError):
        draft(
            description="😀" * 1200,
            title="😀" * 120,
            address="😀" * 300,
            place="😀" * 120,
            map_url="https://example.test/" + "😀" * 300,
        )
    assert draft(end_time="20:00").times("UTC")[1].hour == 20
    assert draft(end_date="2026-10-21", end_time="01:00").times("UTC")[1].day == 21
    assert draft(meeting_format="online", online_url="http://example.test/meet")
    for values in [
        {"end_time": "18:00"},
        {"start_date": "2026-03-29", "start_time": "02:30"},
        {"start_date": "2026-10-25", "start_time": "02:30"},
    ]:
        with pytest.raises(InvalidEvent):
            draft(**values).times("Europe/Berlin")


def test_parse_strict_message_and_caption():
    event = parse_event(
        "#событие #клуб\nВстреча клуба\nДата: 20.10.2026\n"
        "Время: 19:00—20:00\nМесто: Кафе\nОписание: Книга",
        10,
    )
    assert event.title == "Встреча клуба"
    assert event.start_time == "19:00" and event.end_time == "20:00"
    assert not event.place_pending
    assert (
        parse_event(
            "/event\nНазвание: Онлайн\nДата: 2026-10-20\nФормат: Онлайн\nСсылка: https://example.test",
            10,
        ).meeting_format
        == "online"
    )
    assert parse_event("#событие\nНазвание: День\nДата: 2026-10-20\n", 10).place_pending
    assert (
        parse_event(
            "#событие\nНазвание: Ночь\nДата: 2026-10-20\nОкончание: 21.10.2026\nВремя: 23:00-01:00",
            10,
        ).end_date.day
        == 21
    )


@pytest.mark.parametrize(
    "raw",
    [
        "#событие\nНазвание: A\nНазвание: B",
        "#событие\nЗаголовок\nПросто текст",
        "#событие\nДата: завтра",
        "#событие\nНазвание: A\nДата: 2026-10-20\nВремя: 1-2-3",
        "#событие\nНазвание: A\nДата: 2026-02-30",
    ],
)
def test_parse_errors(raw):
    with pytest.raises(InvalidEvent):
        parse_event(raw, 10)
