from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Depends, Form, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user
from app.db.database import get_db
from app.models import BotApplication, BotOAuthAuthorizationCode, BotOAuthToken, Channel, User
from app.schemas.bot_install import BotInstallRequest
from app.services.bot_oauth import (
    ACCESS_TOKEN_SECONDS,
    generate_access_token,
    generate_refresh_token,
    oauth_principal_from_token,
    token_hash,
)
from app.services.bot_security import hash_client_secret


router = APIRouter()

SUPPORTED_SCOPES = {
    "activities.read",
    "activities.write",
    "applications.builds.read",
    "applications.builds.upload",
    "applications.commands",
    "applications.commands.permissions.update",
    "applications.commands.update",
    "applications.entitlements",
    "applications.store.update",
    "bot",
    "connections",
    "dm_channels.read",
    "email",
    "gdm.join",
    "guilds",
    "guilds.join",
    "guilds.members.read",
    "identify",
    "messages.read",
    "relationships.read",
    "role_connections.write",
    "rpc",
    "rpc.activities.write",
    "rpc.notifications.read",
    "rpc.voice.read",
    "rpc.voice.write",
    "voice",
    "webhook.incoming",
}


def _oauth_error(error: str, description: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"error": error, "error_description": description})


def _parse_scopes(value: str) -> list[str]:
    scopes = list(dict.fromkeys(item for item in value.split() if item))
    unsupported = sorted(set(scopes) - SUPPORTED_SCOPES)
    if unsupported:
        raise _oauth_error("invalid_scope", f"Unsupported scopes: {', '.join(unsupported)}")
    return scopes


async def _application(db: AsyncSession, client_id: str) -> BotApplication:
    result = await db.execute(
        select(BotApplication)
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(BotApplication.client_id == client_id, BotApplication.status == "active")
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise _oauth_error("invalid_client", "Invalid client", 401)
    return application


def _registered_redirect(application: BotApplication, redirect_uri: str | None) -> str:
    if not redirect_uri:
        raise _oauth_error("invalid_request", "redirect_uri is required")
    if redirect_uri not in set(application.redirect_uris or []):
        raise _oauth_error("invalid_grant", "Invalid redirect_uri")
    return redirect_uri


def _client_credentials(authorization: str | None, client_id: str | None, client_secret: str | None) -> tuple[str, str]:
    if authorization and authorization.startswith("Basic "):
        try:
            raw = base64.b64decode(authorization[6:].strip()).decode("utf-8")
            basic_id, basic_secret = raw.split(":", 1)
            return basic_id, basic_secret
        except Exception as exc:
            raise _oauth_error("invalid_client", "Invalid client authentication", 401) from exc
    if not client_id:
        raise _oauth_error("invalid_client", "Client authentication is required", 401)
    return client_id, client_secret or ""


def _verify_client_secret(application: BotApplication, value: str) -> None:
    digest = hash_client_secret(value)
    if not hmac.compare_digest(application.secret.client_secret_hash, digest):
        raise _oauth_error("invalid_client", "Invalid client authentication", 401)


async def _issue_token(
    db: AsyncSession,
    application: BotApplication,
    scopes: list[str],
    *,
    user_id: int | None,
    grant_type: str,
    with_refresh: bool,
) -> dict[str, Any]:
    access_token = generate_access_token()
    refresh_token = generate_refresh_token() if with_refresh else None
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TOKEN_SECONDS)
    db.add(BotOAuthToken(
        access_token_hash=token_hash(access_token),
        refresh_token_hash=token_hash(refresh_token) if refresh_token else None,
        application_id=application.id,
        user_id=user_id,
        scopes=scopes,
        grant_type=grant_type,
        expires_at=expires_at,
    ))
    await db.commit()
    payload: dict[str, Any] = {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_SECONDS,
        "scope": " ".join(scopes),
    }
    if refresh_token:
        payload["refresh_token"] = refresh_token
    return payload


@router.get("/authorize")
async def authorization_preview(
    client_id: str,
    response_type: str | None = None,
    redirect_uri: str | None = None,
    scope: str = "identify",
    state: str | None = None,
    permissions: int = 0,
    guild_id: int | None = None,
    disable_guild_select: bool = False,
    integration_type: int = 0,
    code_challenge: str | None = None,
    code_challenge_method: str | None = None,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    application = await _application(db, client_id)
    scopes = _parse_scopes(scope)
    if response_type in {"code", "token"}:
        _registered_redirect(application, redirect_uri)
    if code_challenge_method and code_challenge_method not in {"plain", "S256"}:
        raise _oauth_error("invalid_request", "code_challenge_method must be plain or S256")
    if code_challenge_method and not code_challenge:
        raise _oauth_error("invalid_request", "code_challenge is required with code_challenge_method")
    if "bot" in scopes and not application.bot_public and application.owner_id != current_user.id:
        raise _oauth_error("access_denied", "This bot is private", 403)
    servers_result = await db.execute(
        select(Channel).where(Channel.owner_id == current_user.id).order_by(Channel.name)
    )
    return {
        "application": {
            "id": application.client_id,
            "name": application.name,
            "icon": application.avatar_url,
            "description": application.description or "",
            "bot_public": bool(application.bot_public),
            "bot_require_code_grant": bool(application.bot_require_code_grant),
        },
        "scopes": scopes,
        "response_type": response_type,
        "redirect_uri": redirect_uri,
        "state": state,
        "permissions": str(permissions),
        "guild_id": str(guild_id) if guild_id else None,
        "disable_guild_select": disable_guild_select,
        "integration_type": integration_type,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "servers": [{"id": str(item.id), "name": item.name, "icon": item.icon} for item in servers_result.scalars().all()],
    }


@router.post("/authorize")
async def authorize(
    payload: dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    client_id = str(payload.get("client_id") or "")
    application = await _application(db, client_id)
    scopes = _parse_scopes(str(payload.get("scope") or "identify"))
    response_type = str(payload.get("response_type") or "") or None
    redirect_uri = payload.get("redirect_uri")
    state = str(payload.get("state") or "")
    code_challenge = payload.get("code_challenge")
    code_challenge_method = payload.get("code_challenge_method")
    if code_challenge_method and code_challenge_method not in {"plain", "S256"}:
        raise _oauth_error("invalid_request", "code_challenge_method must be plain or S256")
    if code_challenge_method and not code_challenge:
        raise _oauth_error("invalid_request", "code_challenge is required with code_challenge_method")
    if application.bot_require_code_grant and "bot" in scopes and response_type != "code":
        raise _oauth_error("unsupported_response_type", "This bot requires the authorization code grant")
    if "bot" in scopes:
        if not application.bot_public and application.owner_id != current_user.id:
            raise _oauth_error("access_denied", "This bot is private", 403)
        guild_id = payload.get("guild_id") or payload.get("server_id")
        if not guild_id:
            raise _oauth_error("invalid_request", "guild_id is required for bot authorization")
        from app.api.bot_platform import authorize_bot_install
        await authorize_bot_install(
            BotInstallRequest(
                client_id=client_id,
                server_id=int(guild_id),
                scope=" ".join(item for item in scopes if item in {"bot", "applications.commands"}),
                permissions=int(payload.get("permissions") or 0),
            ),
            current_user=current_user,
            db=db,
        )
    if response_type == "code":
        redirect = _registered_redirect(application, str(redirect_uri or ""))
        code = secrets.token_urlsafe(32)
        db.add(BotOAuthAuthorizationCode(
            code_hash=token_hash(code),
            application_id=application.id,
            user_id=current_user.id,
            redirect_uri=redirect,
            scopes=scopes,
            guild_id=int(payload["guild_id"]) if payload.get("guild_id") else None,
            permissions=int(payload.get("permissions") or 0),
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        ))
        await db.commit()
        separator = "&" if "?" in redirect else "?"
        return {"location": f"{redirect}{separator}{urlencode({'code': code, **({'state': state} if state else {})})}"}
    if response_type == "token":
        redirect = _registered_redirect(application, str(redirect_uri or ""))
        token = await _issue_token(db, application, scopes, user_id=current_user.id, grant_type="implicit", with_refresh=False)
        fragment = urlencode({**token, **({"state": state} if state else {})})
        return {"location": f"{redirect}#{fragment}"}
    return {"authorized": True, "location": None}


@router.post("/token")
async def exchange_token(
    grant_type: str = Form(...),
    code: str | None = Form(default=None),
    redirect_uri: str | None = Form(default=None),
    refresh_token: str | None = Form(default=None),
    scope: str = Form(default=""),
    client_id: str | None = Form(default=None),
    client_secret: str | None = Form(default=None),
    code_verifier: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    resolved_client_id, resolved_secret = _client_credentials(authorization, client_id, client_secret)
    application = await _application(db, resolved_client_id)
    if grant_type == "authorization_code":
        if not code:
            raise _oauth_error("invalid_request", "code is required")
        result = await db.execute(
            select(BotOAuthAuthorizationCode)
            .where(BotOAuthAuthorizationCode.code_hash == token_hash(code))
            .with_for_update()
        )
        grant = result.scalar_one_or_none()
        if grant is None or grant.application_id != application.id or grant.used_at is not None:
            raise _oauth_error("invalid_grant", "Invalid authorization code")
        expires_at = grant.expires_at if grant.expires_at.tzinfo else grant.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc) or grant.redirect_uri != redirect_uri:
            raise _oauth_error("invalid_grant", "Authorization code expired or redirect_uri does not match")
        if grant.code_challenge:
            if not code_verifier:
                raise _oauth_error("invalid_grant", "code_verifier is required")
            if grant.code_challenge_method == "S256":
                expected = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
            else:
                expected = code_verifier
            if not hmac.compare_digest(expected, grant.code_challenge):
                raise _oauth_error("invalid_grant", "Invalid code_verifier")
        else:
            _verify_client_secret(application, resolved_secret)
        grant.used_at = datetime.now(timezone.utc)
        await db.flush()
        return await _issue_token(db, application, list(grant.scopes or []), user_id=grant.user_id, grant_type=grant_type, with_refresh=True)
    _verify_client_secret(application, resolved_secret)
    if grant_type == "client_credentials":
        scopes = _parse_scopes(scope)
        if any(item in {"identify", "email", "guilds", "connections", "guilds.members.read"} for item in scopes):
            raise _oauth_error("invalid_scope", "Client credentials cannot request user scopes")
        return await _issue_token(db, application, scopes, user_id=None, grant_type=grant_type, with_refresh=False)
    if grant_type == "refresh_token":
        if not refresh_token:
            raise _oauth_error("invalid_request", "refresh_token is required")
        result = await db.execute(
            select(BotOAuthToken)
            .where(BotOAuthToken.refresh_token_hash == token_hash(refresh_token), BotOAuthToken.revoked_at.is_(None))
            .with_for_update()
        )
        stored = result.scalar_one_or_none()
        if stored is None or stored.application_id != application.id:
            raise _oauth_error("invalid_grant", "Invalid refresh token")
        stored.revoked_at = datetime.now(timezone.utc)
        requested = _parse_scopes(scope) if scope else list(stored.scopes or [])
        if not set(requested).issubset(set(stored.scopes or [])):
            raise _oauth_error("invalid_scope", "Requested scope exceeds the original grant")
        await db.flush()
        return await _issue_token(db, application, requested, user_id=stored.user_id, grant_type=grant_type, with_refresh=True)
    raise _oauth_error("unsupported_grant_type", "Unsupported grant type")


@router.post("/token/revoke")
async def revoke_token(
    token: str = Form(...),
    token_type_hint: str | None = Form(default=None),
    client_id: str | None = Form(default=None),
    client_secret: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    resolved_client_id, resolved_secret = _client_credentials(authorization, client_id, client_secret)
    application = await _application(db, resolved_client_id)
    _verify_client_secret(application, resolved_secret)
    digest = token_hash(token)
    result = await db.execute(select(BotOAuthToken).where(
        BotOAuthToken.application_id == application.id,
        (BotOAuthToken.refresh_token_hash == digest) | (BotOAuthToken.access_token_hash == digest),
    ))
    stored = result.scalar_one_or_none()
    if stored is not None:
        stored.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    return {"revoked": True}


@router.get("/@me")
async def get_current_authorization(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise _oauth_error("invalid_token", "Bearer token is required", 401)
    principal = await oauth_principal_from_token(authorization[7:].strip(), db)
    if principal is None:
        raise _oauth_error("invalid_token", "Invalid or expired access token", 401)
    return {
        "application": {
            "id": principal.application.client_id,
            "name": principal.application.name,
            "icon": principal.application.avatar_url,
            "description": principal.application.description or "",
        },
        "scopes": sorted(principal.scopes),
        "expires": principal.token.expires_at.isoformat(),
        "user": ({"id": str(principal.user.id), "username": principal.user.username} if principal.user else None),
    }
