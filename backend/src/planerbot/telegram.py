from aiogram import Bot
from aiogram.exceptions import (
    TelegramAPIError,
    TelegramBadRequest,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, LinkPreviewOptions

from planerbot.access import AccessUnavailable, Membership
from planerbot.event_contracts import EventView
from planerbot.publications import DeliveryRejected, DeliveryUnknown
from planerbot.support import SupportJob


class TelegramGateway:
    def __init__(self, bot: Bot):
        self.bot = bot

    async def send_support(self, job: SupportJob) -> None:
        from planerbot.notices import Deferred

        contact = f"@{job.username}" if job.username else "ник не указан"
        text = (
            f"Техподдержка planerBot\nОбращение №{job.id.hex}\n"
            f"Пользователь: {job.name}\nTelegram: {contact}\nID: {job.user_id}\n\n{job.body}"
        )
        try:
            await self.bot.send_message(
                chat_id=job.target_id,
                text=text,
                parse_mode=None,
                link_preview_options=LinkPreviewOptions(is_disabled=True),
                request_timeout=10,
            )
        except TelegramRetryAfter as exc:
            raise Deferred(exc.retry_after) from exc
        except (TimeoutError, TelegramNetworkError, TelegramServerError) as exc:
            raise DeliveryUnknown from exc
        except TelegramAPIError as exc:
            raise DeliveryRejected from exc

    async def membership(self, chat_id: int, user_id: int) -> Membership:
        try:
            member = await self.bot.get_chat_member(chat_id, user_id, request_timeout=5)
        except (TimeoutError, TelegramAPIError) as exc:
            raise AccessUnavailable from exc
        return Membership(member.status, getattr(member, "is_member", False))

    async def send_personal(self, user_id: int, event: EventView, body: str) -> None:
        from planerbot.notices import Deferred

        header = (
            f"{event.data.title}\n{event.data.start_date} · "
            f"{event.data.start_time or 'Весь день'} ({event.timezone})\n{event.chat_title}"
        )
        location = "\n".join(
            filter(
                None,
                [event.data.place, event.data.address, event.data.map_url, event.data.online_url],
            )
        )
        full = f"{header}\n{location}\n\n{body}"
        # Never truncate the administrator's message. Long location stays in the linked card.
        content = full if len(full.encode("utf-16-le")) // 2 <= 4096 else f"{header}\n\n{body}"
        try:
            me = await self.bot.get_me(request_timeout=5)
            await self.bot.send_message(
                chat_id=user_id,
                text=content,
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [
                            InlineKeyboardButton(
                                text="Открыть событие",
                                url=f"https://t.me/{me.username}?startapp=event_{event.chat_id}_{event.id.hex}",
                            )
                        ]
                    ]
                ),
                link_preview_options=LinkPreviewOptions(is_disabled=True),
                request_timeout=10,
            )
        except TelegramRetryAfter as exc:
            raise Deferred(exc.retry_after) from exc
        except (TimeoutError, TelegramNetworkError, TelegramServerError) as exc:
            raise DeliveryUnknown from exc
        except TelegramAPIError as exc:
            raise DeliveryRejected from exc

    async def send_card(self, event: EventView, message_id: int | None) -> int | None:
        if event.status == "cancelled":
            if message_id is None:
                return None  # Cancelled before publication; never create a new card.
            try:
                await self.bot.delete_message(
                    chat_id=int(event.chat_id), message_id=message_id, request_timeout=10
                )
            except TelegramBadRequest as exc:
                if "message to delete not found" not in exc.message.lower():
                    raise DeliveryRejected from exc
            except (TimeoutError, TelegramNetworkError, TelegramServerError) as exc:
                raise DeliveryUnknown from exc
            except TelegramAPIError as exc:
                raise DeliveryRejected from exc
            return message_id
        data = event.data
        heading = "Событие"
        when = f"{data.start_date:%d.%m.%Y} · {data.start_time or 'Весь день'} ({event.timezone})"
        if data.end_time:
            when += f" — {data.end_date or data.start_date} {data.end_time}"
        place = (
            "Место уточняется"
            if data.place_pending
            else "\n".join(
                filter(
                    None,
                    [
                        data.place,
                        data.address,
                        data.map_url,
                        data.online_url,
                    ],
                )
            )
        )
        content = "\n\n".join(
            filter(
                None,
                [f"{heading}: {data.title}", when, place, data.description, " ".join(data.tags)],
            )
        )
        try:
            if message_id is not None:
                await self.bot.edit_message_text(
                    chat_id=int(event.chat_id),
                    message_id=message_id,
                    text=content,
                    link_preview_options=LinkPreviewOptions(is_disabled=True),
                    request_timeout=10,
                )
                return message_id
            sent = await self.bot.send_message(
                chat_id=int(event.chat_id),
                message_thread_id=data.topic_id if data.topic_id != 1 else None,
                text=content,
                link_preview_options=LinkPreviewOptions(is_disabled=True),
                request_timeout=10,
            )
            return sent.message_id
        except TelegramBadRequest as exc:
            if message_id is not None and "message is not modified" in exc.message.lower():
                return message_id
            raise DeliveryRejected from exc
        except (TimeoutError, TelegramNetworkError, TelegramServerError) as exc:
            raise DeliveryUnknown from exc
        except TelegramAPIError as exc:
            raise DeliveryRejected from exc
