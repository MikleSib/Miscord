import shutil
from fastapi import APIRouter, UploadFile, File, HTTPException, status, Depends
from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.models.user import User

router = APIRouter()

# Создаем директорию для загрузок, если она не существует
UPLOADS_DIR = Path("static/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """
    Загрузка файла (изображения) на сервер.
    """
    # Проверка типа файла
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Поддерживаются только изображения."
        )

    # Проверка размера файла (например, 5MB)
    if file.size > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Размер файла не должен превышать 5MB."
        )
        
    # Генерируем уникальное имя файла
    file_extension = Path(file.filename).suffix
    unique_filename = f"{uuid4()}{file_extension}"
    file_path = UPLOADS_DIR / unique_filename

    # Сохраняем файл
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        file.file.close()

    # Возвращаем URL файла
    file_url = f"{settings.SERVER_HOST}/static/uploads/{unique_filename}"
    
    return {"file_url": file_url} 