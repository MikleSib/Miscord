from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.attachment import Attachment
from app.services.attachment_storage import safe_filename, verify_attachment_signature


router = APIRouter()


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
    root = Path(settings.ATTACHMENT_STORAGE_DIR).resolve()
    path = (root / attachment.storage_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found")
    name = safe_filename(attachment.original_filename or filename)
    inline = (attachment.content_type or "").startswith(("image/", "audio/", "video/"))
    disposition = "inline" if inline else "attachment"
    if settings.ATTACHMENT_X_ACCEL_ENABLED:
        return Response(
            headers={
                "X-Accel-Redirect": f"/_protected_attachments/{attachment.storage_key}",
                "Content-Type": attachment.content_type or "application/octet-stream",
                "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
                "X-Content-Type-Options": "nosniff",
            }
        )
    return FileResponse(
        path,
        media_type=attachment.content_type or "application/octet-stream",
        filename=None if inline else name,
        headers={"X-Content-Type-Options": "nosniff"},
    )
