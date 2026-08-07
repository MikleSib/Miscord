#!/usr/bin/env python3
"""Создаёт таблицы персональных настроек уведомлений сервера."""

import asyncio

from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.db.database import Base
from app.models.notification_settings import (  # noqa: F401
    ChannelNotificationOverride,
    ServerNotificationSettings,
)


async def migrate():
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )
    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")
            await conn.run_sync(Base.metadata.create_all)
            print("Таблицы server_notification_settings и channel_notification_overrides готовы")
        await engine.dispose()
        print("Миграция завершена успешно")
    except Exception as exc:
        print(f"Ошибка при выполнении миграции: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate())
