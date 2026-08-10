from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ExternalServerImport


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_import(*, user_id: int, source_kind: str, external_server_id: str | None = None) -> ExternalServerImport:
    return ExternalServerImport(
        id=str(uuid4()),
        user_id=user_id,
        provider="community_source",
        source_kind=source_kind,
        external_server_id=external_server_id,
        status="pending",
        warnings=[],
        expires_at=utcnow() + timedelta(hours=max(1, settings.EXTERNAL_IMPORT_TTL_HOURS)),
    )


async def owned_import(db: AsyncSession, import_id: str, user_id: int) -> ExternalServerImport:
    item = await db.scalar(select(ExternalServerImport).where(
        ExternalServerImport.id == import_id,
        ExternalServerImport.user_id == user_id,
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Импорт не найден")
    if item.expires_at <= utcnow() and item.status not in {"completed", "cancelled"}:
        item.status = "cancelled"
        await db.commit()
        raise HTTPException(status_code=410, detail="Срок действия импорта истёк")
    return item


async def locked_owned_import(db: AsyncSession, import_id: str, user_id: int) -> ExternalServerImport:
    item = await db.scalar(
        select(ExternalServerImport)
        .where(ExternalServerImport.id == import_id, ExternalServerImport.user_id == user_id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Импорт не найден")
    if item.expires_at <= utcnow() and item.status not in {"completed", "cancelled"}:
        raise HTTPException(status_code=410, detail="Срок действия импорта истёк")
    return item


def import_payload(item: ExternalServerImport, *, bot_install_url: str | None = None) -> dict[str, Any]:
    definition = item.definition if isinstance(item.definition, dict) else {}
    payload: dict[str, Any] = {
        "id": item.id,
        "provider": item.provider,
        "source_kind": item.source_kind,
        "external_server_id": item.external_server_id,
        "status": item.status,
        "name": item.display_name,
        "warnings": list(item.warnings or []),
        "created_server_id": item.created_server_id,
        "expires_at": item.expires_at,
        "preview": {
            "roles": list(definition.get("roles") or []),
            "categories": list(definition.get("categories") or []),
            "channels": list(definition.get("channels") or []),
            "overwrite_count": len(definition.get("overwrites") or []),
        } if definition else None,
    }
    if bot_install_url:
        payload["bot_install_url"] = bot_install_url
    return payload
