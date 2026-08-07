import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models import PendingChatUpload
from app.services.object_storage import delete_object


async def cleanup() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(PendingChatUpload).where(PendingChatUpload.created_at < cutoff))).scalars().all()
        for row in rows:
            try:
                await asyncio.to_thread(delete_object, row.storage_key)
            except Exception:
                continue
            await db.delete(row)
        await db.commit()


if __name__ == "__main__":
    asyncio.run(cleanup())
