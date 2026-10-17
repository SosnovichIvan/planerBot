"""Queue removal of legacy cancelled cards; retain events, revisions and RSVP."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Writers are stopped by release.sh. Each iteration touches a bounded batch;
    # the UPDATE excludes already queued/unknown work and is safe to repeat.
    bind = op.get_bind()
    from sqlalchemy import text

    cursor = "00000000-0000-0000-0000-000000000000"
    while True:
        ids = (
            bind.execute(
                text("""
            SELECT id FROM events WHERE status='cancelled' AND id > CAST(:cursor AS uuid)
            ORDER BY id LIMIT 500
        """),
                {"cursor": cursor},
            )
            .scalars()
            .all()
        )
        if not ids:
            break
        bind.execute(
            text("""
            INSERT INTO publications (event_id,status,desired_version,message_id)
            SELECT id,'pending',version,CASE WHEN source='message' THEN source_message_id END
            FROM events WHERE id > CAST(:cursor AS uuid) AND id <= CAST(:last AS uuid)
                AND status='cancelled'
            ON CONFLICT (event_id) DO UPDATE SET status='pending',
                desired_version=EXCLUDED.desired_version
            WHERE publications.status='published'
        """),
            {"cursor": cursor, "last": str(ids[-1])},
        )
        cursor = str(ids[-1])


def downgrade() -> None:
    # Data-only migration. Never resurrect messages or discard queued cleanup.
    pass
