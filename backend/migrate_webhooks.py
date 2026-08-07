#!/usr/bin/env python3
"""Idempotent PostgreSQL migration for incoming webhooks and managed attachments."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS webhooks (
        id SERIAL PRIMARY KEY,
        server_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        text_channel_id INTEGER NOT NULL REFERENCES text_channels(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL,
        avatar_url VARCHAR(2048),
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_ciphertext TEXT NOT NULL,
        created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "ALTER TABLE messages ALTER COLUMN author_id DROP NOT NULL",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS webhook_id INTEGER",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS webhook_name VARCHAR(80)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS webhook_avatar_url VARCHAR(2048)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS embeds JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS flags INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE attachments ALTER COLUMN file_url DROP NOT NULL",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255)",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS content_type VARCHAR(255)",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS size_bytes BIGINT",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS storage_key VARCHAR(512)",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64)",
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS description VARCHAR(1024)",
    "CREATE INDEX IF NOT EXISTS ix_webhooks_server_id ON webhooks(server_id)",
    "CREATE INDEX IF NOT EXISTS ix_webhooks_text_channel_id ON webhooks(text_channel_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_webhooks_token_hash ON webhooks(token_hash)",
    "CREATE INDEX IF NOT EXISTS ix_messages_webhook_id_id ON messages(webhook_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_messages_channel_history ON messages(text_channel_id, timestamp DESC, id DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_attachments_storage_key ON attachments(storage_key) WHERE storage_key IS NOT NULL",
    "UPDATE webhooks SET token_ciphertext = '' WHERE token_ciphertext <> ''",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_messages_exactly_one_author') THEN
            ALTER TABLE messages ADD CONSTRAINT ck_messages_exactly_one_author CHECK (
                (author_id IS NOT NULL AND webhook_id IS NULL) OR
                (author_id IS NULL AND webhook_id IS NOT NULL)
            ) NOT VALID;
            ALTER TABLE messages VALIDATE CONSTRAINT ck_messages_exactly_one_author;
        END IF;
    END $$
    """,
)


async def migrate() -> None:
    engine = create_async_engine(settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"))
    try:
        async with engine.begin() as connection:
            for statement in STATEMENTS:
                await connection.execute(text(statement))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
