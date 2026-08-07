import asyncio

from sqlalchemy import text

from app.db.database import engine


STATEMENTS = (
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_nonce VARCHAR(36)",
    "ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS client_nonce VARCHAR(36)",
    """
    CREATE TABLE IF NOT EXISTS pending_chat_uploads (
        id VARCHAR(36) PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_key VARCHAR(512) NOT NULL UNIQUE,
        file_url VARCHAR(2048) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        content_type VARCHAR(255) NOT NULL,
        size_bytes BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_pending_chat_uploads_owner_id ON pending_chat_uploads(owner_id)",
    "CREATE INDEX IF NOT EXISTS ix_pending_chat_uploads_created_at ON pending_chat_uploads(created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_author_client_nonce ON messages(author_id, client_nonce) WHERE client_nonce IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_messages_sender_client_nonce ON direct_messages(sender_id, client_nonce) WHERE client_nonce IS NOT NULL",
)


async def migrate() -> None:
    async with engine.begin() as connection:
        for statement in STATEMENTS:
            await connection.execute(text(statement))


if __name__ == "__main__":
    asyncio.run(migrate())
