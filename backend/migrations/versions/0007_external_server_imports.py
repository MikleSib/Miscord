"""Add resumable external server imports."""

from alembic import op


revision = "0007_external_server_imports"
down_revision = "0006_server_template_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS external_server_imports (
            id VARCHAR(36) PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider VARCHAR(24) NOT NULL DEFAULT 'community_source',
            source_kind VARCHAR(16) NOT NULL,
            external_server_id VARCHAR(32),
            status VARCHAR(24) NOT NULL DEFAULT 'pending',
            display_name VARCHAR(100),
            definition JSONB,
            warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
            oauth_state_hash VARCHAR(64) UNIQUE,
            oauth_access_token TEXT,
            oauth_refresh_token TEXT,
            oauth_expires_at TIMESTAMPTZ,
            created_server_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT ck_external_import_provider CHECK (provider IN ('community_source')),
            CONSTRAINT ck_external_import_source_kind CHECK (source_kind IN ('template', 'oauth')),
            CONSTRAINT ck_external_import_status CHECK (
                status IN ('pending', 'awaiting_oauth', 'awaiting_bot', 'scanning', 'ready', 'creating', 'completed', 'failed', 'cancelled')
            )
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_external_server_imports_user_id ON external_server_imports(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_external_server_imports_external_server_id ON external_server_imports(external_server_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_external_server_imports_expires_at ON external_server_imports(expires_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_external_import_owner_status ON external_server_imports(user_id, status, created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS external_server_imports")
