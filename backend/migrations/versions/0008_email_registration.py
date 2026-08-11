"""Add verified email registration challenges."""

from alembic import op


revision = "0008_email_registration"
down_revision = "0007_external_server_imports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
    op.execute("UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at, now())")
    op.execute("ALTER TABLE users ALTER COLUMN email_verified_at SET DEFAULT now()")
    op.execute("ALTER TABLE users ALTER COLUMN email_verified_at SET NOT NULL")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS registration_challenges (
            id VARCHAR(36) PRIMARY KEY,
            email VARCHAR(320) NOT NULL,
            username VARCHAR(32) NOT NULL,
            display_name VARCHAR(100),
            hashed_password VARCHAR(255) NOT NULL,
            code_digest VARCHAR(64) NOT NULL,
            attempts_remaining INTEGER NOT NULL DEFAULT 5,
            resend_count INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMPTZ NOT NULL,
            resend_available_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_registration_challenges_email UNIQUE (email),
            CONSTRAINT uq_registration_challenges_username UNIQUE (username)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_registration_challenges_email ON registration_challenges(email)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_registration_challenges_username ON registration_challenges(username)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_registration_challenges_expires_at ON registration_challenges(expires_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS registration_challenges")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
