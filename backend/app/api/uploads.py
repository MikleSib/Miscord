import shutil
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, status, Depends
from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

# Создаем директорию для загрузок, если она не существует
# Используем абсолютный путь относительно текущей рабочей директории
UPLOADS_DIR = Path.cwd() / "static" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
logger.info(f"[UPLOAD] Папка загрузок: {UPLOADS_DIR.absolute()}")

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """
    Загрузка файла (изображения) на сервер.
    """
    try:
        logger.info(f"[UPLOAD] Пользователь {current_user.username} загружает файл: {file.filename}")
        logger.info(f"[UPLOAD] Тип файла: {file.content_type}, размер: {file.size}")
        
        # Проверка имени файла
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Имя файла не может быть пустым."
            )
        
        # Проверка типа файла
        if not file.content_type or not file.content_type.startswith("image/"):
            logger.warning(f"[UPLOAD] Неподдерживаемый тип файла: {file.content_type}")
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Поддерживаются только изображения."
            )

        # Проверка размера файла (например, 5MB) - если размер доступен
        if file.size is not None and file.size > 5 * 1024 * 1024:
            logger.warning(f"[UPLOAD] Файл слишком большой: {file.size} байт")
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Размер файла не должен превышать 5MB."
            )
            
        # Генерируем уникальное имя файла
        file_extension = Path(file.filename).suffix
        unique_filename = f"{uuid4()}{file_extension}"
        file_path = UPLOADS_DIR / unique_filename
        
        logger.info(f"[UPLOAD] Сохраняем файл как: {unique_filename}")

        # Сохраняем файл
        try:
            with file_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            logger.info(f"[UPLOAD] Файл успешно сохранен: {file_path}")
        except Exception as e:
            logger.error(f"[UPLOAD] Ошибка сохранения файла: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Ошибка сохранения файла на сервере."
            )
        finally:
            file.file.close()

        # Возвращаем URL файла
        file_url = f"{settings.SERVER_HOST}/static/uploads/{unique_filename}"
        logger.info(f"[UPLOAD] Файл доступен по URL: {file_url}")
        
        return {"file_url": file_url}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[UPLOAD] Неожиданная ошибка: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера при загрузке файла."
        ) 