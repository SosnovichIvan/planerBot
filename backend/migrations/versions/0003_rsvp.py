"""Calendar participants, responses and personal delivery outbox."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.create_table(
        "calendar_participants",
        sa.Column(
            "chat_id",
            sa.BigInteger(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("user_id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("name", sa.String(256), nullable=False),
    )
    op.create_table(
        "personal_contacts",
        sa.Column("user_id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "event_responses",
        sa.Column(
            "event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("user_id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("answer", sa.String(3), nullable=False),
        sa.CheckConstraint("answer IN ('yes','no')", name="response_answer"),
    )
    op.create_table(
        "message_campaigns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("sender_id", sa.BigInteger(), nullable=False),
        sa.Column("audience", sa.String(16), nullable=False),
        sa.Column("body", sa.String(1500), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.CheckConstraint("audience IN ('all','yes','no','unanswered')", name="campaign_audience"),
    )
    op.create_table(
        "personal_notices",
        sa.Column(
            "campaign_id",
            sa.Uuid(),
            sa.ForeignKey("message_campaigns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("user_id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease", sa.Uuid()),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("next_attempt", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','sending','sent','skipped','failed','unknown')",
            name="notice_status",
        ),
    )
    op.create_index("notices_pending", "personal_notices", ["status", "next_attempt"])


def downgrade():
    for table in [
        "personal_notices",
        "message_campaigns",
        "event_responses",
        "personal_contacts",
        "calendar_participants",
    ]:
        op.drop_table(table)
