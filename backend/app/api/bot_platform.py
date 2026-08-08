from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.permissions import ALL_PERMISSIONS, Permission, miscord_permissions_to_legacy, get_member_permissions, require_permission
from app.db.database import get_db
from app.models.bot import BotApplication, BotInstall, BotCommand, BotInteraction
from app.models.channel import Channel, ChannelMember, TextChannel
from app.models.message import Message
from app.models.server_role import MemberRole, Role
from app.models.user import User
from app.schemas.bot_install import BotInstallRequest, BotMessageCreate, BotMessageUpdate
from app.schemas.bot import (
    BotCommandCreate,
    BotCommandReplace,
    BotCommandUpdate,
    BotCommandDispatchRequest,
    BotCommandDispatchResponse,
    BotInteractionCallbackRequest,
)
from app.services.bot_security import BotPrincipal, get_current_bot, verify_interaction_signature
from app.services.bot_links import build_bot_authorize_url
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.channel_access import user_can_access_text_channel
from app.services.message_serializer import serialize_channel_message
from app.websocket.connection_manager import manager

router = APIRouter()
SUPPORTED_SCOPES = {"bot", "applications.commands"}
ALLOWED_MESSAGE_FLAGS = 4 | 4096


def _normalized_command_name(value: str) -> str:
    return value.strip().lower()


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
    if value & int(Permission.ADMINISTRATOR):
        return int(Permission.ADMINISTRATOR)
    return value


def _resolve_invite_permissions(application: BotApplication, requested: int | None) -> int:
    if requested is not None:
        return _validate_permissions(requested)
    configured = (application.install_params or {}).get("permissions")
    try:
        resolved = int(configured)
    except (TypeError, ValueError):
        resolved = int(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)
    return _validate_permissions(resolved)


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


def _serialize_command(command: BotCommand) -> dict[str, Any]:
    return {
        "id": command.id,
        "application_id": command.application_id,
        "server_id": command.server_id,
        "name": command.name,
        "description": command.description,
        "type": command.command_type,
        "definition": command.definition or {},
        "default_member_permissions": command.default_member_permissions,
        "dm_permission": command.dm_permission,
        "allowed_user_ids": command.allowed_user_ids or [],
        "allowed_role_ids": command.allowed_role_ids or [],
        "version": command.version,
        "is_enabled": command.is_enabled,
        "created_at": command.created_at,
        "updated_at": command.updated_at,
    }


async def _ensure_command_name_available(
    db: AsyncSession,
    application_id: int,
    server_id: int | None,
    name: str,
    *,
    ignore_id: int | None = None,
) -> None:
    query = select(BotCommand.id).where(
        BotCommand.application_id == application_id,
        BotCommand.server_id == server_id,
        BotCommand.name == name,
    )
    if ignore_id is not None:
        query = query.where(BotCommand.id != ignore_id)
    result = await db.execute(query)
    if result.scalar_one_or_none() is not None:
        scope = "server-scoped" if server_id else "global"
        raise HTTPException(status_code=409, detail=f"A {scope} command with this name already exists")


def _coerce_interaction_number(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


async def _command_member_roles(
    db: AsyncSession,
    server_id: int,
    user_id: int,
) -> set[int]:
    result = await db.execute(
        select(MemberRole.role_id).where(
            MemberRole.server_id == server_id,
            MemberRole.user_id == user_id,
        )
    )
    return {int(item) for item in result.scalars().all()}


async def _resolve_command_for_interaction(
    db: AsyncSession,
    application: BotApplication,
    guild_id: int | None,
    name: str,
) -> BotCommand | None:
    normalized = name.lower()
    scope_query = [
        BotCommand.application_id == application.id,
        BotCommand.name == normalized,
        BotCommand.is_enabled.is_(True),
    ]
    if guild_id is not None:
        result = await db.execute(
            select(BotCommand).where(
                *scope_query,
                BotCommand.server_id == guild_id,
            )
        )
        command = result.scalar_one_or_none()
        if command:
            return command
    result = await db.execute(
        select(BotCommand).where(*scope_query, BotCommand.server_id.is_(None))
    )
    return result.scalar_one_or_none()


def _interaction_actor_user(payload: dict[str, Any]) -> tuple[int, Any] | tuple[None, None]:
    if isinstance(payload.get("member"), dict) and isinstance(payload["member"].get("user"), dict):
        user_data = payload["member"]["user"]
    else:
        user_data = payload.get("user")
    if not isinstance(user_data, dict):
        return None, None
    return _coerce_interaction_number(user_data.get("id")), user_data


def _build_default_command_response(command: BotCommand) -> dict[str, Any]:
    if isinstance(command.definition, dict):
        response = command.definition.get("response")
        if isinstance(response, dict):
            return response
    return {
        "type": 4,
        "data": {
            "content": f"/{command.name} executed.",
            "allowed_mentions": {"parse": []},
        },
    }


def _interaction_error(message: str, *, type_code: int = 4) -> dict[str, Any]:
    return {"type": type_code, "data": {"content": message, "flags": 64}}


async def _check_command_permissions(
    db: AsyncSession,
    command: BotCommand,
    actor_id: int,
    guild_id: int | None,
) -> None:
    allowed_users = set(_coerce_list_of_ints(command.allowed_user_ids))
    allowed_roles = set(_coerce_list_of_ints(command.allowed_role_ids))
    if not allowed_users and not allowed_roles:
        return
    if actor_id in allowed_users:
        return
    if not guild_id:
        raise HTTPException(status_code=403, detail="You do not have permission to run this command")
    role_ids = await _command_member_roles(db, guild_id, actor_id)
    if role_ids & allowed_roles:
        return
    raise HTTPException(status_code=403, detail="You do not have permission to run this command")


def _coerce_list_of_ints(values: Any) -> list[int]:
    if not isinstance(values, list):
        return []
    output: list[int] = []
    for item in values:
        number = _coerce_interaction_number(item)
        if number and number not in output:
            output.append(number)
    return output


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


async def _application_by_id(db: AsyncSession, application_id: int, owner_id: int | None = None) -> BotApplication:
    query = select(BotApplication).where(BotApplication.id == application_id, BotApplication.status == "active")
    if owner_id is not None:
        query = query.where(BotApplication.owner_id == owner_id)
    result = await db.execute(query.options(selectinload(BotApplication.bot_user)))
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


async def _load_or_create_interaction_record(
    db: AsyncSession,
    application: BotApplication,
    interaction_id: str,
    interaction_token: str,
) -> BotInteraction:
    result = await db.execute(
        select(BotInteraction).where(
            BotInteraction.interaction_id == interaction_id,
            BotInteraction.interaction_token == interaction_token,
        )
    )
    interaction = result.scalar_one_or_none()
    if interaction is not None:
        return interaction
    interaction = BotInteraction(
        application_id=application.id,
        interaction_id=interaction_id,
        interaction_token=interaction_token,
    )
    db.add(interaction)
    await db.flush()
    return interaction


def _serialize_interaction_response(interaction: BotInteraction) -> dict[str, Any] | None:
    if not interaction.responded or not interaction.response_payload or not interaction.response_type:
        return None
    payload = dict(interaction.response_payload)
    payload["type"] = int(interaction.response_type)
    return payload


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
    permissions: int | None = Query(default=None, ge=0),
    scope: str = Query(default="bot applications.commands"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(scope)
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

    permissions = _resolve_invite_permissions(application, permissions)

    return {
        "invite_url": build_bot_authorize_url(
            settings.SERVER_HOST,
            application.client_id,
            scopes,
            permissions,
        )
    }


@router.get("/bot/oauth/callback")
async def get_bot_oauth_callback(
    client_id: str,
    scope: str = "bot",
    permissions: int = 0,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _application_by_client_id(db, client_id)
    scopes = _parse_scopes(scope)
    permissions = _validate_permissions(permissions)
    return {
        "authorize_url": build_bot_authorize_url(
            settings.SERVER_HOST,
            client_id,
            scopes,
            permissions,
        )
    }


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
    was_existing = install is not None
    previous_permissions = int(install.permissions or 0) if was_existing else int(requested)
    previous_intents = int(install.intents or 0) if was_existing else int(payload.intents)
    previous_scopes = list(install.scopes) if was_existing and isinstance(install.scopes, list) else None
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
            legacy_permissions=miscord_permissions_to_legacy(requested),
            is_default=False,
            managed_by_bot_application_id=application.id,
        )
        db.add(role)
        await db.flush()
    else:
        role.name = application.name
        role.permissions = requested
        role.legacy_permissions = miscord_permissions_to_legacy(requested)

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
    install.intents = payload.intents
    install.installed_by_id = current_user.id
    install.role_id = role.id
    install.scopes = scopes
    install.permissions = requested
    install.legacy_permissions = miscord_permissions_to_legacy(requested)
    install.status = "active"
    await db.commit()
    if not was_existing:
        await bot_event_dispatcher.dispatch_install_create(
            application.id,
            server.id,
            permissions=requested,
            intents=payload.intents,
            scopes=scopes,
        )
    elif (
        previous_permissions != requested
        or previous_intents != payload.intents
        or previous_scopes != scopes
    ):
        await bot_event_dispatcher.dispatch_install_update(
            application.id,
            server.id,
            permissions=requested,
            intents=payload.intents,
            scopes=scopes,
        )
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
    await bot_event_dispatcher.dispatch_install_delete(
        application_id,
        server_id,
        reason="revoked",
    )


@router.get("/bot-apps/{application_id}/commands")
async def list_bot_commands(
    application_id: int,
    server_id: int | None = Query(default=None),
    include_disabled: bool = Query(default=False),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    query = select(BotCommand).where(BotCommand.application_id == application.id)
    if server_id is None:
        query = query.where(BotCommand.server_id.is_(None))
    else:
        query = query.where(BotCommand.server_id == server_id)
    if not include_disabled:
        query = query.where(BotCommand.is_enabled.is_(True))
    query = query.order_by(BotCommand.created_at.asc())
    result = await db.execute(query)
    return [_serialize_command(item) for item in result.scalars().all()]


@router.get("/bot-apps/{application_id}/commands/{command_id}")
async def get_bot_command(
    application_id: int,
    command_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(
        select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id)
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")
    return _serialize_command(command)


@router.post("/bot-apps/{application_id}/commands", response_model=list[dict[str, Any]])
async def create_bot_command(
    application_id: int,
    payload: BotCommandCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    server_id = payload.server_id
    if server_id is not None:
        await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    command_name = _normalized_command_name(payload.name)
    await _ensure_command_name_available(db, application.id, server_id, command_name)
    db.add(
        BotCommand(
            application_id=application.id,
            server_id=server_id,
            name=command_name,
            description=payload.description,
            command_type=payload.type,
            definition=payload.definition or {},
            default_member_permissions=payload.default_member_permissions,
            legacy_default_member_permissions=(
                miscord_permissions_to_legacy(payload.default_member_permissions)
                if payload.default_member_permissions is not None
                else None
            ),
            dm_permission=payload.dm_permission,
            allowed_user_ids=payload.allowed_user_ids,
            allowed_role_ids=payload.allowed_role_ids,
            is_enabled=True,
            version=1,
        )
    )
    await db.commit()
    return await list_bot_commands(application_id, server_id=server_id, current_user=current_user, db=db)


@router.put("/bot-apps/{application_id}/commands/{command_id}")
async def replace_bot_command(
    application_id: int,
    command_id: int,
    payload: BotCommandReplace,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id))
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    if payload.server_id != command.server_id:
        if payload.server_id is not None:
            await require_permission(db, payload.server_id, current_user, Permission.MANAGE_SERVER)
        if command.server_id is not None:
            await require_permission(db, command.server_id, current_user, Permission.MANAGE_SERVER)

    target_name = _normalized_command_name(payload.name)
    await _ensure_command_name_available(
        db,
        application.id,
        payload.server_id,
        target_name,
        ignore_id=command.id,
    )

    command.server_id = payload.server_id
    command.name = target_name
    command.description = payload.description
    command.command_type = payload.type
    previous_definition = command.definition if isinstance(command.definition, dict) else {}
    command.definition = {
        **(payload.definition or {}),
        **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
    }
    command.default_member_permissions = payload.default_member_permissions
    command.legacy_default_member_permissions = (
        miscord_permissions_to_legacy(payload.default_member_permissions)
        if payload.default_member_permissions is not None
        else None
    )
    command.dm_permission = payload.dm_permission
    command.allowed_user_ids = payload.allowed_user_ids
    command.allowed_role_ids = payload.allowed_role_ids
    command.is_enabled = True
    command.version += 1
    command.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_command(command)


@router.patch("/bot-apps/{application_id}/commands/{command_id}")
async def update_bot_command(
    application_id: int,
    command_id: int,
    payload: BotCommandUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id))
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")
    if "server_id" in payload.model_fields_set and payload.server_id != command.server_id:
        if payload.server_id is not None:
            await require_permission(db, payload.server_id, current_user, Permission.MANAGE_SERVER)
        if command.server_id is not None:
            await require_permission(db, command.server_id, current_user, Permission.MANAGE_SERVER)
        command.server_id = payload.server_id
    if payload.name is not None:
        target_name = _normalized_command_name(payload.name)
        await _ensure_command_name_available(
            db,
            application.id,
            command.server_id,
            target_name,
            ignore_id=command.id,
        )
        command.name = target_name
    if payload.description is not None:
        command.description = payload.description
    if payload.type is not None:
        command.command_type = payload.type
    if payload.definition is not None:
        previous_definition = command.definition if isinstance(command.definition, dict) else {}
        command.definition = {
            **payload.definition,
            **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
        }
    if "default_member_permissions" in payload.model_fields_set:
        command.default_member_permissions = payload.default_member_permissions
        command.legacy_default_member_permissions = (
            miscord_permissions_to_legacy(payload.default_member_permissions)
            if payload.default_member_permissions is not None
            else None
        )
    if payload.dm_permission is not None:
        command.dm_permission = payload.dm_permission
    if payload.allowed_user_ids is not None:
        command.allowed_user_ids = payload.allowed_user_ids
    if payload.allowed_role_ids is not None:
        command.allowed_role_ids = payload.allowed_role_ids
    if payload.is_enabled is not None:
        command.is_enabled = payload.is_enabled
    command.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_command(command)


@router.delete("/bot-apps/{application_id}/commands/{command_id}", status_code=204)
async def delete_bot_command(
    application_id: int,
    command_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand.id).where(BotCommand.application_id == application.id, BotCommand.id == command_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Command not found")
    await db.execute(delete(BotCommand).where(BotCommand.id == command_id))
    await db.commit()


@router.post("/bot-apps/{application_id}/commands/sync")
async def sync_bot_commands(
    application_id: int,
    server_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    if server_id is not None:
        await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    query = select(BotCommand).where(BotCommand.application_id == application.id)
    if server_id is None:
        query = query.where(BotCommand.server_id.is_(None))
    else:
        query = query.where(BotCommand.server_id == server_id)
    query = query.where(BotCommand.is_enabled.is_(True))
    result = await db.execute(query)
    commands = result.scalars().all()
    for command in commands:
        command.version += 1
    await db.commit()
    return {
        "application_id": application.id,
        "server_id": server_id,
        "synced_commands": len(commands),
        "commands": [_serialize_command(item) for item in commands],
    }


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
    await bot_event_dispatcher.dispatch_message_create(db, loaded)
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
    await bot_event_dispatcher.dispatch_message_update(db, loaded)
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
    await bot_event_dispatcher.dispatch_message_delete(db, message_id, text_channel_id)


@router.post("/v1/interactions/{interaction_id}/{interaction_token}/callback")
async def create_interaction_callback(
    interaction_id: str,
    interaction_token: str,
    payload: BotInteractionCallbackRequest,
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    result = await db.execute(
        select(BotInteraction).where(
            BotInteraction.interaction_id == interaction_id,
            BotInteraction.interaction_token == interaction_token,
        )
    )
    interaction = result.scalar_one_or_none()
    if interaction is None:
        raise HTTPException(status_code=404, detail="Interaction not found")
    if interaction.responded:
        return {"interaction_id": interaction_id, "status": "already_responded"}
    interaction.response_type = int(payload.type)
    interaction.response_payload = {"type": int(payload.type), "data": payload.data}
    interaction.responded = True
    interaction.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"interaction_id": interaction_id, "status": "ok"}


@router.post("/bot/apps/{application_id}/commands/dispatch", response_model=BotCommandDispatchResponse)
async def dispatch_bot_command(
    application_id: int,
    payload: BotCommandDispatchRequest,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    if principal.application.id != application_id:
        raise HTTPException(status_code=403, detail="Not allowed to dispatch for this application")
    if payload.type != 2:
        raise HTTPException(status_code=400, detail="Only application command dispatch is supported")

    interaction_name = _normalized_command_name(
        str(payload.data.get("name") if isinstance(payload.data, dict) else None or "").strip()
    )
    if not interaction_name:
        raise HTTPException(status_code=400, detail="command name is required")

    interaction_id = (payload.id or "").strip() or secrets.token_hex(8)
    interaction_token = (payload.token or "").strip() or secrets.token_urlsafe(18)

    interaction = await _load_or_create_interaction_record(
        db,
        principal.application,
        interaction_id,
        interaction_token,
    )
    interaction.guild_id = payload.guild_id
    interaction.channel_id = payload.channel_id

    actor_user_id = _coerce_interaction_number(
        payload.member.get("user", {}).get("id") if isinstance(payload.member, dict) and isinstance(payload.member.get("user"), dict) else None
    )
    if actor_user_id is None:
        actor_user_id = _coerce_interaction_number(
            payload.user.get("id") if isinstance(payload.user, dict) else None
        )
    interaction.author_user_id = actor_user_id

    command = await _resolve_command_for_interaction(db, principal.application, payload.guild_id, interaction_name)
    if not command:
        response = _interaction_error("Command not found.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.command_id = None
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return BotCommandDispatchResponse(
            interaction_id=interaction.interaction_id,
            interaction_token=interaction.interaction_token,
            application_id=principal.application.id,
            command_id=None,
            guild_id=payload.guild_id,
            channel_id=payload.channel_id,
            type=response["type"],
            data=response.get("data"),
        )

    if command.server_id is not None and actor_user_id is None:
        response = _interaction_error("Permission denied.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.command_id = command.id
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return BotCommandDispatchResponse(
            interaction_id=interaction.interaction_id,
            interaction_token=interaction.interaction_token,
            application_id=principal.application.id,
            command_id=command.id,
            guild_id=payload.guild_id,
            channel_id=payload.channel_id,
            type=response["type"],
            data=response.get("data"),
        )

    if command.server_id is not None and actor_user_id is not None:
        await _check_command_permissions(db, command, actor_user_id, payload.guild_id)

    command.definition = command.definition if isinstance(command.definition, dict) else {}
    response = _build_default_command_response(command)
    interaction.command_id = command.id
    interaction.responded = True
    interaction.response_type = int(response.get("type") or 4)
    interaction.response_payload = response
    interaction.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
    return BotCommandDispatchResponse(
        interaction_id=interaction.interaction_id,
        interaction_token=interaction.interaction_token,
        application_id=principal.application.id,
        command_id=command.id,
        guild_id=payload.guild_id,
        channel_id=payload.channel_id,
        type=response.get("type", 4),
        data=response.get("data"),
    )


@router.post("/v1/interactions")
async def create_interaction(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    raw_body = await request.body()
    signature = request.headers.get("X-Signature-Ed25519")
    timestamp = request.headers.get("X-Signature-Timestamp")
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid interaction body") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid interaction payload")

    application_id = str(payload.get("application_id") or "").strip()
    if not application_id:
        raise HTTPException(status_code=400, detail="application_id is required")
    application = await _application_by_client_id(db, application_id)
    verify_interaction_signature(application, signature, timestamp, raw_body)

    interaction_id = str(payload.get("id") or "")
    interaction_token = str(payload.get("token") or "")
    if not interaction_id or not interaction_token:
        raise HTTPException(status_code=400, detail="interaction id and token are required")

    interaction = await _load_or_create_interaction_record(db, application, interaction_id, interaction_token)
    interaction.guild_id = _coerce_interaction_number(payload.get("guild_id"))
    interaction.channel_id = _coerce_interaction_number(payload.get("channel_id"))
    actor_user_id, _ = _interaction_actor_user(payload)
    interaction.author_user_id = actor_user_id
    await db.commit()
    if interaction.responded:
        cached = _serialize_interaction_response(interaction)
        if cached:
            return cached

    interaction_type = _coerce_interaction_number(payload.get("type"))
    if interaction_type == 1:
        interaction.responded = True
        interaction.response_type = 1
        interaction.response_payload = {"type": 1}
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return {"type": 1}

    if interaction_type == 2:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        name = str(data.get("name") or "").strip().lower()
        if not name:
            response = _interaction_error("Command name is required.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
            return response
        guild_id = _coerce_interaction_number(payload.get("guild_id"))
        command = await _resolve_command_for_interaction(db, application, guild_id, name)
        if not command:
            response = _interaction_error("Command not found.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
            return response
        if command.server_id is not None and actor_user_id is not None:
            await _check_command_permissions(db, command, actor_user_id, guild_id)
        elif command.server_id is not None and not actor_user_id:
            response = _interaction_error("Permission denied.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            return response

        command.definition = command.definition if isinstance(command.definition, dict) else {}
        response = _build_default_command_response(command)
        interaction.command_id = command.id
        interaction.responded = True
        interaction.response_type = int(response.get("type") or 4)
        interaction.response_payload = response
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return response

    if interaction_type in (3, 5):
        response = _interaction_error("This interaction type is currently unsupported.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return response

    raise HTTPException(status_code=400, detail="Unsupported interaction type")
