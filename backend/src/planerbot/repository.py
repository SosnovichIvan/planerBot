from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from planerbot.models import Chat, Topic


@dataclass(frozen=True)
class TopicRecord:
    thread_id: int
    title: str


@dataclass(frozen=True)
class ChatRecord:
    id: int
    title: str
    topics: tuple[TopicRecord, ...]


PAGE_SIZE = 25


class ChatRepository:
    def __init__(self, engine: AsyncEngine):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def set_active(self, chat_id: int, active: bool) -> None:
        async with self.sessions.begin() as session:
            await session.execute(update(Chat).where(Chat.id == chat_id).values(active=active))

    async def register(self, chat_id: int, title: str, thread_id: int, topic_title: str) -> None:
        async with self.sessions.begin() as session:
            await session.execute(
                insert(Chat)
                .values(id=chat_id, title=title, active=True)
                .on_conflict_do_update(
                    index_elements=[Chat.id], set_={"title": title, "active": True}
                )
            )
            await session.execute(
                insert(Topic)
                .values(chat_id=chat_id, thread_id=thread_id, title=topic_title)
                .on_conflict_do_update(
                    index_elements=[Topic.chat_id, Topic.thread_id], set_={"title": topic_title}
                )
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
                        TopicRecord(topic.thread_id, topic.title)
                        for topic in topics
                        if topic.chat_id == chat.id
                    ),
                )
                for chat in chats
            ]
