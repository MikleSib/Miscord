#!/usr/bin/env python3
"""Добавляет slow_mode_seconds для текстовых каналов."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


async def migrate() -> None:
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )

    try:
        async with engine.begin() as conn:
            exists = await conn.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'text_channels' AND column_name = 'slow_mode_seconds'
                    """
                )
            )
            if exists.fetchall():
                print("text_channels.slow_mode_seconds — уже существует")
            else:
                print("text_channels.slow_mode_seconds — добавляем...")
                await conn.execute(
                    text(
                        "ALTER TABLE text_channels ADD COLUMN slow_mode_seconds INTEGER DEFAULT 0 NOT NULL"
                    )
                )
                print("text_channels.slow_mode_seconds — добавлено")

        await engine.dispose()
        print("Миграция завершена успешно")
    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
