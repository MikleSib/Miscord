#!/usr/bin/env python3
"""Добавляет bitrate и video_quality в voice_channels, обновляет смысл max_users=0."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

COLUMNS = [
    ("voice_channels", "bitrate", "INTEGER NOT NULL DEFAULT 64"),
    ("voice_channels", "video_quality", "VARCHAR(16) NOT NULL DEFAULT 'auto'"),
]


async def migrate():
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )

    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")

            for table, column, column_type in COLUMNS:
                exists = await conn.execute(
                    text(
                        """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_name = :table AND column_name = :column
                        """
                    ),
                    {"table": table, "column": column},
                )
                if exists.fetchall():
                    print(f"  {table}.{column} — уже существует, пропускаем")
                    continue

                print(f"  {table}.{column} — добавляем...")
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
                )
                print(f"  {table}.{column} — добавлено")

            # Старый дефолт 10 оставляем как есть у существующих каналов.
            # Новые каналы создаются с max_users=0 (без лимита).

        await engine.dispose()
        print("Миграция завершена успешно")
    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
