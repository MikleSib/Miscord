from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import BotApplication, BotOAuthToken, User


ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60


@dataclass(frozen=True)
class OAuthPrincipal:
    token: BotOAuthToken
    application: BotApplication
    user: User | None
    scopes: frozenset[str]


def generate_access_token() -> str:
    return f"mca_{secrets.token_urlsafe(32)}"


def generate_refresh_token() -> str:
    return f"mcr_{secrets.token_urlsafe(32)}"


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def oauth_principal_from_token(token: str, db: AsyncSession) -> OAuthPrincipal | None:
    digest = token_hash(token)
    result = await db.execute(
        select(BotOAuthToken)
        .options(selectinload(BotOAuthToken.application), selectinload(BotOAuthToken.user))
        .where(BotOAuthToken.access_token_hash == digest, BotOAuthToken.revoked_at.is_(None))
    )
    stored = result.scalar_one_or_none()
    if stored is None or not hmac.compare_digest(stored.access_token_hash, digest):
        return None
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc) or stored.application.status != "active":
        return None
    return OAuthPrincipal(
        token=stored,
        application=stored.application,
        user=stored.user,
        scopes=frozenset(stored.scopes or []),
    )
