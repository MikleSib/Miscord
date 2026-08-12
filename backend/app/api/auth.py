import logging
import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.media import to_public_media_path
from app.core.security import verify_password
from app.db.database import get_db
from app.models.user import User
from app.models.security import UserSession
from app.schemas.user import Token, User as UserSchema, UserUpdate
from app.services.image_upload import read_and_validate_image, save_image_bytes
from app.services.object_storage import ObjectStorageError, delete_object, delete_public_media, store_public_image
from app.services.rate_limit import rate_limit_auth, rate_limit_user
from app.websocket.connection_manager import manager
from app.services.user_sessions import (
    clear_refresh_cookie,
    create_session,
    now as session_now,
    revoke_all_sessions,
    revoke_session,
    rotate_session,
    session_id_from_request,
    set_refresh_cookie,
)
from app.models.account_security import UserTwoFactor
from app.services.account_security import verify_second_factor

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

@router.post("/login", response_model=Token)
async def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    otp: str | None = Form(default=None),
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

    if await db.get(UserTwoFactor, user.id):
        if not otp:
            raise HTTPException(
                status_code=428,
                detail={"code": "two_factor_required", "message": "Введите код двухфакторной аутентификации."},
            )
        if not await verify_second_factor(db, user.id, otp):
            raise HTTPException(status_code=401, detail="Неверный код двухфакторной аутентификации")
    
    # Создание токена
    access_token, refresh_cookie = await create_session(db, user, request)
    set_refresh_cookie(response, refresh_cookie)
    
    # Обновление статуса онлайн
    user.is_online = True
    await db.commit()
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/refresh", response_model=Token)
async def refresh_access_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    rotated = await rotate_session(db, request)
    if rotated is None:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh session is invalid or expired")
    _user, access_token, refresh_cookie = rotated
    set_refresh_cookie(response, refresh_cookie)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    session_id = session_id_from_request(request)
    if session_id:
        await revoke_session(db, session_id)
    clear_refresh_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers=response.headers)


@router.get("/sessions")
async def list_sessions(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    current_id = session_id_from_request(request)
    rows = (await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > session_now(),
        ).order_by(UserSession.last_seen_at.desc())
    )).scalars().all()
    return [{
        "id": item.id,
        "user_agent": item.user_agent,
        "ip_address": item.ip_address,
        "created_at": item.created_at,
        "last_seen_at": item.last_seen_at,
        "expires_at": item.expires_at,
        "current": item.id == current_id,
    } for item in rows]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not await revoke_session(db, session_id, current_user.id):
        raise HTTPException(status_code=404, detail="Session not found")


@router.post("/sessions/revoke-all")
async def delete_other_sessions(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return {"revoked": await revoke_all_sessions(
        db, current_user.id, except_id=session_id_from_request(request)
    )}

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
    if profile_data.avatar_url is not None:
        current_user.avatar_url = profile_data.avatar_url

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
