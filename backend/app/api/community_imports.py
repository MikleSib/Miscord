from __future__ import annotations

import json
import secrets
from datetime import timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.db.database import get_db
from app.models import ExternalServerImport, User
from app.schemas.server_import import CreateImportedServerRequest, OAuthImportRequest, TemplateImportRequest
from app.services.external_source_client import (
    bot_install_url,
    exchange_oauth_code,
    extract_template_code,
    fetch_guild_snapshot,
    fetch_public_template,
    fetch_user_guilds,
    leave_import_guild,
    oauth_authorize_url,
    oauth_configured,
)
from app.services.external_source_normalizer import normalize_source_guild, template_source
from app.services.external_import_security import state_hash
from app.services.server_imports import import_payload, locked_owned_import, new_import, owned_import, utcnow
from app.services.server_templates import instantiate_template

router = APIRouter()


def _require_feature() -> None:
    if not settings.SERVER_IMPORTS_ENABLED:
        raise HTTPException(status_code=404, detail="Перенос серверов пока недоступен")


def _redirect_uri() -> str:
    return f"{settings.SERVER_HOST.rstrip('/')}/api/v1/server-imports/external/oauth/callback"


def _install_url(item: ExternalServerImport) -> str | None:
    if item.status == "awaiting_bot" and item.external_server_id and oauth_configured():
        return bot_install_url(item.external_server_id)
    return None


@router.post("/server-imports/external/template", status_code=201)
async def preview_public_template(
    request: TemplateImportRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    code = extract_template_code(request.template)
    source_payload = await fetch_public_template(code)
    try:
        source, external_id, name = template_source(source_payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Официальный шаблон не содержит структуру сервера") from exc
    definition, warnings = normalize_source_guild(source)
    item = new_import(user_id=user.id, source_kind="template", external_server_id=external_id)
    item.status = "ready"
    item.display_name = name
    item.definition = definition
    item.warnings = warnings
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return import_payload(item)


@router.post("/server-imports/external/oauth/start", status_code=201)
async def start_oauth_import(
    request: OAuthImportRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    if not oauth_configured():
        raise HTTPException(status_code=503, detail="Импорт по ID ещё не подключён администратором Miscord")
    state = secrets.token_urlsafe(32)
    item = new_import(user_id=user.id, source_kind="oauth", external_server_id=request.server_id)
    item.status = "awaiting_oauth"
    item.oauth_state_hash = state_hash(state)
    db.add(item)
    await db.commit()
    return {
        "id": item.id,
        "status": item.status,
        "authorize_url": oauth_authorize_url(state, _redirect_uri()),
        "expires_at": item.expires_at,
    }


@router.get("/server-imports/external/oauth/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: str = Query(min_length=2, max_length=2048),
    state: str = Query(min_length=16, max_length=256),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await db.scalar(select(ExternalServerImport).where(
        ExternalServerImport.oauth_state_hash == state_hash(state),
        ExternalServerImport.status == "awaiting_oauth",
    ))
    if item is None or item.expires_at <= utcnow():
        raise HTTPException(status_code=400, detail="OAuth-сессия недействительна или истекла")
    token = await exchange_oauth_code(code, _redirect_uri())
    guilds = await fetch_user_guilds(str(token["access_token"]))
    source = next((guild for guild in guilds if str(guild.get("id")) == item.external_server_id), None)
    if source is None or source.get("owner") is not True:
        item.status = "failed"
        item.warnings = ["Перенос полного сервера может подтвердить только его владелец"]
        item.oauth_state_hash = None
        await db.commit()
        raise HTTPException(status_code=403, detail="Владение исходным сервером не подтверждено")
    item.status = "awaiting_bot"
    item.display_name = str(source.get("name") or "Исходный сервер")[:100]
    item.oauth_state_hash = None
    item.oauth_expires_at = utcnow() + timedelta(seconds=max(60, int(token.get("expires_in") or 3600)))
    await db.commit()
    origin = urlparse(settings.SERVER_HOST)
    target_origin = f"{origin.scheme}://{origin.netloc}"
    message = json.dumps({"type": "miscord-server-import-oauth", "importId": item.id})
    html = f"""<!doctype html><meta charset=\"utf-8\"><title>Miscord</title>
    <body style=\"font-family:sans-serif;background:#1e1f22;color:#fff;padding:32px\">Доступ подтверждён. Окно можно закрыть.
    <script>if(window.opener){{window.opener.postMessage({message},{json.dumps(target_origin)});window.close();}}</script></body>"""
    return HTMLResponse(html, headers={"Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"})


@router.get("/server-imports/{import_id}")
async def get_import(
    import_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await owned_import(db, import_id, user.id)
    return import_payload(item, bot_install_url=_install_url(item))


@router.post("/server-imports/{import_id}/scan")
async def scan_import(
    import_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await owned_import(db, import_id, user.id)
    if item.source_kind != "oauth" or item.status not in {"awaiting_bot", "failed"} or not item.external_server_id:
        raise HTTPException(status_code=409, detail="Импорт пока нельзя сканировать")
    item.status = "scanning"
    await db.commit()
    try:
        snapshot = await fetch_guild_snapshot(item.external_server_id)
        definition, warnings = normalize_source_guild(snapshot)
        if not await leave_import_guild(item.external_server_id):
            warnings.append("Временного импортера не удалось удалить автоматически — удалите его в настройках исходного сервера")
        item.status = "ready"
        item.display_name = str(snapshot.get("name") or item.display_name or "Импортированный сервер")[:100]
        item.definition = definition
        item.warnings = warnings
        item.oauth_access_token = None
        item.oauth_refresh_token = None
        await db.commit()
        await db.refresh(item)
        return import_payload(item)
    except Exception:
        await db.rollback()
        item = await owned_import(db, import_id, user.id)
        item.status = "awaiting_bot"
        await db.commit()
        raise


@router.post("/server-imports/{import_id}/create-server", status_code=201)
async def create_imported_server(
    import_id: str,
    request: CreateImportedServerRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await locked_owned_import(db, import_id, user.id)
    if item.status == "completed" and item.created_server_id:
        return {"id": item.created_server_id, "status": "completed"}
    if item.status != "ready" or not isinstance(item.definition, dict):
        raise HTTPException(status_code=409, detail="Сначала завершите сканирование сервера")
    if any(entry.get("type") == "forum" for entry in item.definition.get("channels", [])) and not settings.FORUMS_ENABLED:
        raise HTTPException(status_code=409, detail="Сначала включите Forum-функции Miscord")
    item.status = "creating"
    try:
        server = await instantiate_template(
            db,
            definition=dict(item.definition),
            owner_id=user.id,
            name=request.name,
            description=request.description,
            icon=request.icon,
        )
        await db.flush()
        item.created_server_id = server.id
        item.status = "completed"
        await db.commit()
        return {"id": server.id, "name": server.name, "status": "completed", "warnings": list(item.warnings or [])}
    except Exception:
        await db.rollback()
        failed = await locked_owned_import(db, import_id, user.id)
        failed.status = "ready"
        await db.commit()
        raise


@router.delete("/server-imports/{import_id}", status_code=204)
async def cancel_import(
    import_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await owned_import(db, import_id, user.id)
    item.status = "cancelled"
    item.definition = None
    item.oauth_access_token = None
    item.oauth_refresh_token = None
    await db.commit()
