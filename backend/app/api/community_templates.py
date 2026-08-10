from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, get_member_permissions, has_permission
from app.db.database import get_db
from app.models import Channel, ServerTemplate, User
from app.schemas.server_template import CreateServerFromTemplate, ServerTemplateCreate, ServerTemplateUpdate
from app.services.server_templates import (
    SCHEMA_VERSION,
    builtin_template,
    builtin_templates,
    instantiate_template,
    snapshot_server,
    template_preview,
)
from app.services.realtime_events import enqueue_realtime_event

router = APIRouter()


def _require_feature() -> None:
    if not settings.SERVER_TEMPLATES_ENABLED:
        raise HTTPException(status_code=404, detail="Шаблоны серверов пока недоступны")


def _user_template_payload(item: ServerTemplate, *, include_definition: bool = False) -> dict:
    payload = {
        "id": f"user:{item.id}",
        "kind": "user",
        "name": item.name,
        "description": item.description,
        "icon": item.icon,
        "schema_version": item.schema_version,
        "source_server_id": item.source_server_id,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }
    if include_definition:
        payload["definition"] = item.definition
    return payload


async def _owned_template(db: AsyncSession, user_id: int, template_id: str) -> ServerTemplate:
    if not template_id.startswith("user:"):
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    try:
        numeric_id = int(template_id.split(":", 1)[1])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Шаблон не найден") from exc
    item = await db.scalar(select(ServerTemplate).where(ServerTemplate.id == numeric_id, ServerTemplate.creator_id == user_id))
    if not item:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    return item


async def _template_definition(db: AsyncSession, user: User, template_id: str) -> tuple[dict, dict]:
    if template_id.startswith("builtin:"):
        item = builtin_template(template_id)
        if not item:
            raise HTTPException(status_code=404, detail="Шаблон не найден")
        return item, item["definition"]
    item = await _owned_template(db, user.id, template_id)
    metadata = _user_template_payload(item)
    return metadata, dict(item.definition)


@router.get("/server-templates")
async def list_server_templates(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    custom = list((await db.execute(select(ServerTemplate).where(ServerTemplate.creator_id == user.id).order_by(ServerTemplate.updated_at.desc(), ServerTemplate.id.desc()))).scalars().all())
    builtins = [
        {
            "id": f"builtin:{item['id']}",
            "kind": "builtin",
            "name": item["name"],
            "description": item.get("description"),
            "icon": item.get("icon"),
            "schema_version": item.get("schema_version", SCHEMA_VERSION),
        }
        for item in builtin_templates()
    ]
    return {"builtins": builtins, "mine": [_user_template_payload(item) for item in custom]}


@router.post("/server-templates", status_code=201)
async def create_server_template(
    payload: ServerTemplateCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    server = await db.get(Channel, payload.source_server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Сервер не найден")
    permissions = await get_member_permissions(db, server.id, user.id, owner_id=server.owner_id)
    if user.id != server.owner_id and not has_permission(permissions, Permission.ADMINISTRATOR):
        raise HTTPException(status_code=403, detail="Шаблон создаёт владелец или администратор")
    definition = await snapshot_server(db, server)
    item = ServerTemplate(
        creator_id=user.id,
        source_server_id=server.id,
        name=payload.name.strip(),
        description=payload.description,
        icon=payload.icon,
        schema_version=SCHEMA_VERSION,
        definition=definition,
    )
    db.add(item)
    await db.flush()
    enqueue_realtime_event(
        db,
        event_type="SERVER_TEMPLATE_CREATED",
        data={"id": f"user:{item.id}", "name": item.name},
        topic="user",
        target_id=user.id,
    )
    await db.commit()
    await db.refresh(item)
    return _user_template_payload(item, include_definition=True)


@router.get("/server-templates/{template_id}")
async def get_server_template(
    template_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    metadata, definition = await _template_definition(db, user, template_id)
    metadata = dict(metadata)
    metadata["id"] = template_id
    metadata["definition"] = definition
    return metadata


@router.patch("/server-templates/{template_id}")
async def update_server_template(
    template_id: str,
    payload: ServerTemplateUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await _owned_template(db, user.id, template_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value.strip() if key == "name" and value else value)
    await db.commit()
    await db.refresh(item)
    return _user_template_payload(item, include_definition=True)


@router.delete("/server-templates/{template_id}", status_code=204)
async def delete_server_template(
    template_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await _owned_template(db, user.id, template_id)
    await db.delete(item)
    await db.commit()


@router.post("/server-templates/{template_id}/preview")
async def preview_server_template(
    template_id: str,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    metadata, definition = await _template_definition(db, user, template_id)
    return template_preview({
        "id": template_id,
        "name": metadata["name"],
        "description": metadata.get("description"),
        "schema_version": metadata.get("schema_version", SCHEMA_VERSION),
        "definition": definition,
    })


@router.post("/server-templates/{template_id}/create-server", status_code=201)
async def create_server_from_template(
    template_id: str,
    payload: CreateServerFromTemplate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    _metadata, definition = await _template_definition(db, user, template_id)
    if any(item.get("type") == "forum" for item in definition.get("channels", [])) and not settings.FORUMS_ENABLED:
        raise HTTPException(status_code=409, detail="Сначала включите Forum-функции")
    try:
        server = await instantiate_template(
            db,
            definition=definition,
            owner_id=user.id,
            name=payload.name,
            description=payload.description,
            icon=payload.icon,
        )
        await db.commit()
        await db.refresh(server)
    except Exception:
        await db.rollback()
        raise
    return {
        "id": server.id,
        "name": server.name,
        "description": server.description,
        "icon": server.icon,
        "owner_id": server.owner_id,
        "created_at": server.created_at,
    }
