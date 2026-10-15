"""Chat settings, events and durable publication intent."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"


def upgrade():
    for column in [
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("event_tag", sa.String(33), nullable=False, server_default="#событие"),
        sa.Column("creation_policy", sa.String(16), nullable=False, server_default="admins"),
        sa.Column(
            "confirmation_required", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("settings_version", sa.Integer(), nullable=False, server_default="1"),
    ]:
        op.add_column("chats", column)
    op.create_check_constraint("chat_settings_version_positive", "chats", "settings_version >= 1")
    op.create_check_constraint(
        "chat_creation_policy", "chats", "creation_policy IN ('admins','members')"
    )
    op.add_column(
        "topics", sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true"))
    )
    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("topic_id", sa.BigInteger(), nullable=False),
        sa.Column("creator_id", sa.BigInteger(), nullable=False),
        sa.Column("editor_id", sa.BigInteger(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("source_message_id", sa.BigInteger()),
        sa.Column("source_updated_at", sa.DateTime(timezone=True)),
        sa.Column("source_update_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["chat_id", "topic_id"], ["topics.chat_id", "topics.thread_id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("chat_id", "source_message_id", name="event_source_unique"),
        sa.CheckConstraint("version >= 1", name="event_version_positive"),
        sa.CheckConstraint("status IN ('active','pending','cancelled')", name="event_status"),
        sa.CheckConstraint("ends_at IS NULL OR ends_at > starts_at", name="event_time_order"),
    )
    op.create_index("events_chat_date", "events", ["chat_id", "local_date"])
    op.create_table(
        "publications",
        sa.Column(
            "event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("desired_version", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.BigInteger()),
        sa.Column("lease", sa.Uuid()),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending','sending','published','failed','unknown')",
            name="publication_status",
        ),
    )
    op.create_index("publications_status", "publications", ["status"])


def downgrade():
    op.drop_table("publications")
    op.drop_table("events")
    op.drop_column("topics", "enabled")
    op.drop_constraint("chat_creation_policy", "chats")
    op.drop_constraint("chat_settings_version_positive", "chats")
    for column in [
        "settings_version",
        "confirmation_required",
        "creation_policy",
        "event_tag",
        "timezone",
    ]:
        op.drop_column("chats", column)
