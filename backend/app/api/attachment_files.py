import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.attachment import Attachment
from app.services.attachment_storage import safe_filename, verify_attachment_signature
from app.services.object_storage import (
    ObjectStorageError,
    attachment_object_key,
    delivery_url,
    is_public_object_key,
)


router = APIRouter()


def _redirect(storage_key: str, expires_in: int | None = None) -> RedirectResponse:
    try:
        url = delivery_url(storage_key, expires_in=expires_in)
    except (ObjectStorageError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
    return RedirectResponse(
        url,
        status_code=307,
        headers={
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/media/{storage_key:path}")
async def download_public_media(storage_key: str):
    if not is_public_object_key(storage_key):
        raise HTTPException(status_code=404, detail="Media not found")
    return _redirect(storage_key)


@router.get("/attachments/{attachment_id}/{expires}/{signature}/{filename}")
async def download_attachment(
    attachment_id: int,
    expires: int,
    signature: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
):
    if not verify_attachment_signature(attachment_id, expires, signature, filename):
        raise HTTPException(status_code=403, detail="Attachment URL is invalid or expired")
    attachment = await db.get(Attachment, attachment_id)
    if not attachment or not attachment.storage_key:
        raise HTTPException(status_code=404, detail="Attachment not found")
    safe_filename(attachment.original_filename or filename)
    return _redirect(attachment_object_key(attachment.storage_key), max(60, expires - int(time.time())))
