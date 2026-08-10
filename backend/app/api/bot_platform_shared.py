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
from app.services.event_webhook_delivery import queue_event_webhook
from app.services.miscord_serializers import miscord_user
from app.services.channel_access import user_can_access_text_channel
from app.services.message_serializer import serialize_channel_message
from app.websocket.connection_manager import manager

SUPPORTED_SCOPES = {"bot", "applications.commands"}
ALLOWED_MESSAGE_FLAGS = 4 | 4096


def _normalized_command_name(value: str, command_type: int = 1) -> str:
    cleaned = value.strip()
    return cleaned.lower() if command_type == 1 else cleaned


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
        "name_localizations": command.name_localizations,
        "description_localizations": command.description_localizations,
        "contexts": command.contexts,
        "integration_types": command.integration_types,
        "nsfw": bool(command.nsfw),
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
    command_type: int,
    *,
    ignore_id: int | None = None,
) -> None:
    query = select(BotCommand.id).where(
        BotCommand.application_id == application_id,
        BotCommand.server_id == server_id,
        BotCommand.name == name,
        BotCommand.command_type == command_type,
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
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
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

__all__ = [name for name in globals() if not name.startswith('__')]
