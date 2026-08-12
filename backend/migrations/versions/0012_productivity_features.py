"""onboarding, events and message state

Revision ID: 0012_productivity_features
Revises: 0011_account_security
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_productivity_features"
down_revision = "0011_account_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    required_tables = {
        "server_onboarding", "server_onboarding_members", "scheduled_events",
        "scheduled_event_interests", "message_drafts", "channel_read_states", "saved_messages",
    }
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    if required_tables <= existing_tables:
        # On a brand-new database the legacy baseline builds current metadata,
        # including these tables. Existing deployments reach this revision
        # without them and use the explicit migration below.
        return
    partially_existing = required_tables & existing_tables
    if partially_existing:
        raise RuntimeError(f"Incomplete productivity schema: {sorted(partially_existing)}")
    json_list = sa.text("'[]'::jsonb")
    op.create_table(
        "server_onboarding",
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("welcome_text", sa.String(1000)),
        sa.Column("rules", postgresql.JSONB(), nullable=False, server_default=json_list),
        sa.Column("prompts", postgresql.JSONB(), nullable=False, server_default=json_list),
        sa.Column("default_channel_ids", postgresql.JSONB(), nullable=False, server_default=json_list),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "server_onboarding_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("selected_channel_ids", postgresql.JSONB(), nullable=False, server_default=json_list),
        sa.Column("answers", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("server_id", "user_id", name="uq_server_onboarding_member"),
    )
    op.create_index("ix_onboarding_members_server", "server_onboarding_members", ["server_id"])
    op.create_index("ix_onboarding_members_user", "server_onboarding_members", ["user_id"])
    op.create_table(
        "scheduled_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("creator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("entity_type", sa.String(16), nullable=False, server_default="voice"),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("voice_channels.id", ondelete="SET NULL")),
        sa.Column("location", sa.String(200)),
        sa.Column("scheduled_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_end_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_scheduled_events_server", "scheduled_events", ["server_id"])
    op.create_index("ix_scheduled_events_start", "scheduled_events", ["scheduled_start_at"])
    op.create_table(
        "scheduled_event_interests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("scheduled_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "user_id", name="uq_scheduled_event_interest"),
    )
    op.create_table(
        "message_drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.String(5000), nullable=False, server_default=""),
        sa.Column("attachment_refs", postgresql.JSONB(), nullable=False, server_default=json_list),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "channel_id", name="uq_message_draft_user_channel"),
    )
    op.create_table(
        "channel_read_states",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_read_message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "channel_id", name="uq_channel_read_user_channel"),
    )
    op.create_table(
        "saved_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("note", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "message_id", name="uq_saved_message_user_message"),
    )


def downgrade() -> None:
    for table in (
        "saved_messages", "channel_read_states", "message_drafts",
        "scheduled_event_interests", "scheduled_events",
        "server_onboarding_members", "server_onboarding",
    ):
        op.drop_table(table)
