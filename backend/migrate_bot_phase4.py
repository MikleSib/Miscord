"""Idempotent schema migration for bot commands, interactions, and Gateway sessions."""

import asyncio

from sqlalchemy import text

from app.db.database import engine


BOT_DEFAULT_INTENTS = (1 << 9) | (1 << 15)

STATEMENTS = (
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS command_type INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS dm_permission BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS default_member_permissions BIGINT",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS allowed_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS allowed_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb",
    f"ALTER TABLE bot_installs ADD COLUMN IF NOT EXISTS intents BIGINT NOT NULL DEFAULT {BOT_DEFAULT_INTENTS}",
    """
    CREATE TABLE IF NOT EXISTS bot_interactions (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        interaction_id VARCHAR(64) NOT NULL,
        interaction_token VARCHAR(255) NOT NULL,
        guild_id BIGINT,
        channel_id BIGINT,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        command_id INTEGER REFERENCES bot_commands(id) ON DELETE SET NULL,
        response_type INTEGER,
        response_payload JSONB,
        responded BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_bot_interaction_id_token UNIQUE (interaction_id, interaction_token)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_interactions_application_id ON bot_interactions(application_id)",
    """
    CREATE TABLE IF NOT EXISTS bot_sessions (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        session_id VARCHAR(64) NOT NULL UNIQUE,
        intents BIGINT NOT NULL DEFAULT 33280,
        sequence BIGINT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_resumable BOOLEAN NOT NULL DEFAULT TRUE,
        last_heartbeat_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_sessions_application_id ON bot_sessions(application_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_sessions_session_id ON bot_sessions(session_id)",
)


async def migrate() -> None:
    async with engine.begin() as connection:
        for statement in STATEMENTS:
            await connection.execute(text(statement))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
