"""Add revision snapshots and personal read versions without rewriting events."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_revisions",
        sa.Column(
            "event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("previous_payload", postgresql.JSONB(), nullable=False),
    )
    op.create_table(
        "event_seen",
        sa.Column(
            "event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("user_id", sa.BigInteger(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("event_seen")
    op.drop_table("event_revisions")
