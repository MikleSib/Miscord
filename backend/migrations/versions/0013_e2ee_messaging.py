"""end-to-end encrypted direct messages

Revision ID: 0013_e2ee_messaging
Revises: 0012_productivity_features
"""

from alembic import op
import sqlalchemy as sa

revision = "0013_e2ee_messaging"
down_revision = "0012_productivity_features"
branch_labels = None
depends_on = None


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "user_e2ee_devices" not in existing:
        op.create_table(
            "user_e2ee_devices",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("credential_id", sa.String(192), nullable=False),
            sa.Column("key_package", sa.LargeBinary(), nullable=False),
            sa.Column("key_package_id", sa.String(36), nullable=False),
            sa.Column("key_package_claimed_at", sa.DateTime(timezone=True)),
            sa.Column("signature_public_key", sa.LargeBinary(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("revoked_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("user_id", "id", name="uq_user_e2ee_device"),
        )
        op.create_index("ix_user_e2ee_devices_user_id", "user_e2ee_devices", ["user_id"])
        op.create_index(
            "uq_user_e2ee_active_device", "user_e2ee_devices", ["user_id"],
            unique=True, postgresql_where=sa.text("revoked_at IS NULL"),
        )
    else:
        indexes = _index_names("user_e2ee_devices")
        if "ix_user_e2ee_devices_user_id" not in indexes:
            op.create_index("ix_user_e2ee_devices_user_id", "user_e2ee_devices", ["user_id"])
        if "uq_user_e2ee_active_device" not in indexes:
            op.create_index(
                "uq_user_e2ee_active_device", "user_e2ee_devices", ["user_id"],
                unique=True, postgresql_where=sa.text("revoked_at IS NULL"),
            )
    if "secret_dm_sessions" not in existing:
        op.create_table(
            "secret_dm_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_low_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_high_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("founder_device_id", sa.String(36), sa.ForeignKey("user_e2ee_devices.id"), nullable=False),
            sa.Column("recipient_device_id", sa.String(36), sa.ForeignKey("user_e2ee_devices.id"), nullable=False),
            sa.Column("welcome", sa.LargeBinary(), nullable=False),
            sa.Column("ratchet_tree", sa.LargeBinary(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("closed_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_secret_dm_sessions_user_low_id", "secret_dm_sessions", ["user_low_id"])
        op.create_index("ix_secret_dm_sessions_user_high_id", "secret_dm_sessions", ["user_high_id"])
        op.create_index(
            "uq_secret_dm_pair_active", "secret_dm_sessions", ["user_low_id", "user_high_id"],
            unique=True, postgresql_where=sa.text("active = true"),
        )
    else:
        indexes = _index_names("secret_dm_sessions")
        if "ix_secret_dm_sessions_user_low_id" not in indexes:
            op.create_index("ix_secret_dm_sessions_user_low_id", "secret_dm_sessions", ["user_low_id"])
        if "ix_secret_dm_sessions_user_high_id" not in indexes:
            op.create_index("ix_secret_dm_sessions_user_high_id", "secret_dm_sessions", ["user_high_id"])
        if "uq_secret_dm_pair_active" not in indexes:
            op.create_index(
                "uq_secret_dm_pair_active", "secret_dm_sessions", ["user_low_id", "user_high_id"],
                unique=True, postgresql_where=sa.text("active = true"),
            )
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("direct_messages")}
    if "encryption_version" not in columns:
        op.add_column("direct_messages", sa.Column("encryption_version", sa.Integer(), nullable=False, server_default="0"))
    if "ciphertext" not in columns:
        op.add_column("direct_messages", sa.Column("ciphertext", sa.LargeBinary()))
    if "secret_session_id" not in columns:
        op.add_column("direct_messages", sa.Column("secret_session_id", sa.String(36)))
    if "sender_device_id" not in columns:
        op.add_column("direct_messages", sa.Column("sender_device_id", sa.String(36)))
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys("direct_messages")
    if not any(key.get("constrained_columns") == ["secret_session_id"] for key in foreign_keys):
        op.create_foreign_key(
            "fk_direct_messages_secret_session", "direct_messages", "secret_dm_sessions",
            ["secret_session_id"], ["id"], ondelete="SET NULL",
        )
    if "ix_direct_messages_secret_session" not in _index_names("direct_messages"):
        op.create_index("ix_direct_messages_secret_session", "direct_messages", ["secret_session_id", "timestamp"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("direct_messages")}
    if "ix_direct_messages_secret_session" in _index_names("direct_messages"):
        op.drop_index("ix_direct_messages_secret_session", table_name="direct_messages")
    for key in inspector.get_foreign_keys("direct_messages"):
        if key.get("constrained_columns") == ["secret_session_id"] and key.get("name"):
            op.drop_constraint(key["name"], "direct_messages", type_="foreignkey")
    for column in ("sender_device_id", "secret_session_id", "ciphertext", "encryption_version"):
        if column in columns:
            op.drop_column("direct_messages", column)
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "secret_dm_sessions" in tables:
        op.drop_table("secret_dm_sessions")
    if "user_e2ee_devices" in tables:
        op.drop_table("user_e2ee_devices")
