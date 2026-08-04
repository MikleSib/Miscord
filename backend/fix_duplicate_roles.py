#!/usr/bin/env python3
"""Удаляет дубликаты роли @everyone (оставляет самую раннюю на каждом сервере)."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.core.permissions import ensure_default_role
from app.db.database import AsyncSessionLocal


async def main() -> None:
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    )

    async with engine.begin() as conn:
        before = await conn.execute(
            text(
                """
                SELECT server_id, COUNT(*)
                FROM server_roles
                WHERE is_default = true
                GROUP BY server_id
                HAVING COUNT(*) > 1
                """
            )
        )
        print("Дубликаты до очистки:", before.fetchall())

    async with AsyncSessionLocal() as db:
        servers = await db.execute(
            text("SELECT DISTINCT server_id FROM server_roles WHERE is_default = true")
        )
        for (server_id,) in servers.fetchall():
            await ensure_default_role(db, server_id)
            print(f"  сервер {server_id} — ok")

    async with engine.begin() as conn:
        after = await conn.execute(
            text(
                """
                SELECT server_id, COUNT(*)
                FROM server_roles
                WHERE is_default = true
                GROUP BY server_id
                HAVING COUNT(*) > 1
                """
            )
        )
        print("Дубликаты после очистки:", after.fetchall())

    await engine.dispose()
    print("Готово")


if __name__ == "__main__":
    asyncio.run(main())
