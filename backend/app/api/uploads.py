import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.core.dependencies import get_current_active_user
from app.core.media import to_public_media_path
from app.models.user import User
from app.services.image_upload import read_and_validate_image, save_image_bytes
from app.services.rate_limit import rate_limit_user

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOADS_DIR = Path.cwd() / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
os.chmod(UPLOADS_DIR.parent, 0o755)
os.chmod(UPLOADS_DIR, 0o755)
logger.info("[UPLOAD] Папка загрузок: %s", UPLOADS_DIR.absolute())


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    """Загрузка изображения: только реальные PNG/JPEG/GIF/WEBP."""
    rate_limit_user(current_user.id, "upload", limit=30, window=60, request=request)
    try:
        data, extension, _ctype = await read_and_validate_image(file)
        unique_filename = save_image_bytes(data, UPLOADS_DIR, extension)
        file_url = to_public_media_path(f"/static/uploads/{unique_filename}")
        logger.info(
            "[UPLOAD] user=%s file=%s",
            current_user.id,
            unique_filename,
        )
        return {"file_url": file_url}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[UPLOAD] Ошибка: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера при загрузке файла.",
        ) from exc
    finally:
        await file.close()
