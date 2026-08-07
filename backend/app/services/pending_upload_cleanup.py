import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models import PendingChatUpload
from app.services.object_storage import delete_object


async def cleanup_pending_uploads_once() -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    removed = 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(PendingChatUpload).where(PendingChatUpload.created_at < cutoff))).scalars().all()
        for row in rows:
            try:
                await asyncio.to_thread(delete_object, row.storage_key)
            except Exception:
                continue
            await db.delete(row)
            removed += 1
        await db.commit()
    return removed


async def run_pending_upload_cleanup_loop() -> None:
    while True:
        try:
            await cleanup_pending_uploads_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(24 * 60 * 60)
