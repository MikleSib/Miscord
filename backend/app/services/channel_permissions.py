"""Расчёт прав на уровне канала с учётом переопределений (как в Discord)."""

from typing import Iterable, Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    ALL_PERMISSIONS,
    Permission,
    get_default_role,
    get_member_permissions,
    get_member_roles,
    has_permission,
)
from app.models import TextChannel, VoiceChannel
from app.models.channel_permission import (
    ChannelKind,
    ChannelPermissionOverwrite,
    OverwriteTargetType,
)

ChannelTypeLiteral = Literal["text", "voice"]


def _resolve_single_permission(
    base_permissions: int,
    permission: Permission,
    *,
    everyone_allow: int,
    everyone_deny: int,
    role_overwrites: list[tuple[int, int]],
    member_allow: int,
    member_deny: int,
) -> bool:
    """Discord-подобный расчёт одного бита права с учётом overwrites."""
    bit = int(permission)

    if member_allow & bit:
        return True
    if member_deny & bit:
        return False

    for allow, deny in role_overwrites:
        if allow & bit:
            return True
        if deny & bit:
            return False

    if everyone_allow & bit:
        return True
    if everyone_deny & bit:
        return False

    return bool(base_permissions & bit)


async def get_channel_overwrites(
    db: AsyncSession,
    channel_kind: ChannelTypeLiteral,
    channel_id: int,
) -> list[ChannelPermissionOverwrite]:
    kind = ChannelKind.TEXT if channel_kind == "text" else ChannelKind.VOICE
    result = await db.execute(
        select(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.channel_kind == kind,
            ChannelPermissionOverwrite.channel_id == channel_id,
        )
    )
    return list(result.scalars().all())


async def get_effective_channel_permissions(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    channel_kind: ChannelTypeLiteral,
    channel_id: int,
    *,
    owner_id: Optional[int] = None,
) -> int:
    """Итоговые права пользователя в конкретном канале."""
    base = await get_member_permissions(db, server_id, user_id, owner_id=owner_id)

    if base & int(Permission.ADMINISTRATOR):
        return ALL_PERMISSIONS

    overwrites = await get_channel_overwrites(db, channel_kind, channel_id)
    default_role = await get_default_role(db, server_id)
    member_roles = await get_member_roles(db, server_id, user_id)

    everyone_allow = 0
    everyone_deny = 0
    if default_role:
        for ow in overwrites:
            if ow.target_type == OverwriteTargetType.ROLE and ow.target_id == default_role.id:
                everyone_allow = int(ow.allow)
                everyone_deny = int(ow.deny)
                break

    role_overwrites: list[tuple[int, int]] = []
    role_ids = {role.id for role in member_roles}
    if default_role:
        role_ids.add(default_role.id)

    roles_by_id = {role.id: role for role in member_roles}
    if default_role:
        roles_by_id[default_role.id] = default_role

    for ow in overwrites:
        if ow.target_type != OverwriteTargetType.ROLE:
            continue
        if ow.target_id not in role_ids:
            continue
        if default_role and ow.target_id == default_role.id:
            continue
        role = roles_by_id.get(ow.target_id)
        position = int(role.position) if role else 0
        role_overwrites.append((int(ow.allow), int(ow.deny), position))

    role_overwrites.sort(key=lambda item: item[2], reverse=True)
    role_pairs = [(allow, deny) for allow, deny, _ in role_overwrites]

    member_allow = 0
    member_deny = 0
    for ow in overwrites:
        if ow.target_type == OverwriteTargetType.MEMBER and ow.target_id == user_id:
            member_allow = int(ow.allow)
            member_deny = int(ow.deny)
            break

    effective = 0
    for perm in Permission:
        if _resolve_single_permission(
            base,
            perm,
            everyone_allow=everyone_allow,
            everyone_deny=everyone_deny,
            role_overwrites=role_pairs,
            member_allow=member_allow,
            member_deny=member_deny,
        ):
            effective |= int(perm)

    if effective & int(Permission.ADMINISTRATOR):
        return ALL_PERMISSIONS

    return effective


async def can_view_channel(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    channel_kind: ChannelTypeLiteral,
    channel_id: int,
    *,
    owner_id: Optional[int] = None,
) -> bool:
    """Может ли пользователь видеть канал в списке."""
    if owner_id is not None and user_id == owner_id:
        return True

    server_perms = await get_member_permissions(db, server_id, user_id, owner_id=owner_id)
    if has_permission(server_perms, Permission.ADMINISTRATOR):
        return True
    if has_permission(server_perms, Permission.MANAGE_CHANNELS):
        return True

    channel_perms = await get_effective_channel_permissions(
        db,
        server_id,
        user_id,
        channel_kind,
        channel_id,
        owner_id=owner_id,
    )
    return has_permission(channel_perms, Permission.VIEW_CHANNELS)


async def filter_viewable_text_channels(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    channels: Iterable[TextChannel],
    *,
    owner_id: Optional[int] = None,
) -> list[TextChannel]:
    visible: list[TextChannel] = []
    for channel in channels:
        if channel.is_hidden:
            continue
        if await can_view_channel(
            db, server_id, user_id, "text", channel.id, owner_id=owner_id
        ):
            visible.append(channel)
    return visible


async def filter_viewable_voice_channels(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    channels: Iterable[VoiceChannel],
    *,
    owner_id: Optional[int] = None,
) -> list[VoiceChannel]:
    visible: list[VoiceChannel] = []
    for channel in channels:
        if await can_view_channel(
            db, server_id, user_id, "voice", channel.id, owner_id=owner_id
        ):
            visible.append(channel)
    return visible
