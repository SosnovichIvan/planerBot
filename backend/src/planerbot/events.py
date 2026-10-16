import re
from datetime import date, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from planerbot.access import ChatAccess
from planerbot.event_contracts import (
    ChatSettingsInput,
    EventInput,
    EventsView,
    EventView,
    InvalidEvent,
)
from planerbot.event_repository import EventRepository
from planerbot.repository import ChatRecord, ChatRepository


class EventService:
    def __init__(self, access: ChatAccess, chats: ChatRepository, events: EventRepository):
        self.access, self.chats, self.events = access, chats, events

    @staticmethod
    def topic(chat: ChatRecord, topic_id: int) -> None:
        if not any(topic.thread_id == topic_id and topic.enabled for topic in chat.topics):
            raise InvalidEvent("Выберите включённую тему этого чата")

    @staticmethod
    def located(data: EventInput) -> EventInput:
        try:
            data.require_location()
        except ValueError as exc:
            raise InvalidEvent(str(exc)) from exc
        return data.model_copy(update={"place_pending": False})

    async def settings(self, user_id: int, chat_id: int, data: ChatSettingsInput) -> None:
        await self.access.authorize(user_id, chat_id, manage=True)
        await self.chats.configure(chat_id, data)

    async def create(self, user_id: int, chat_id: int, data: EventInput, key: UUID) -> EventView:
        target = await self.access.authorize(user_id, chat_id, manage=True)
        self.topic(target.chat, data.topic_id)
        data = self.located(data)
        event_id = uuid5(NAMESPACE_URL, f"form:{chat_id}:{user_id}:{key}")
        result = await self.events.create(chat_id, user_id, data, target.chat.timezone, event_id)
        return result.model_copy(update={"can_manage": True})

    async def change(
        self,
        user_id: int,
        chat_id: int,
        event_id: UUID,
        version: int,
        *,
        data: EventInput | None = None,
        action: str | None = None,
    ) -> EventView:
        target = await self.access.authorize(user_id, chat_id, manage=True)
        if data is not None:
            self.topic(target.chat, data.topic_id)
            data = self.located(data)
        result = await self.events.change(
            chat_id, event_id, user_id, version, data=data, action=action
        )
        return result.model_copy(update={"can_manage": True})

    async def list(
        self,
        user_id: int,
        start: date,
        end: date,
        chat_id: int | None,
        topic_id: int | None,
        tag: str | None,
    ) -> EventsView:
        if not 0 < (end - start).days <= 62:
            raise InvalidEvent("Выберите диапазон не больше 62 дней")
        targets = (
            [await self.access.authorize(user_id, chat_id)]
            if chat_id is not None
            else await self.access.all_for(user_id)
        )
        result = await self.events.list(
            [t.chat.id for t in targets],
            [t.chat.id for t in targets if t.can_manage],
            start,
            end,
            topic_id,
            tag,
        )
        from sqlalchemy import select

        from planerbot.models import EventResponse

        async with self.events.sessions() as session:
            answers = dict(
                (
                    await session.execute(
                        select(EventResponse.event_id, EventResponse.answer).where(
                            EventResponse.user_id == user_id,
                            EventResponse.event_id.in_([event.id for event in result.events]),
                        )
                    )
                ).all()
            )
        return result.model_copy(
            update={
                "events": [
                    event.model_copy(update={"my_response": answers.get(event.id, "unanswered")})
                    for event in result.events
                ]
            }
        )

    async def import_message(
        self,
        user_id: int,
        chat_id: int,
        topic_id: int,
        text: str,
        message_id: int,
        source_date: datetime,
        update_id: int,
        *,
        command: bool = False,
    ) -> EventView | None:
        # Ignore ordinary discussion before making membership network calls.
        chat = await self.chats.get(chat_id)
        if chat is None:
            return None
        if not command and chat.event_tag.casefold() not in [
            tag.casefold() for tag in re.findall(r"(?<!\w)#[\w]+", text)
        ]:
            return None
        await self.access.authorize(user_id, chat_id, manage=True)
        self.topic(chat, topic_id)
        from planerbot.parsing import parse_event

        data = self.located(parse_event(text, topic_id))
        status = "pending" if not command and chat.confirmation_required else "active"
        key = uuid5(NAMESPACE_URL, f"telegram:{chat_id}:{message_id}")
        return await self.events.create(
            chat_id,
            user_id,
            data,
            chat.timezone,
            key,
            status=status,
            source="bot" if command else "message",
            message_id=message_id,
            source_date=source_date,
            update_id=update_id,
        )
