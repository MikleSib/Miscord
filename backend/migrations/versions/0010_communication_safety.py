"""Add communication privacy, reports, timeouts, and AutoMod rules."""

from alembic import op


revision = "0010_communication_safety"
down_revision = "0009_security_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_privacy_settings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            direct_messages VARCHAR(32) NOT NULL DEFAULT 'friends_and_servers',
            friend_requests VARCHAR(32) NOT NULL DEFAULT 'everyone',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_privacy_dm CHECK (direct_messages IN ('everyone','friends','friends_and_servers','nobody')),
            CONSTRAINT ck_privacy_friends CHECK (friend_requests IN ('everyone','server_members','nobody'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS safety_reports (
            id BIGSERIAL PRIMARY KEY,
            reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            server_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
            channel_id INTEGER,
            message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
            dm_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL,
            category VARCHAR(32) NOT NULL,
            details TEXT,
            status VARCHAR(24) NOT NULL DEFAULT 'open',
            resolution TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ,
            resolved_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT ck_safety_report_category CHECK (category IN ('spam','harassment','hate','sexual','violence','impersonation','other')),
            CONSTRAINT ck_safety_report_status CHECK (status IN ('open','reviewing','resolved','dismissed'))
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_safety_reports_reporter ON safety_reports(reporter_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_safety_reports_server_status ON safety_reports(server_id, status, created_at)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS member_timeouts (
            id BIGSERIAL PRIMARY KEY,
            server_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reason VARCHAR(512),
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_member_timeouts_server_user UNIQUE(server_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_member_timeouts_active ON member_timeouts(server_id, user_id, expires_at)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS automod_rules (
            id BIGSERIAL PRIMARY KEY,
            server_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
            creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(100) NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            trigger_type VARCHAR(32) NOT NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            actions JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ,
            CONSTRAINT ck_automod_trigger CHECK (trigger_type IN ('keyword','spam','mention_spam','link'))
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_automod_rules_server ON automod_rules(server_id, enabled)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS automod_rules")
    op.execute("DROP TABLE IF EXISTS member_timeouts")
    op.execute("DROP TABLE IF EXISTS safety_reports")
    op.execute("DROP TABLE IF EXISTS user_privacy_settings")
