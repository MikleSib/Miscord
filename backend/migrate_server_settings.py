#!/usr/bin/env python3
"""Миграция настроек сервера Miscord.

Добавляет колонки в существующие таблицы:
  - channels.banner, channels.is_public
  - channel_members.nickname

Новые таблицы (server_roles, server_member_roles, server_bans, server_invites,
server_audit_logs) создаются автоматически через Base.metadata.create_all при
старте приложения, поэтому здесь их нет.
"""

import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

COLUMNS = [
    ("channels", "banner", "VARCHAR"),
    ("channels", "is_public", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("channel_members", "nickname", "VARCHAR"),
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

        await engine.dispose()
        print("Миграция завершена успешно")

    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
