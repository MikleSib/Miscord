"""Add an optional visual icon to private server templates."""

from alembic import op


revision = "0006_server_template_icon"
down_revision = "0005_thread_starter_message"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS icon VARCHAR(32)")


def downgrade() -> None:
    op.execute("ALTER TABLE server_templates DROP COLUMN IF EXISTS icon")
