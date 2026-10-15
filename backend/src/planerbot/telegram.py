from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from planerbot.access import AccessUnavailable, Membership


class TelegramGateway:
    def __init__(self, bot: Bot):
        self.bot = bot

    async def membership(self, chat_id: int, user_id: int) -> Membership:
        try:
            member = await self.bot.get_chat_member(chat_id, user_id, request_timeout=5)
        except (TimeoutError, TelegramAPIError) as exc:
            raise AccessUnavailable from exc
        return Membership(member.status, getattr(member, "is_member", False))
