"""support_tickets

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Additive queue; no existing event/participant table is rewritten.
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("source_message_id", sa.BigInteger(), nullable=False),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("body", sa.String(length=3000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("lease", sa.Uuid(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','sending','sent','failed','unknown')", name="support_status"
        ),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 3000", name="support_body_length"),
        sa.CheckConstraint("user_id > 0 AND target_id > 0", name="support_private_ids"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "source_message_id", name="support_source_unique"),
    )
    op.create_index("support_pending", "support_tickets", ["status", "next_attempt"], unique=False)
    op.create_index(
        "support_user_created", "support_tickets", ["user_id", "created_at"], unique=False
    )


def downgrade() -> None:
    # Destructive for support history: use forward fixes, not production downgrade.
    op.drop_index("support_user_created", table_name="support_tickets")
    op.drop_index("support_pending", table_name="support_tickets")
    op.drop_table("support_tickets")
