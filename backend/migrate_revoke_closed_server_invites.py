#!/usr/bin/env python3
"""Одноразовая очистка: на закрытых серверах отзывает все старые приглашения.

Нужно для ссылок, созданных когда сервер ещё был «открытым», а потом
переключатель выключили — такие ссылки раньше продолжали пускать людей.
"""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


async def migrate():
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )

    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")

            result = await conn.execute(
                text(
                    """
                    DELETE FROM server_invites
                    WHERE server_id IN (
                        SELECT id FROM channels WHERE COALESCE(is_public, FALSE) = FALSE
                    )
                    """
                )
            )
            deleted = int(result.rowcount or 0)
            print(f"Отозвано приглашений на закрытых серверах: {deleted}")

        await engine.dispose()
        print("Миграция завершена успешно")

    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
