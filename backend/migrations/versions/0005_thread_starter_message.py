"""Add source message link for threads.

Revision ID: 0005_thread_starter_message
Revises: 0004_poll_json_backfill
"""

from alembic import op

revision = "0005_thread_starter_message"
down_revision = "0004_poll_json_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS "
        "starter_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE text_channels DROP COLUMN IF EXISTS starter_message_id CASCADE")
