"""Add revocable user sessions, blocks, and voice permission defaults."""

from alembic import op


revision = "0009_security_foundation"
down_revision = "0008_email_registration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id VARCHAR(36) PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            refresh_token_hash VARCHAR(64) NOT NULL,
            previous_refresh_token_hash VARCHAR(64),
            previous_refresh_valid_until TIMESTAMPTZ,
            user_agent VARCHAR(512),
            ip_address VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_sessions_expires_at ON user_sessions(expires_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_sessions_revoked_at ON user_sessions(revoked_at)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_sessions_active "
        "ON user_sessions(user_id, revoked_at, expires_at)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_blocks (
            id BIGSERIAL PRIMARY KEY,
            blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_user_blocks_pair UNIQUE(blocker_id, blocked_id),
            CONSTRAINT ck_user_blocks_not_self CHECK(blocker_id <> blocked_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_blocks_blocker_id ON user_blocks(blocker_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_blocks_blocked_id ON user_blocks(blocked_id)")

    # Existing @everyone roles predate voice permission enforcement. Grant the
    # standard CONNECT, SPEAK, STREAM and USE_VAD bits before enforcing them.
    voice_defaults = (1 << 9) | (1 << 20) | (1 << 21) | (1 << 25)
    op.execute(
        f"UPDATE server_roles SET permissions = permissions | {voice_defaults} "
        "WHERE is_default = TRUE"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_blocks")
    op.execute("DROP TABLE IF EXISTS user_sessions")
