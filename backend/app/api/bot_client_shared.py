from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, get_member_permissions, has_permission
from app.db.database import AsyncSessionLocal, get_db
from app.models import BotApplication, BotCommand, BotInstall, BotInteraction, BotUserInstall, ChannelMember, MemberRole, Message, TextChannel, User
from app.schemas.miscord import ClientInteractionCreate
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.bot_interactions import apply_initial_callback, aware, new_interaction, utcnow, wait_for_callback
from app.services.channel_access import require_text_channel_access
from app.services.miscord_serializers import miscord_command, miscord_message, miscord_user
from app.services.interaction_delivery import InteractionEndpointError, deliver_interaction_http




def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _command_supports(command: BotCommand, integration_type: int, context: int) -> bool:
    integration_types = command.integration_types if isinstance(command.integration_types, list) else [0]
    contexts = command.contexts if isinstance(command.contexts, list) else [0, 1, 2]
    if command.server_id is not None:
        integration_types = [0]
        contexts = [0]
    return integration_type in integration_types and context in contexts


def _focused_option(options: Any) -> dict[str, Any] | None:
    if not isinstance(options, list):
        return None
    for option in options:
        if not isinstance(option, dict):
            continue
        if option.get("focused") is True:
            return option
        nested = _focused_option(option.get("options"))
        if nested is not None:
            return nested
    return None


def _option_definition(options: Any, name: str) -> dict[str, Any] | None:
    if not isinstance(options, list):
        return None
    for option in options:
        if not isinstance(option, dict):
            continue
        if str(option.get("name") or "") == name:
            return option
        nested = _option_definition(option.get("options"), name)
        if nested is not None:
            return nested
    return None


async def _member_roles(db: AsyncSession, guild_id: int, user_id: int) -> list[int]:
    result = await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == guild_id,
        MemberRole.user_id == user_id,
    ))
    return [int(item) for item in result.scalars().all()]


def _custom_command_allowed(
    command: BotCommand,
    user_id: int,
    role_ids: list[int],
    guild_id: int,
    channel_id: int,
) -> bool:
    users = {int(item) for item in (command.allowed_user_ids or [])}
    roles = {int(item) for item in (command.allowed_role_ids or [])}
    if users or roles:
        return user_id in users or bool(roles & set(role_ids))
    definition = command.definition if isinstance(command.definition, dict) else {}
    guild_permissions = definition.get("guild_permissions")
    entries = guild_permissions.get(str(guild_id), []) if isinstance(guild_permissions, dict) else []
    if not isinstance(entries, list) or not entries:
        return True
    valid_entries = [item for item in entries if isinstance(item, dict)]
    user_entry = next((item for item in valid_entries if _as_int(item.get("type")) == 2 and str(item.get("id")) == str(user_id)), None)
    if user_entry is not None:
        return bool(user_entry.get("permission"))
    role_entries = [item for item in valid_entries if _as_int(item.get("type")) == 1 and _as_int(item.get("id")) in set(role_ids)]
    if any(bool(item.get("permission")) for item in role_entries):
        return True
    if role_entries:
        return False
    channel_entries = [item for item in valid_entries if _as_int(item.get("type")) == 3 and _as_int(item.get("id")) in {guild_id, channel_id}]
    if channel_entries:
        return any(bool(item.get("permission")) for item in channel_entries)
    everyone = next((item for item in valid_entries if _as_int(item.get("type")) == 1 and str(item.get("id")) == str(guild_id)), None)
    return bool(everyone.get("permission")) if everyone is not None else True


def _command_allowed(
    command: BotCommand,
    permissions: int,
    user_id: int,
    role_ids: list[int],
    guild_id: int,
    channel_id: int,
) -> bool:
    required = int(command.default_member_permissions or 0)
    if required and not has_permission(permissions, Permission.ADMINISTRATOR) and permissions & required != required:
        return False
    return _custom_command_allowed(command, user_id, role_ids, guild_id, channel_id)

__all__ = [name for name in globals() if not name.startswith('__')]
