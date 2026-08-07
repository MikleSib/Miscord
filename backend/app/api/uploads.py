import asyncio
import os
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import PendingChatUpload
from app.services.image_upload import stream_and_validate_chat_media
from app.services.object_storage import delete_object, new_public_object_key, public_media_url, put_file
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.core.dependencies import get_current_active_user
from app.core.media import to_public_media_path
from app.models.user import User
from app.services.image_upload import read_and_validate_chat_media
from app.services.object_storage import ObjectStorageError, store_public_image
from app.services.rate_limit import rate_limit_user

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOADS_DIR = Path.cwd() / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
os.chmod(UPLOADS_DIR.parent, 0o755)
os.chmod(UPLOADS_DIR, 0o755)
logger.info("[UPLOAD] РџР°РїРєР° Р·Р°РіСЂСѓР·РѕРє: %s", UPLOADS_DIR.absolute())


@router.post("/upload")
async def upload_chat_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    fd, temp_path = tempfile.mkstemp(prefix="miscord-upload-", suffix=".quarantine")
    os.close(fd)
    storage_key = None
    try:
        extension, content_type, size_bytes = await stream_and_validate_chat_media(file, temp_path)
        storage_key = new_public_object_key("uploads", extension)
        await asyncio.to_thread(put_file, storage_key, temp_path, content_type)
        upload_id = str(uuid.uuid4())
        file_url = public_media_url(storage_key)
        original_filename = Path(file.filename or f"upload{extension}").name[:255]
        pending = PendingChatUpload(
            id=upload_id,
            owner_id=current_user.id,
            storage_key=storage_key,
            file_url=file_url,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size_bytes,
        )
        db.add(pending)
        await db.commit()
        return {
            "upload_id": upload_id,
            "file_url": file_url,
            "filename": original_filename,
            "content_type": content_type,
            "size_bytes": size_bytes,
        }
    except HTTPException:
        if storage_key:
            await asyncio.to_thread(delete_object, storage_key)
        raise
    except Exception:
        await db.rollback()
        if storage_key:
            try:
                await asyncio.to_thread(delete_object, storage_key)
            except Exception:
                pass
        raise HTTPException(status_code=503, detail="Хранилище файлов временно недоступно")
    finally:
        try:
            os.remove(temp_path)
        except FileNotFoundError:
            pass


@router.delete("/uploads/{upload_id}", status_code=204)
async def delete_pending_upload(
    upload_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    pending = (await db.execute(select(PendingChatUpload).where(
        PendingChatUpload.id == upload_id,
        PendingChatUpload.owner_id == current_user.id,
    ))).scalar_one_or_none()
    if pending is None:
        raise HTTPException(status_code=404, detail="Загрузка не найдена")
    try:
        await asyncio.to_thread(delete_object, pending.storage_key)
    except Exception:
        raise HTTPException(status_code=503, detail="Не удалось удалить файл из хранилища")
    await db.delete(pending)
    await db.commit()
