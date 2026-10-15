from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    title: Mapped[str] = mapped_column(String(256))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), server_default="UTC")
    event_tag: Mapped[str] = mapped_column(String(33), server_default="#событие")
    creation_policy: Mapped[str] = mapped_column(String(16), server_default="admins")
    confirmation_required: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    settings_version: Mapped[int] = mapped_column(Integer, server_default="1")
    __table_args__ = (
        CheckConstraint("settings_version >= 1", name="chat_settings_version_positive"),
        CheckConstraint("creation_policy IN ('admins','members')", name="chat_creation_policy"),
    )


class Topic(Base):
    __tablename__ = "topics"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    thread_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    title: Mapped[str] = mapped_column(String(256))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Event(Base):
    __tablename__ = "events"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    topic_id: Mapped[int] = mapped_column(BigInteger)
    creator_id: Mapped[int] = mapped_column(BigInteger)
    editor_id: Mapped[int] = mapped_column(BigInteger)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB)
    fingerprint: Mapped[str] = mapped_column(String(64))
    timezone: Mapped[str] = mapped_column(String(64))
    local_date: Mapped[date] = mapped_column(Date)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16))
    source_message_id: Mapped[int | None] = mapped_column(BigInteger)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_update_id: Mapped[int] = mapped_column(BigInteger, default=0)
    __table_args__ = (
        ForeignKeyConstraint(
            ["chat_id", "topic_id"], ["topics.chat_id", "topics.thread_id"], ondelete="CASCADE"
        ),
        UniqueConstraint("chat_id", "source_message_id", name="event_source_unique"),
        CheckConstraint("version >= 1", name="event_version_positive"),
        CheckConstraint("status IN ('active','pending','cancelled')", name="event_status"),
        CheckConstraint("ends_at IS NULL OR ends_at > starts_at", name="event_time_order"),
        Index("events_chat_date", "chat_id", "local_date"),
    )


class Publication(Base):
    __tablename__ = "publications"
    event_id: Mapped[UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(16))
    desired_version: Mapped[int] = mapped_column(Integer)
    message_id: Mapped[int | None] = mapped_column(BigInteger)
    lease: Mapped[UUID | None]
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','sending','published','failed','unknown')",
            name="publication_status",
        ),
        Index("publications_status", "status"),
    )
