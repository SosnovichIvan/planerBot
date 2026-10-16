"""Personal responses and calendar audience, never trusted for authorization."""

from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from planerbot.access import AccessDenied, ChatAccess
from planerbot.auth import Viewer
from planerbot.campaigns import enqueue_campaign
from planerbot.event_contracts import Conflict, EventView, MissingEvent
from planerbot.event_repository import EventRepository
from planerbot.event_updates import view_updates
from planerbot.models import (
    CalendarParticipant,
    Event,
    EventResponse,
    MessageCampaign,
    PersonalContact,
    PersonalNotice,
)

Answer = Literal["yes", "no", "unanswered"]


class ResponseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: Answer


class CampaignInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    audience: Answer
    text: str = Field(min_length=1, max_length=1500)


class ResponseCounts(BaseModel):
    yes: int = 0
    no: int = 0
    unanswered: int = 0


class EventDetails(BaseModel):
    event: EventView
    counts: ResponseCounts | None = None
    personal_messages_enabled: bool


class CampaignView(BaseModel):
    id: UUID
    statuses: dict[str, int] = Field(default_factory=dict)


class RsvpService:
    def __init__(self, engine: AsyncEngine, access: ChatAccess):
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.access = access

    async def contact(self, user_id: int, enabled: bool) -> None:
        async with self.sessions.begin() as session:
            await session.execute(
                insert(PersonalContact)
                .values(user_id=user_id, enabled=enabled)
                .on_conflict_do_update(
                    index_elements=[PersonalContact.user_id], set_={"enabled": enabled}
                )
            )

    async def grant(self, user_id: int) -> None:
        # Opening the app again must not undo an explicit /stop or opt-out.
        async with self.sessions.begin() as session:
            await session.execute(
                insert(PersonalContact)
                .values(user_id=user_id, enabled=True)
                .on_conflict_do_nothing()
            )

    async def visit(self, user: Viewer) -> None:
        chats = await self.access.all_for(user.id)
        async with self.sessions.begin() as session:
            for target in chats:
                await session.execute(
                    insert(CalendarParticipant)
                    .values(
                        chat_id=target.chat.id,
                        user_id=user.id,
                        name=user.first_name,
                    )
                    .on_conflict_do_update(
                        index_elements=[CalendarParticipant.chat_id, CalendarParticipant.user_id],
                        set_={"name": user.first_name},
                    )
                )
        if user.allows_write_to_pm:
            await self.grant(user.id)

    async def remove(self, chat_id: int, user_id: int) -> None:
        async with self.sessions.begin() as session:
            await session.execute(
                delete(CalendarParticipant).where(
                    CalendarParticipant.chat_id == chat_id, CalendarParticipant.user_id == user_id
                )
            )

    async def event(
        self, session: AsyncSession, user_id: int, chat_id: int, event_id: UUID
    ) -> Event:
        event = await session.scalar(
            select(Event).where(Event.id == event_id, Event.chat_id == chat_id).with_for_update()
        )
        if event is None:
            raise MissingEvent
        return event

    async def detail(
        self, user: Viewer, chat_id: int, event_id: UUID, answer: Answer | None = None
    ) -> EventDetails:
        target = await self.access.authorize(user.id, chat_id)
        if user.allows_write_to_pm:
            await self.grant(user.id)
        async with self.sessions.begin() as session:
            event = await self.event(session, user.id, chat_id, event_id)
            if (event.status == "pending" and not target.can_manage) or not any(
                t.thread_id == event.topic_id and (t.enabled or target.can_manage)
                for t in target.chat.topics
            ):
                raise AccessDenied
            await session.execute(
                insert(CalendarParticipant)
                .values(chat_id=chat_id, user_id=user.id, name=user.first_name)
                .on_conflict_do_nothing()
            )
            if answer is not None:
                if event.status != "active":
                    raise Conflict("Ответ доступен только для активного события")
                if answer == "unanswered":
                    await session.execute(
                        delete(EventResponse).where(
                            EventResponse.event_id == event_id, EventResponse.user_id == user.id
                        )
                    )
                else:
                    await session.execute(
                        insert(EventResponse)
                        .values(event_id=event_id, user_id=user.id, answer=answer)
                        .on_conflict_do_update(
                            index_elements=[EventResponse.event_id, EventResponse.user_id],
                            set_={"answer": answer},
                        )
                    )
            own = await session.scalar(
                select(EventResponse.answer).where(
                    EventResponse.event_id == event_id, EventResponse.user_id == user.id
                )
            )
            counts = None
            if own is not None:
                grouped = (
                    await session.execute(
                        select(func.coalesce(EventResponse.answer, "unanswered"), func.count())
                        .select_from(CalendarParticipant)
                        .outerjoin(
                            EventResponse,
                            (EventResponse.user_id == CalendarParticipant.user_id)
                            & (EventResponse.event_id == event_id),
                        )
                        .where(CalendarParticipant.chat_id == chat_id)
                        .group_by(EventResponse.answer)
                    )
                ).all()
                counts = ResponseCounts.model_validate(dict(grouped))
            view = await EventRepository.read(session, chat_id, event_id)
            contact = await session.get(PersonalContact, user.id)
            view = view.model_copy(
                update={"can_manage": target.can_manage, "my_response": own or "unanswered"}
            )
            view = await view_updates(session, view, user.id)
            return EventDetails(
                event=view,
                counts=counts,
                personal_messages_enabled=bool(contact and contact.enabled),
            )

    async def campaign(
        self, user: Viewer, chat_id: int, event_id: UUID, key: UUID, data: CampaignInput
    ) -> CampaignView:
        await self.access.authorize(user.id, chat_id, manage=True)
        campaign_id = uuid5(NAMESPACE_URL, f"campaign:{event_id}:{user.id}:{key}")
        async with self.sessions.begin() as session:
            event = await self.event(session, user.id, chat_id, event_id)
            own = await session.get(EventResponse, (event_id, user.id))
            if own is None:
                raise AccessDenied
            if event.status != "active":
                raise Conflict("Рассылка доступна только для активного события")
            await enqueue_campaign(session, event, user.id, campaign_id, data.audience, data.text)
        return CampaignView(id=campaign_id)

    async def campaign_status(
        self, user: Viewer, chat_id: int, event_id: UUID, campaign_id: UUID
    ) -> CampaignView:
        await self.access.authorize(user.id, chat_id, manage=True)
        async with self.sessions() as session:
            event = await self.event(session, user.id, chat_id, event_id)
            if await session.get(EventResponse, (event.id, user.id)) is None:
                raise AccessDenied
            campaign = await session.get(MessageCampaign, campaign_id)
            if campaign is None or campaign.event_id != event_id:
                raise MissingEvent
            rows = (
                await session.execute(
                    select(PersonalNotice.status, func.count())
                    .where(PersonalNotice.campaign_id == campaign_id)
                    .group_by(PersonalNotice.status)
                )
            ).all()
            return CampaignView(id=campaign_id, statuses=dict(rows))
