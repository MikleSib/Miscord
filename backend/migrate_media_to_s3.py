from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.attachment import Attachment
from app.models.channel import Channel
from app.models.user import User
from app.models.webhook import Webhook
from app.services.object_storage import (
    attachment_object_key,
    content_type_for_path,
    full_object_key,
    object_storage_enabled,
    public_media_url,
    put_file,
)


STATIC_ROOT = Path.cwd() / "static" / "uploads"
ATTACHMENT_ROOT = Path("/app/data/attachments")


def public_key_for_relative(relative: Path) -> str:
    if relative.parts and relative.parts[0] in {"avatars", "webhook-avatars"}:
        return full_object_key(f"public/{relative.as_posix()}")
    return full_object_key(f"public/uploads/{relative.as_posix()}")


async def upload_existing_files() -> tuple[int, int]:
    public_count = 0
    attachment_count = 0
    if STATIC_ROOT.exists():
        for path in STATIC_ROOT.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(STATIC_ROOT)
            await put_file(
                public_key_for_relative(relative),
                path,
                content_type=content_type_for_path(path),
                filename=path.name,
                inline=True,
            )
            public_count += 1
    if ATTACHMENT_ROOT.exists():
        for path in ATTACHMENT_ROOT.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(ATTACHMENT_ROOT).as_posix()
            content_type = content_type_for_path(path)
            await put_file(
                attachment_object_key(relative),
                path,
                content_type=content_type,
                filename=path.name,
                inline=content_type.startswith(("image/", "audio/", "video/")),
            )
            attachment_count += 1
    return public_count, attachment_count


def migrated_public_url(value: str | None) -> str | None:
    if not value or "/static/uploads/" not in value:
        return value
    relative = Path(value.split("/static/uploads/", 1)[1].split("?", 1)[0])
    return public_media_url(public_key_for_relative(relative))


async def update_database_urls() -> int:
    changed = 0
    async with AsyncSessionLocal() as db:
        for model, fields in (
            (User, ("avatar_url",)),
            (Channel, ("icon", "banner")),
            (Webhook, ("avatar_url",)),
            (Attachment, ("file_url",)),
        ):
            rows = (await db.execute(select(model))).scalars().all()
            for row in rows:
                for field in fields:
                    old_value = getattr(row, field)
                    new_value = migrated_public_url(old_value)
                    if new_value != old_value:
                        setattr(row, field, new_value)
                        changed += 1
        await db.commit()
    return changed


async def main() -> None:
    if not object_storage_enabled():
        raise RuntimeError("S3_ENABLED must be true")
    public_count, attachment_count = await upload_existing_files()
    changed = await update_database_urls()
    print(
        f"S3 migration complete: public_files={public_count} "
        f"attachments={attachment_count} database_urls={changed}"
    )


if __name__ == "__main__":
    asyncio.run(main())
