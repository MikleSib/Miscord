"""add server media expressions and stage channels

Revision ID: 0015_media_and_stage
Revises: 0014_hidden_dm_conversations
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_media_and_stage"
down_revision = "0014_hidden_dm_conversations"
branch_labels = None
depends_on = None


def _schema_already_present() -> bool:
    """Handle empty databases bootstrapped by the metadata-based baseline."""
    inspector = sa.inspect(op.get_bind())
    tables = {"server_expressions", "message_media", "stage_instances", "stage_speaker_grants", "stage_speaker_requests"}
    if not tables.issubset(set(inspector.get_table_names())):
        return False
    voice_columns = {column["name"] for column in inspector.get_columns("voice_channels")}
    presence_columns = {column["name"] for column in inspector.get_columns("voice_channel_users")}
    return "kind" in voice_columns and {
        "stage_role", "stage_suppressed", "requested_to_speak_at",
    }.issubset(presence_columns)


def upgrade() -> None:
    if _schema_already_present():
        return
    op.add_column("voice_channels", sa.Column("kind", sa.String(16), nullable=False, server_default="voice"))
    op.create_index("ix_voice_channels_kind", "voice_channels", ["kind"])
    op.add_column("voice_channel_users", sa.Column("stage_role", sa.String(16), nullable=False, server_default="audience"))
    op.add_column("voice_channel_users", sa.Column("stage_suppressed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("voice_channel_users", sa.Column("requested_to_speak_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "server_expressions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("creator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.String(160), nullable=True),
        sa.Column("storage_key", sa.String(512), nullable=False, unique=True),
        sa.Column("file_url", sa.String(2048), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("animated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('emoji', 'sticker', 'sound')", name="ck_server_expressions_kind"),
    )
    op.create_index("ix_server_expressions_server_id", "server_expressions", ["server_id"])
    op.create_index("ix_server_expressions_kind", "server_expressions", ["kind"])
    op.create_index("ix_server_expressions_available", "server_expressions", ["available"])
    op.create_index(
        "uq_available_server_expression_name", "server_expressions",
        ["server_id", "kind", "name"], unique=True,
        postgresql_where=sa.text("available = true"),
    )

    op.create_table(
        "message_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=True),
        sa.Column("dm_message_id", sa.Integer(), sa.ForeignKey("direct_messages.id", ondelete="CASCADE"), nullable=True),
        sa.Column("expression_id", sa.Integer(), sa.ForeignKey("server_expressions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("media_type", sa.String(16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider", sa.String(24), nullable=True),
        sa.Column("provider_id", sa.String(128), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("media_type IN ('sticker', 'gif')", name="ck_message_media_type"),
        sa.CheckConstraint(
            "(message_id IS NOT NULL AND dm_message_id IS NULL) OR (message_id IS NULL AND dm_message_id IS NOT NULL)",
            name="ck_message_media_one_target",
        ),
    )
    op.create_index("ix_message_media_message_id", "message_media", ["message_id"])
    op.create_index("ix_message_media_dm_message_id", "message_media", ["dm_message_id"])

    op.create_table(
        "stage_instances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("voice_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("topic", sa.String(120), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("request_to_speak_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("empty_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('active', 'ended')", name="ck_stage_instances_status"),
    )
    op.create_index("ix_stage_instances_channel_id", "stage_instances", ["channel_id"])
    op.create_index("ix_stage_instances_server_id", "stage_instances", ["server_id"])
    op.create_index("ix_stage_instances_status", "stage_instances", ["status"])
    op.create_index("ix_stage_instances_empty_since", "stage_instances", ["empty_since"])
    op.create_index("uq_active_stage_channel", "stage_instances", ["channel_id"], unique=True, postgresql_where=sa.text("status = 'active'"))

    op.create_table(
        "stage_speaker_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stage_instance_id", sa.Integer(), sa.ForeignKey("stage_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("granted_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="speaker"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('speaker', 'moderator')", name="ck_stage_speaker_grant_role"),
        sa.UniqueConstraint("stage_instance_id", "user_id", name="uq_stage_speaker_grant"),
    )
    op.create_index("ix_stage_speaker_grants_stage_instance_id", "stage_speaker_grants", ["stage_instance_id"])
    op.create_index("ix_stage_speaker_grants_user_id", "stage_speaker_grants", ["user_id"])

    op.create_table(
        "stage_speaker_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stage_instance_id", sa.Integer(), sa.ForeignKey("stage_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'cancelled')", name="ck_stage_request_status"),
        sa.UniqueConstraint("stage_instance_id", "user_id", name="uq_stage_speaker_request"),
    )
    op.create_index("ix_stage_speaker_requests_stage_instance_id", "stage_speaker_requests", ["stage_instance_id"])
    op.create_index("ix_stage_speaker_requests_user_id", "stage_speaker_requests", ["user_id"])


def downgrade() -> None:
    op.drop_table("stage_speaker_requests")
    op.drop_table("stage_speaker_grants")
    op.drop_index("uq_active_stage_channel", table_name="stage_instances")
    op.drop_table("stage_instances")
    op.drop_table("message_media")
    op.drop_table("server_expressions")
    op.drop_column("voice_channel_users", "requested_to_speak_at")
    op.drop_column("voice_channel_users", "stage_suppressed")
    op.drop_column("voice_channel_users", "stage_role")
    op.drop_index("ix_voice_channels_kind", table_name="voice_channels")
    op.drop_column("voice_channels", "kind")
