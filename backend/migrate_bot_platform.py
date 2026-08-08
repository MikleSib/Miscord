import asyncio

from sqlalchemy import text

from app.db.database import engine


STATEMENTS = (
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE",
    """
    CREATE TABLE IF NOT EXISTS bot_applications (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        bot_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        client_id VARCHAR(32) NOT NULL UNIQUE,
        name VARCHAR(80) NOT NULL,
        description VARCHAR(400),
        avatar_url VARCHAR(2048),
        public_key VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_applications_owner_id ON bot_applications(owner_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_applications_client_id ON bot_applications(client_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_applications_status ON bot_applications(status)",
    """
    CREATE TABLE IF NOT EXISTS bot_application_secrets (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL UNIQUE REFERENCES bot_applications(id) ON DELETE CASCADE,
        signing_private_key_ciphertext TEXT NOT NULL,
        token_rotation_id INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bot_tokens (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_hint VARCHAR(12) NOT NULL,
        rotation_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_tokens_application_id ON bot_tokens(application_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_tokens_token_hash ON bot_tokens(token_hash)",
    "CREATE INDEX IF NOT EXISTS ix_bot_tokens_revoked_at ON bot_tokens(revoked_at)",
    """
    CREATE TABLE IF NOT EXISTS bot_installs (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        installed_by_id INTEGER NOT NULL REFERENCES users(id),
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        permissions BIGINT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_bot_install_application_server UNIQUE (application_id, server_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_installs_application_id ON bot_installs(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_installs_server_id ON bot_installs(server_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_installs_status ON bot_installs(status)",
    """
    CREATE TABLE IF NOT EXISTS bot_commands (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        server_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
        name VARCHAR(32) NOT NULL,
        description VARCHAR(100) NOT NULL,
        definition JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_commands_application_id ON bot_commands(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_commands_server_id ON bot_commands(server_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_commands_scope_name ON bot_commands(application_id, COALESCE(server_id, 0), name)",
    """
    CREATE TABLE IF NOT EXISTS bot_audit_logs (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        actor_id INTEGER REFERENCES users(id),
        action VARCHAR(48) NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_audit_logs_application_id ON bot_audit_logs(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_audit_logs_actor_id ON bot_audit_logs(actor_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_audit_logs_action ON bot_audit_logs(action)",
    "CREATE INDEX IF NOT EXISTS ix_bot_audit_logs_created_at ON bot_audit_logs(created_at)",
)


async def migrate() -> None:
    async with engine.begin() as connection:
        for statement in STATEMENTS:
            await connection.execute(text(statement))


if __name__ == "__main__":
    asyncio.run(migrate())
