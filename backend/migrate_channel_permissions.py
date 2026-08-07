#!/usr/bin/env python3
"""Таблица переопределений прав каналов (роли и участники)."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS channel_permission_overwrites (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    channel_kind channel_kind NOT NULL,
    channel_id INTEGER NOT NULL,
    target_type overwrite_target_type NOT NULL,
    target_id INTEGER NOT NULL,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_channel_permission_overwrite_target
        UNIQUE (channel_kind, channel_id, target_type, target_id)
)
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_channel_permission_overwrites_server_id ON channel_permission_overwrites (server_id)",
    "CREATE INDEX IF NOT EXISTS ix_channel_permission_overwrites_channel_id ON channel_permission_overwrites (channel_id)",
]


async def migrate() -> None:
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )

    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")

            for enum_name, values in (
                ("channel_kind", ("'text'", "'voice'")),
                ("overwrite_target_type", ("'role'", "'member'")),
            ):
                exists = await conn.execute(
                    text(
                        """
                        SELECT 1 FROM pg_type WHERE typname = :name
                        """
                    ),
                    {"name": enum_name},
                )
                if exists.fetchall():
                    print(f"  enum {enum_name} — уже существует")
                    continue
                print(f"  enum {enum_name} — создаём...")
                await conn.execute(
                    text(f"CREATE TYPE {enum_name} AS ENUM ({', '.join(values)})")
                )

            table_exists = await conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'channel_permission_overwrites'
                    """
                )
            )
            if table_exists.fetchall():
                print("  channel_permission_overwrites — уже существует")
            else:
                print("  channel_permission_overwrites — создаём...")
                await conn.execute(text(CREATE_TABLE))
                for stmt in CREATE_INDEXES:
                    await conn.execute(text(stmt))
                print("  channel_permission_overwrites — создана")

        await engine.dispose()
        print("Миграция завершена успешно")
    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
