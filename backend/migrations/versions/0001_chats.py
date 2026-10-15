"""Register connected chats and topics. No event data in the foundation."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.create_table(
        "chats",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=False),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "topics",
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("thread_id", sa.BigInteger(), nullable=False, autoincrement=False),
        sa.Column("title", sa.String(256), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("chat_id", "thread_id"),
    )


def downgrade():
    op.drop_table("topics")
    op.drop_table("chats")
