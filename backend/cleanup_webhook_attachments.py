#!/usr/bin/env python3
"""Remove stale quarantine files and unreferenced managed attachments."""

import argparse
import asyncio
import time
from pathlib import Path

from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.attachment import Attachment


async def cleanup(older_than_hours: int, dry_run: bool) -> tuple[int, int]:
    cutoff = time.time() - older_than_hours * 3600
    quarantine_removed = 0
    orphan_removed = 0
    quarantine = Path(settings.ATTACHMENT_QUARANTINE_DIR)
    if quarantine.exists():
        for path in quarantine.iterdir():
            if path.is_file() and path.stat().st_mtime < cutoff:
                quarantine_removed += 1
                if not dry_run:
                    path.unlink(missing_ok=True)

    async with AsyncSessionLocal() as db:
        rows = await db.execute(select(Attachment.storage_key).where(Attachment.storage_key.is_not(None)))
        referenced = {value for value in rows.scalars().all() if value}
    root = Path(settings.ATTACHMENT_STORAGE_DIR)
    if root.exists():
        for path in root.rglob("*"):
            if not path.is_file() or path.stat().st_mtime >= cutoff:
                continue
            key = path.relative_to(root).as_posix()
            if key not in referenced:
                orphan_removed += 1
                if not dry_run:
                    path.unlink(missing_ok=True)
    return quarantine_removed, orphan_removed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--older-than-hours", type=int, default=24)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(asyncio.run(cleanup(args.older_than_hours, args.dry_run)))

