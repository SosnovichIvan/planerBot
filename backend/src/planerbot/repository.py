from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.event_contracts import ChatSettingsInput, Conflict, InvalidEvent
from planerbot.models import Chat, Topic


@dataclass(frozen=True)
class TopicRecord:
    thread_id: int
    title: str
    enabled: bool = True


@dataclass(frozen=True)
class ChatRecord:
    id: int
    title: str
    topics: tuple[TopicRecord, ...]
    timezone: str = "UTC"
    event_tag: str = "#событие"
    creation_policy: str = "admins"
    confirmation_required: bool = False
    settings_version: int = 1


PAGE_SIZE = 25


class ChatRepository:
    def __init__(self, engine: AsyncEngine):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def set_active(self, chat_id: int, active: bool) -> None:
        async with self.sessions.begin() as session:
            await session.execute(update(Chat).where(Chat.id == chat_id).values(active=active))

    async def register(
        self,
        chat_id: int,
        title: str,
        thread_id: int,
        topic_title: str,
        *,
        overwrite_title: bool = True,
    ) -> None:
        async with self.sessions.begin() as session:
            await session.execute(
                insert(Chat)
                .values(id=chat_id, title=title, active=True)
                .on_conflict_do_update(
                    index_elements=[Chat.id], set_={"title": title, "active": True}
                )
            )
            topic = insert(Topic).values(chat_id=chat_id, thread_id=thread_id, title=topic_title)
            await session.execute(
                topic.on_conflict_do_update(
                    index_elements=[Topic.chat_id, Topic.thread_id], set_={"title": topic_title}
                )
                if overwrite_title
                else topic.on_conflict_do_nothing()
            )

    async def candidates(self, after: int | None) -> list[ChatRecord]:
        query = select(Chat).where(Chat.active).order_by(Chat.id).limit(PAGE_SIZE)
        if after is not None:
            query = query.where(Chat.id > after)
        async with self.sessions() as session:
            chats = list(await session.scalars(query))
            topics = list(
                await session.scalars(
                    select(Topic)
                    .where(Topic.chat_id.in_([chat.id for chat in chats]))
                    .order_by(Topic.thread_id)
                )
            )
            return [
                ChatRecord(
                    chat.id,
                    chat.title,
                    tuple(
                        TopicRecord(topic.thread_id, topic.title, topic.enabled)
                        for topic in topics
                        if topic.chat_id == chat.id
                    ),
                    chat.timezone,
                    chat.event_tag,
                    chat.creation_policy,
                    chat.confirmation_required,
                    chat.settings_version,
                )
                for chat in chats
            ]

    async def get(self, chat_id: int) -> ChatRecord | None:
        async with self.sessions() as session:
            chat = await session.get(Chat, chat_id)
            if chat is None or not chat.active:
                return None
            topics = await session.scalars(
                select(Topic).where(Topic.chat_id == chat_id).order_by(Topic.thread_id)
            )
            return ChatRecord(
                chat.id,
                chat.title,
                tuple(TopicRecord(t.thread_id, t.title, t.enabled) for t in topics),
                chat.timezone,
                chat.event_tag,
                chat.creation_policy,
                chat.confirmation_required,
                chat.settings_version,
            )

    async def configure(self, chat_id: int, data: ChatSettingsInput) -> None:
        async with self.sessions.begin() as session:
            chat = await session.scalar(
                select(Chat).where(Chat.id == chat_id, Chat.active).with_for_update()
            )
            if chat is None or chat.settings_version != data.version:
                raise Conflict("Настройки изменились. Обновите список чатов.")
            topics = list(await session.scalars(select(Topic).where(Topic.chat_id == chat_id)))
            if not set(data.enabled_topic_ids).issubset(t.thread_id for t in topics):
                raise InvalidEvent("Тема не принадлежит этому чату")
            chat.timezone, chat.event_tag = data.timezone, data.event_tag.casefold()
            chat.creation_policy = data.creation_policy
            chat.confirmation_required = data.confirmation_required
            chat.settings_version += 1
            for topic in topics:
                topic.enabled = topic.thread_id in data.enabled_topic_ids
