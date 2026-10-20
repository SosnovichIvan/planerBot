"""support_replies

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_replies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.BigInteger(), nullable=False),
        sa.Column("source_message_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.String(3000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("lease", sa.Uuid(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sender_id", "source_message_id", name="support_reply_source_unique"),
        sa.CheckConstraint(
            "sender_id > 0 AND source_message_id > 0", name="support_reply_private_ids"
        ),
        sa.CheckConstraint(
            "char_length(body) BETWEEN 1 AND 3000", name="support_reply_body_length"
        ),
        sa.CheckConstraint("attempts >= 0", name="support_reply_attempts"),
        sa.CheckConstraint(
            "status IN ('pending','sending','sent','failed','unknown')", name="support_reply_status"
        ),
    )
    op.create_index("support_replies_pending", "support_replies", ["status", "next_attempt"])
    op.create_index("support_replies_ticket", "support_replies", ["ticket_id"])


def downgrade() -> None:
    # Drops reply history. Use forward fixes/backup recovery, not production downgrade.
    op.drop_index("support_replies_ticket", table_name="support_replies")
    op.drop_index("support_replies_pending", table_name="support_replies")
    op.drop_table("support_replies")
