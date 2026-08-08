import logging
import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.media import to_public_media_path
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import Token, User as UserSchema, UserCreate, UserUpdate
from app.services.image_upload import read_and_validate_image, save_image_bytes
from app.services.object_storage import ObjectStorageError, delete_object, delete_public_media, store_public_image
from app.services.rate_limit import rate_limit_auth, rate_limit_user
from app.websocket.connection_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()

AVATARS_DIR = Path.cwd() / "static" / "uploads" / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
try:
    os.chmod(AVATARS_DIR.parent.parent, 0o755)
    os.chmod(AVATARS_DIR.parent, 0o755)
    os.chmod(AVATARS_DIR, 0o755)
except OSError:
    pass


def _local_path_from_avatar_url(avatar_url: str | None) -> Path | None:
    """Преобразует публичный URL аватара в локальный путь, если файл наш."""
    if not avatar_url:
        return None
    path = urlparse(avatar_url).path
    marker = "/static/uploads/avatars/"
    if marker not in path:
        return None
    filename = Path(path).name
    if not filename or filename in {".", ".."}:
        return None
    return AVATARS_DIR / filename


async def _broadcast_profile_update(user: User) -> None:
    """Сообщает всем онлайн-клиентам о смене аватара/имени."""
    await manager.broadcast({
        "type": "user_profile_updated",
        "data": {
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        },
    })

@router.post("/register", response_model=UserSchema)
async def register(
    request: Request,
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """Регистрация нового пользователя"""
    rate_limit_auth(request, "register", limit=5, window=300)
    # Проверка существующего пользователя
    result = await db.execute(
        select(User).where(
            (User.username == user_data.username) | 
            (User.email == user_data.email)
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered"
        )
    
    # Создание нового пользователя
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        display_name=user_data.display_name,
        hashed_password=hashed_password
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return new_user

@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """Вход пользователя"""
    rate_limit_auth(request, "login", limit=20, window=60)
    # Поиск пользователя
    result = await db.execute(
        select(User).where(User.username == form_data.username)
    )
    user = result.scalar_one_or_none()
    
    if not user or user.is_bot or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Создание токена
    access_token = create_access_token(
        data={"sub": str(user.id)}
    )
    
    # Обновление статуса онлайн
    user.is_online = True
    await db.commit()
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserSchema)
async def get_current_user(
    current_user: User = Depends(get_current_active_user)
):
    """Получение информации о текущем пользователе"""
    return current_user


@router.put("/profile", response_model=UserSchema)
async def update_profile(
    profile_data: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Обновление профиля (имя, email и т.п.)."""
    if profile_data.display_name is not None:
        current_user.display_name = profile_data.display_name
    if profile_data.email is not None:
        current_user.email = profile_data.email
    if profile_data.avatar_url is not None:
        current_user.avatar_url = profile_data.avatar_url
    if profile_data.password:
        current_user.hashed_password = get_password_hash(profile_data.password)

    await db.commit()
    await db.refresh(current_user)
    await _broadcast_profile_update(current_user)
    return current_user


@router.post("/avatar")
async def upload_avatar(
    request: Request,
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка аватара пользователя."""
    rate_limit_user(current_user.id, "avatar", limit=10, window=60, request=request)
    new_key = None
    try:
        data, extension, content_type = await read_and_validate_image(avatar)
        avatar_url, new_key = await store_public_image("avatars", data, extension, content_type)
    except HTTPException:
        raise
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
    except Exception as exc:
        logger.error("[AVATAR] Ошибка сохранения: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ошибка сохранения аватара.",
        ) from exc
    finally:
        await avatar.close()

    old_avatar_url = current_user.avatar_url
    current_user.avatar_url = avatar_url
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        if new_key and not new_key.startswith("/"):
            await delete_object(new_key)
        raise
    await db.refresh(current_user)
    if old_avatar_url != avatar_url:
        await delete_public_media(old_avatar_url)
    await _broadcast_profile_update(current_user)

    return {"avatar_url": avatar_url}


@router.delete("/avatar")
async def delete_avatar(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Удаление аватара пользователя."""
    old_avatar_url = current_user.avatar_url
    current_user.avatar_url = None
    await db.commit()
    await db.refresh(current_user)
    await delete_public_media(old_avatar_url)
    await _broadcast_profile_update(current_user)

    return {"message": "Avatar deleted"}
