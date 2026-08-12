from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.models.security import UserSession
from app.models.user import User

COOKIE_NAME = "miscord_refresh"
COOKIE_PATH = "/api/v1/auth"


def now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_refresh(session_id: str, secret: str) -> str:
    key = settings.SECRET_KEY.encode("utf-8")
    return hmac.new(key, f"{session_id}:{secret}".encode("utf-8"), hashlib.sha256).hexdigest()


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _cookie_value(session_id: str, secret: str) -> str:
    return f"{session_id}.{secret}"


def _parse_cookie(value: str | None) -> tuple[str, str] | None:
    if not value or "." not in value:
        return None
    session_id, secret = value.split(".", 1)
    try:
        uuid.UUID(session_id)
    except ValueError:
        return None
    return session_id, secret


def session_id_from_request(request: Request) -> str | None:
    parsed = _parse_cookie(request.cookies.get(COOKIE_NAME))
    return parsed[0] if parsed else None


def set_refresh_cookie(response: Response, value: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        value,
        max_age=settings.USER_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        secure=settings.ENVIRONMENT.lower() in {"production", "prod"},
        httponly=True,
        samesite="lax",
        path=COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH, samesite="lax")


async def create_session(db: AsyncSession, user: User, request: Request) -> tuple[str, str]:
    session_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(48)
    expires_at = now() + timedelta(days=settings.USER_REFRESH_TOKEN_EXPIRE_DAYS)
    db.add(UserSession(
        id=session_id,
        user_id=user.id,
        refresh_token_hash=_hash_refresh(session_id, secret),
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        ip_address=_client_ip(request),
        expires_at=expires_at,
    ))
    await db.commit()
    return create_access_token({"sub": str(user.id), "sid": session_id}), _cookie_value(session_id, secret)


async def rotate_session(db: AsyncSession, request: Request) -> tuple[User, str, str] | None:
    parsed = _parse_cookie(request.cookies.get(COOKIE_NAME))
    if parsed is None:
        return None
    session_id, supplied_secret = parsed
    session = (await db.execute(
        select(UserSession).where(UserSession.id == session_id).with_for_update()
    )).scalar_one_or_none()
    if session is None or session.revoked_at is not None or session.expires_at <= now():
        return None
    supplied_hash = _hash_refresh(session_id, supplied_secret)
    current_match = secrets.compare_digest(supplied_hash, session.refresh_token_hash)
    previous_match = bool(
        session.previous_refresh_token_hash
        and session.previous_refresh_valid_until
        and session.previous_refresh_valid_until > now()
        and secrets.compare_digest(supplied_hash, session.previous_refresh_token_hash)
    )
    if not current_match and not previous_match:
        return None
    user = await db.get(User, session.user_id)
    if user is None or not user.is_active or user.is_bot:
        session.revoked_at = now()
        await db.commit()
        return None
    next_secret = secrets.token_urlsafe(48)
    session.previous_refresh_token_hash = session.refresh_token_hash
    session.previous_refresh_valid_until = now() + timedelta(seconds=30)
    session.refresh_token_hash = _hash_refresh(session_id, next_secret)
    session.last_seen_at = now()
    session.user_agent = (request.headers.get("user-agent") or "")[:512] or session.user_agent
    session.ip_address = _client_ip(request)
    await db.commit()
    access = create_access_token({"sub": str(user.id), "sid": session_id})
    return user, access, _cookie_value(session_id, next_secret)


async def revoke_session(db: AsyncSession, session_id: str, user_id: int | None = None) -> bool:
    conditions = [UserSession.id == session_id, UserSession.revoked_at.is_(None)]
    if user_id is not None:
        conditions.append(UserSession.user_id == user_id)
    result = await db.execute(update(UserSession).where(*conditions).values(revoked_at=now()))
    await db.commit()
    return bool(result.rowcount)


async def revoke_all_sessions(db: AsyncSession, user_id: int, *, except_id: str | None = None) -> int:
    query = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_id:
        query = query.where(UserSession.id != except_id)
    result = await db.execute(query.values(revoked_at=now()))
    await db.commit()
    return int(result.rowcount or 0)


async def is_session_active(db: AsyncSession, session_id: str, user_id: int) -> bool:
    session = (await db.execute(select(UserSession.id).where(
        UserSession.id == session_id,
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > now(),
    ))).scalar_one_or_none()
    return session is not None
