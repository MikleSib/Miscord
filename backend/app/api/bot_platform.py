from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.permissions import ALL_PERMISSIONS, Permission, get_member_permissions, require_permission
from app.db.database import get_db
from app.models.bot import BotApplication, BotInstall
from app.models.channel import Channel, ChannelMember, TextChannel
from app.models.message import Message
from app.models.server_role import MemberRole, Role
from app.models.user import User
from app.schemas.bot_install import BotInstallRequest, BotMessageCreate, BotMessageUpdate
from app.services.bot_security import BotPrincipal, get_current_bot
from app.services.channel_access import user_can_access_text_channel
from app.services.message_serializer import serialize_channel_message
from app.websocket.connection_manager import manager

router = APIRouter()
SUPPORTED_SCOPES = {"bot", "applications.commands"}
ALLOWED_MESSAGE_FLAGS = 4 | 4096


def _ensure_enabled() -> None:
    if not settings.BOT_PLATFORM_ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _parse_scopes(raw_scope: str) -> list[str]:
    scopes = list(dict.fromkeys(part for part in raw_scope.split() if part))
    if "bot" not in scopes:
        raise HTTPException(status_code=400, detail="The bot scope is required")
    unsupported = sorted(set(scopes) - SUPPORTED_SCOPES)
    if unsupported:
        raise HTTPException(status_code=400, detail=f"Unsupported scopes: {', '.join(unsupported)}")
    return scopes


def _validate_permissions(value: int) -> int:
    if value < 0 or value & ~int(ALL_PERMISSIONS):
        raise HTTPException(status_code=400, detail="Invalid permissions bitfield")
    return value


def _permission_names(value: int) -> list[str]:
    return [item.name for item in Permission if item and value & int(item)]


def _serialize_application(application: BotApplication) -> dict[str, Any]:
    return {
        "id": application.id,
        "client_id": application.client_id,
        "name": application.name,
        "description": application.description,
        "avatar_url": application.avatar_url,
        "status": application.status,
        "bot": {
            "id": application.bot_user.id,
            "username": application.bot_user.display_name or application.bot_user.username,
            "display_name": application.bot_user.display_name,
            "avatar_url": application.bot_user.avatar_url,
            "is_bot": True,
        },
    }


async def _application_by_client_id(db: AsyncSession, client_id: str) -> BotApplication:
    result = await db.execute(
        select(BotApplication)
        .options(selectinload(BotApplication.bot_user))
        .where(BotApplication.client_id == client_id, BotApplication.status == "active")
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="Bot application not found")
    return application


async def _load_message(db: AsyncSession, message_id: int) -> Message | None:
    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reply_to).selectinload(Message.author),
        )
        .where(Message.id == message_id)
    )
    return result.scalar_one_or_none()


def _validate_message_data(content: str | None, embeds: list[dict[str, Any]], flags: int) -> None:
    if flags & ~ALLOWED_MESSAGE_FLAGS:
        raise HTTPException(status_code=400, detail="Unsupported message flags")
    total = 0
    for embed in embeds:
        if not isinstance(embed, dict):
            raise HTTPException(status_code=400, detail="Each embed must be an object")
        total += sum(len(value) for value in embed.values() if isinstance(value, str))
        fields = embed.get("fields", [])
        if not isinstance(fields, list) or len(fields) > 25:
            raise HTTPException(status_code=400, detail="An embed can contain up to 25 fields")
        for field in fields:
            if isinstance(field, dict):
                total += sum(len(value) for value in field.values() if isinstance(value, str))
    if total > 6000:
        raise HTTPException(status_code=400, detail="Embed text exceeds 6000 characters")
    if not (content and content.strip()) and not embeds:
        raise HTTPException(status_code=400, detail="content or embeds is required")


def _external_message(serialized: dict[str, Any]) -> dict[str, Any]:
    result = dict(serialized)
    for key in ("id", "text_channel_id", "channelId", "author_id", "webhook_id", "reply_to_id"):
        if result.get(key) is not None:
            result[key] = str(result[key])
    if isinstance(result.get("author"), dict) and result["author"].get("id") is not None:
        result["author"] = dict(result["author"])
        result["author"]["id"] = str(result["author"]["id"])
    if isinstance(result.get("reply_to"), dict):
        result["reply_to"] = _external_message(result["reply_to"])
    return result


async def _require_bot_channel(
    db: AsyncSession,
    principal: BotPrincipal,
    text_channel_id: int,
    *,
    need_send: bool,
) -> TextChannel:
    result = await db.execute(select(TextChannel).where(TextChannel.id == text_channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    install_result = await db.execute(
        select(BotInstall.id).where(
            BotInstall.application_id == principal.application.id,
            BotInstall.server_id == channel.channel_id,
            BotInstall.status == "active",
        )
    )
    if install_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Bot is not installed on this server")
    if not await user_can_access_text_channel(db, principal.bot_user, channel, need_send=need_send):
        raise HTTPException(status_code=403, detail="Missing channel permissions")
    return channel


@router.get("/bot-apps/{application_id}/invite-link")
async def get_bot_invite_link(
    application_id: int,
    permissions: int = Query(default=int(Permission.VIEW_CHANNELS | Permission.SEND_MESSAGES), ge=0),
    scope: str = Query(default="bot applications.commands"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(scope)
    permissions = _validate_permissions(permissions)
    result = await db.execute(
        select(BotApplication).where(
            BotApplication.id == application_id,
            BotApplication.owner_id == current_user.id,
            BotApplication.status == "active",
        )
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="Bot application not found")
    query = urlencode({"client_id": application.client_id, "scope": " ".join(scopes), "permissions": permissions})
    return {"invite_url": f"{settings.SERVER_HOST.rstrip('/')}/bot/authorize?{query}"}


@router.get("/bot/oauth/authorize")
async def get_bot_authorization(
    client_id: str,
    scope: str = "bot",
    permissions: int = 0,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(scope)
    permissions = _validate_permissions(permissions)
    application = await _application_by_client_id(db, client_id)
    servers_result = await db.execute(
        select(Channel)
        .outerjoin(
            ChannelMember,
            (ChannelMember.channel_id == Channel.id) & (ChannelMember.user_id == current_user.id),
        )
        .where(or_(Channel.owner_id == current_user.id, ChannelMember.user_id == current_user.id))
        .order_by(Channel.name.asc())
    )
    servers = list(servers_result.scalars().unique().all())
    install_result = await db.execute(
        select(BotInstall.server_id).where(
            BotInstall.application_id == application.id,
            BotInstall.status == "active",
        )
    )
    installed_ids = set(install_result.scalars().all())
    eligible = []
    for server in servers:
        effective = await get_member_permissions(db, server.id, current_user.id, owner_id=server.owner_id)
        if current_user.id != server.owner_id and not effective & int(Permission.MANAGE_SERVER):
            continue
        eligible.append({
            "id": server.id,
            "name": server.name,
            "icon": server.icon,
            "already_installed": server.id in installed_ids,
            "can_grant": permissions & ~effective == 0,
        })
    return {
        "application": _serialize_application(application),
        "scopes": scopes,
        "permissions": permissions,
        "permission_names": _permission_names(permissions),
        "servers": eligible,
    }


@router.post("/bot/oauth/authorize")
async def authorize_bot_install(
    payload: BotInstallRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(payload.scope)
    requested = _validate_permissions(payload.permissions)
    application = await _application_by_client_id(db, payload.client_id)
    server_result = await db.execute(select(Channel).where(Channel.id == payload.server_id))
    server = server_result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    effective = await require_permission(db, server.id, current_user, Permission.MANAGE_SERVER)
    if requested & ~effective:
        raise HTTPException(status_code=403, detail="You cannot grant permissions you do not have")

    install_result = await db.execute(
        select(BotInstall)
        .where(BotInstall.application_id == application.id, BotInstall.server_id == server.id)
        .with_for_update()
    )
    install = install_result.scalar_one_or_none()
    role = await db.get(Role, install.role_id) if install and install.role_id else None
    if role is None:
        role_result = await db.execute(
            select(Role).where(
                Role.server_id == server.id,
                Role.managed_by_bot_application_id == application.id,
            )
        )
        role = role_result.scalar_one_or_none()
    if role is None:
        position_result = await db.execute(select(func.max(Role.position)).where(Role.server_id == server.id))
        role = Role(
            server_id=server.id,
            name=application.name,
            color="#5865f2",
            position=int(position_result.scalar() or 0) + 1,
            permissions=requested,
            is_default=False,
            managed_by_bot_application_id=application.id,
        )
        db.add(role)
        await db.flush()
    else:
        role.name = application.name
        role.permissions = requested

    membership_result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == server.id,
            ChannelMember.user_id == application.bot_user_id,
        )
    )
    if membership_result.scalar_one_or_none() is None:
        db.add(ChannelMember(channel_id=server.id, user_id=application.bot_user_id))
    member_role_result = await db.execute(
        select(MemberRole).where(MemberRole.role_id == role.id, MemberRole.user_id == application.bot_user_id)
    )
    if member_role_result.scalar_one_or_none() is None:
        db.add(MemberRole(server_id=server.id, role_id=role.id, user_id=application.bot_user_id))
    if install is None:
        install = BotInstall(application_id=application.id, server_id=server.id, installed_by_id=current_user.id)
        db.add(install)
    install.installed_by_id = current_user.id
    install.role_id = role.id
    install.scopes = scopes
    install.permissions = requested
    install.status = "active"
    await db.commit()
    return {
        "installed": True,
        "application": _serialize_application(application),
        "server": {"id": server.id, "name": server.name, "icon": server.icon},
        "permissions": requested,
        "scopes": scopes,
    }


@router.get("/servers/{server_id}/bots")
async def list_installed_bots(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    result = await db.execute(
        select(BotInstall)
        .options(selectinload(BotInstall.application).selectinload(BotApplication.bot_user))
        .where(BotInstall.server_id == server_id, BotInstall.status == "active")
        .order_by(BotInstall.installed_at.desc())
    )
    return {
        "bots": [{
            "application": _serialize_application(item.application),
            "permissions": int(item.permissions or 0),
            "permission_names": _permission_names(int(item.permissions or 0)),
            "scopes": item.scopes or [],
            "installed_at": item.installed_at,
            "installed_by_id": item.installed_by_id,
        } for item in result.scalars().all()]
    }


@router.delete("/servers/{server_id}/bots/{application_id}", status_code=204)
async def uninstall_bot(
    server_id: int,
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    result = await db.execute(
        select(BotInstall)
        .options(selectinload(BotInstall.application))
        .where(
            BotInstall.server_id == server_id,
            BotInstall.application_id == application_id,
            BotInstall.status == "active",
        )
        .with_for_update()
    )
    install = result.scalar_one_or_none()
    if not install:
        raise HTTPException(status_code=404, detail="Bot installation not found")
    bot_user_id = install.application.bot_user_id
    if install.role_id:
        await db.execute(delete(MemberRole).where(MemberRole.role_id == install.role_id))
        await db.execute(delete(Role).where(Role.id == install.role_id))
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id, MemberRole.user_id == bot_user_id))
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == server_id, ChannelMember.user_id == bot_user_id))
    install.role_id = None
    install.status = "revoked"
    await db.commit()


@router.post("/v1/channels/{text_channel_id}/messages")
async def create_bot_message(
    text_channel_id: int,
    payload: BotMessageCreate,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=True)
    _validate_message_data(payload.content, payload.embeds, payload.flags)
    if payload.client_nonce:
        existing_result = await db.execute(
            select(Message).where(Message.author_id == principal.bot_user.id, Message.client_nonce == payload.client_nonce)
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            if (existing.text_channel_id != text_channel_id or existing.content != payload.content or (existing.embeds or []) != payload.embeds or int(existing.flags or 0) != payload.flags):
                raise HTTPException(status_code=409, detail="client_nonce conflict")
            loaded = await _load_message(db, existing.id)
            return _external_message(serialize_channel_message(loaded))
    message = Message(
        author_id=principal.bot_user.id,
        text_channel_id=text_channel_id,
        content=payload.content.strip() if payload.content else None,
        embeds=payload.embeds,
        flags=payload.flags,
        client_nonce=payload.client_nonce,
    )
    db.add(message)
    await db.commit()
    loaded = await _load_message(db, message.id)
    serialized = serialize_channel_message(loaded)
    await manager.send_to_channel(text_channel_id, {"type": "new_message", "data": serialized})
    return _external_message(serialized)


@router.get("/v1/channels/{text_channel_id}/messages/{message_id}")
async def get_bot_message(
    text_channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=False)
    message = await _load_message(db, message_id)
    if not message or message.text_channel_id != text_channel_id or message.author_id != principal.bot_user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    return _external_message(serialize_channel_message(message))


@router.patch("/v1/channels/{text_channel_id}/messages/{message_id}")
async def update_bot_message(
    text_channel_id: int,
    message_id: int,
    payload: BotMessageUpdate,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=True)
    message = await _load_message(db, message_id)
    if not message or message.text_channel_id != text_channel_id or message.author_id != principal.bot_user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    content = payload.content if "content" in payload.model_fields_set else message.content
    embeds = payload.embeds if "embeds" in payload.model_fields_set else list(message.embeds or [])
    flags = payload.flags if "flags" in payload.model_fields_set else int(message.flags or 0)
    _validate_message_data(content, embeds or [], flags or 0)
    message.content = content.strip() if content else None
    message.embeds = embeds or []
    message.flags = flags or 0
    message.is_edited = True
    await db.commit()
    loaded = await _load_message(db, message.id)
    serialized = serialize_channel_message(loaded)
    await manager.send_to_channel(text_channel_id, {"type": "message_edited", "data": serialized})
    return _external_message(serialized)


@router.delete("/v1/channels/{text_channel_id}/messages/{message_id}", status_code=204)
async def delete_bot_message(
    text_channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=False)
    result = await db.execute(select(Message).where(
        Message.id == message_id,
        Message.text_channel_id == text_channel_id,
        Message.author_id == principal.bot_user.id,
    ))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(message)
    await db.commit()
    await manager.send_to_channel(text_channel_id, {
        "type": "message_deleted",
        "data": {"message_id": message_id, "text_channel_id": text_channel_id},
    })
