"""Idempotent schema migration for bot installation and managed roles."""

import asyncio
from sqlalchemy import text
from app.db.database import engine

STATEMENTS = (
    "ALTER TABLE bot_installs ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES server_roles(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_bot_installs_role_id ON bot_installs(role_id)",
    "ALTER TABLE server_roles ADD COLUMN IF NOT EXISTS managed_by_bot_application_id INTEGER REFERENCES bot_applications(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_server_roles_managed_by_bot_application_id ON server_roles(managed_by_bot_application_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_server_bot_managed_role ON server_roles(server_id, managed_by_bot_application_id) WHERE managed_by_bot_application_id IS NOT NULL",
)

async def migrate() -> None:
    async with engine.begin() as connection:
        for statement in STATEMENTS:
            await connection.execute(text(statement))
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(migrate())
