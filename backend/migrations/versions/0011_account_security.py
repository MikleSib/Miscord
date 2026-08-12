"""Add password/email challenges and two-factor authentication."""

from alembic import op


revision = "0011_account_security"
down_revision = "0010_communication_safety"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS account_challenges (
            id VARCHAR(36) PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(320) NOT NULL,
            type VARCHAR(32) NOT NULL,
            code_digest VARCHAR(64) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            attempts_remaining INTEGER NOT NULL DEFAULT 5,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_account_challenge_type CHECK(type IN ('password_reset','email_change','two_factor_setup'))
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_account_challenges_user ON account_challenges(user_id, type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_account_challenges_email ON account_challenges(email, type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_account_challenges_expires ON account_challenges(expires_at)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_two_factor (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            secret_ciphertext TEXT NOT NULL,
            backup_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
            enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_two_factor")
    op.execute("DROP TABLE IF EXISTS account_challenges")
