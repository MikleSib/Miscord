from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.schemas.user import TokenData
from app.services.user_sessions import is_session_active

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
security = HTTPBearer()

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Получение текущего пользователя из токена"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
    
    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if user_id is None or not isinstance(session_id, str):
        raise credentials_exception
    
    token_data = TokenData(user_id=int(user_id))
    
    result = await db.execute(
        select(User).where(User.id == token_data.user_id)
    )
    user = result.scalar_one_or_none()
    
    if user is None or user.is_bot or not await is_session_active(db, session_id, int(user_id)):
        raise credentials_exception
    
    return user

optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_optional_user(
    token: str | None = Depends(optional_oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User | None:
    """Пользователь, если запрос авторизован. Иначе None (без ошибки).

    Нужно для страниц вида «превью приглашения», доступных до входа в аккаунт.
    """
    if not token:
        return None

    payload = decode_access_token(token)
    if payload is None:
        return None

    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if user_id is None or not isinstance(session_id, str):
        return None

    if not await is_session_active(db, session_id, int(user_id)):
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    return user if user is not None and not user.is_bot else None


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Проверка, что пользователь активен"""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

async def get_current_user_ws(token: str, db: AsyncSession) -> User | None:
    """Получение текущего пользователя для WebSocket соединений"""
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        session_id = payload.get("sid")
        if user_id is None or not isinstance(session_id, str):
            return None
        if not await is_session_active(db, session_id, int(user_id)):
            return None
    except Exception:
        return None
    
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    
    return user
