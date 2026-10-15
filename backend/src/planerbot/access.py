import asyncio
from dataclasses import dataclass
from typing import Protocol

from planerbot.repository import PAGE_SIZE, ChatRecord


class AccessUnavailable(Exception):
    pass


class AccessDenied(Exception):
    pass


@dataclass(frozen=True)
class Membership:
    status: str
    is_member: bool = False

    @property
    def present(self) -> bool:
        return self.status in {"creator", "administrator", "member"} or (
            self.status == "restricted" and self.is_member
        )

    @property
    def admin(self) -> bool:
        return self.status in {"creator", "administrator"}


class MembershipGateway(Protocol):
    async def membership(self, chat_id: int, user_id: int) -> Membership: ...


class ChatStore(Protocol):
    async def get(self, chat_id: int) -> ChatRecord | None: ...
    async def set_active(self, chat_id: int, active: bool) -> None: ...

    async def candidates(self, after: int | None) -> list[ChatRecord]: ...

    async def register(
        self, chat_id: int, title: str, thread_id: int, topic_title: str
    ) -> None: ...


@dataclass(frozen=True)
class AccessibleChat:
    chat: ChatRecord
    can_manage: bool


class ChatAccess:
    def __init__(self, store: ChatStore, telegram: MembershipGateway, bot_id: int):
        self.store = store
        self.telegram = telegram
        self.bot_id = bot_id

    async def authorize(
        self, user_id: int, chat_id: int, *, manage: bool = False
    ) -> AccessibleChat:
        chat = await self.store.get(chat_id)
        if chat is None:
            raise AccessDenied
        bot = await self.telegram.membership(chat_id, self.bot_id)
        member = await self.telegram.membership(chat_id, user_id)
        if not bot.admin or not member.present or (manage and not member.admin):
            raise AccessDenied
        return AccessibleChat(chat, member.admin)

    async def all_for(self, user_id: int) -> list[AccessibleChat]:
        result: list[AccessibleChat] = []
        cursor: str | None = None
        while True:
            page, cursor = await self.list_for(user_id, int(cursor) if cursor else None)
            result.extend(page)
            if cursor is None:
                return result

    async def list_for(
        self, user_id: int, after: int | None
    ) -> tuple[list[AccessibleChat], str | None]:
        candidates = await self.store.candidates(after)
        semaphore = asyncio.Semaphore(4)

        async def check(chat: ChatRecord) -> AccessibleChat | None:
            async with semaphore:
                bot = await self.telegram.membership(chat.id, self.bot_id)
                if not bot.admin:
                    return None
                member = await self.telegram.membership(chat.id, user_id)
                return AccessibleChat(chat, member.admin) if member.present else None

        results = await asyncio.gather(*(check(chat) for chat in candidates))
        # Cursor exposes no names. A future public catalog should use opaque cursors.
        cursor = str(candidates[-1].id) if len(candidates) == PAGE_SIZE else None
        return [chat for chat in results if chat is not None], cursor
