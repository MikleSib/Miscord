"""API переопределений прав текстовых и голосовых каналов."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, miscord_permissions_to_legacy, require_permission
from app.db.database import get_db
from app.models import (
    Channel,
    ChannelMember,
    Role,
    TextChannel,
    User,
    VoiceChannel,
)
from app.models.channel_permission import (
    ChannelKind,
    ChannelPermissionOverwrite,
    OverwriteTargetType,
)
from app.schemas.channel_permissions import (
    ChannelPermissionCatalogItem,
    ChannelPermissionCatalogResponse,
    ChannelPermissionOverwriteListResponse,
    ChannelPermissionOverwriteResponse,
    ChannelPermissionOverwriteUpsert,
)
from app.services.channel_permissions import get_channel_overwrites

router = APIRouter()

CHANNEL_PERMISSION_GROUPS = [
    {"key": "general", "label": "Основные права канала"},
    {"key": "members", "label": "Права участников"},
    {"key": "text", "label": "Права текстового канала"},
    {"key": "voice", "label": "Права голосового канала"},
]

TEXT_CHANNEL_PERMISSIONS = [
    ChannelPermissionCatalogItem(
        key="VIEW_CHANNELS",
        value=int(Permission.VIEW_CHANNELS),
        label="Просмотр канала",
        description="Позволяет участникам просматривать этот канал по умолчанию. Отключение этого права для @everyone делает канал приватным.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_CHANNELS",
        value=int(Permission.MANAGE_CHANNELS),
        label="Управлять каналом",
        description="Позволяет участникам изменять название канала, описание и настройки, а также удалять канал.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_PERMISSIONS",
        value=int(Permission.MANAGE_PERMISSIONS),
        label="Управлять правами",
        description="Позволяет участникам изменять права этого канала.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_WEBHOOKS",
        value=int(Permission.MANAGE_WEBHOOKS),
        label="Управлять вебхуками",
        description="Позволяет участникам создавать, изменять и удалять вебхуки в этом канале.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="CREATE_INVITE",
        value=int(Permission.CREATE_INVITE),
        label="Создание приглашения",
        description="Позволяет участникам приглашать новых пользователей на сервер через прямую ссылку на приглашение в этот канал.",
        group="members",
    ),
    ChannelPermissionCatalogItem(
        key="SEND_MESSAGES",
        value=int(Permission.SEND_MESSAGES),
        label="Отправлять сообщения",
        description="Позволяет участникам отправлять сообщения в этом канале.",
        group="text",
    ),
    ChannelPermissionCatalogItem(
        key="SEND_MESSAGES_IN_THREADS",
        value=int(Permission.SEND_MESSAGES_IN_THREADS),
        label="Отправлять сообщения в ветках",
        description="Позволяет участникам отправлять сообщения в ветках этого канала.",
        group="text",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_MESSAGES",
        value=int(Permission.MANAGE_MESSAGES),
        label="Управлять сообщениями",
        description="Позволяет участникам удалять сообщения других участников в этом канале.",
        group="text",
    ),
    ChannelPermissionCatalogItem(
        key="PIN_MESSAGES",
        value=int(Permission.PIN_MESSAGES),
        label="Закреплять сообщения",
        description="Позволяет участникам закреплять и откреплять сообщения в этом канале.",
        group="text",
    ),
]

VOICE_CHANNEL_PERMISSIONS = [
    ChannelPermissionCatalogItem(
        key="VIEW_CHANNELS",
        value=int(Permission.VIEW_CHANNELS),
        label="Просмотр канала",
        description="Позволяет участникам просматривать этот канал по умолчанию. Отключение этого права для @everyone делает канал приватным.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_CHANNELS",
        value=int(Permission.MANAGE_CHANNELS),
        label="Управлять каналом",
        description="Позволяет участникам изменять название канала, описание и настройки, а также удалять канал.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="MANAGE_PERMISSIONS",
        value=int(Permission.MANAGE_PERMISSIONS),
        label="Управлять правами",
        description="Позволяет участникам изменять права этого канала.",
        group="general",
    ),
    ChannelPermissionCatalogItem(
        key="CREATE_INVITE",
        value=int(Permission.CREATE_INVITE),
        label="Создание приглашения",
        description="Позволяет участникам приглашать новых пользователей на сервер через прямую ссылку на приглашение в этот канал.",
        group="members",
    ),
    ChannelPermissionCatalogItem(
        key="MUTE_MEMBERS",
        value=int(Permission.MUTE_MEMBERS),
        label="Отключать микрофон",
        description="Позволяет заглушать участников в этом голосовом канале.",
        group="voice",
    ),
    ChannelPermissionCatalogItem(
        key="DEAFEN_MEMBERS",
        value=int(Permission.DEAFEN_MEMBERS),
        label="Отключать звук",
        description="Позволяет отключать участникам звук в этом голосовом канале.",
        group="voice",
    ),
    ChannelPermissionCatalogItem(
        key="MOVE_MEMBERS",
        value=int(Permission.MOVE_MEMBERS),
        label="Перемещать участников",
        description="Позволяет перемещать участников между голосовыми каналами.",
        group="voice",
    ),
]


async def _get_text_channel(db: AsyncSession, text_channel_id: int) -> TextChannel:
    result = await db.execute(select(TextChannel).where(TextChannel.id == text_channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Текстовый канал не найден")
    return channel


async def _get_voice_channel(db: AsyncSession, voice_channel_id: int) -> VoiceChannel:
    result = await db.execute(select(VoiceChannel).where(VoiceChannel.id == voice_channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Голосовой канал не найден")
    return channel


async def _serialize_overwrites(
    db: AsyncSession,
    server_id: int,
    overwrites: list[ChannelPermissionOverwrite],
) -> list[ChannelPermissionOverwriteResponse]:
    if not overwrites:
        return []

    role_ids = [
        ow.target_id for ow in overwrites if ow.target_type == OverwriteTargetType.ROLE
    ]
    member_ids = [
        ow.target_id for ow in overwrites if ow.target_type == OverwriteTargetType.MEMBER
    ]

    roles_by_id: dict[int, Role] = {}
    if role_ids:
        roles_result = await db.execute(select(Role).where(Role.id.in_(role_ids)))
        roles_by_id = {role.id: role for role in roles_result.scalars().all()}

    users_by_id: dict[int, User] = {}
    if member_ids:
        users_result = await db.execute(select(User).where(User.id.in_(member_ids)))
        users_by_id = {user.id: user for user in users_result.scalars().all()}

    serialized: list[ChannelPermissionOverwriteResponse] = []
    for ow in overwrites:
        if ow.target_type == OverwriteTargetType.ROLE:
            role = roles_by_id.get(ow.target_id)
            serialized.append(
                ChannelPermissionOverwriteResponse(
                    id=ow.id,
                    target_type="role",
                    target_id=ow.target_id,
                    allow=int(ow.allow),
                    deny=int(ow.deny),
                    target_name=role.name if role else "Неизвестная роль",
                    target_color=role.color if role else None,
                    is_default_role=bool(role.is_default) if role else False,
                )
            )
        else:
            user = users_by_id.get(ow.target_id)
            display_name = (
                user.display_name or user.username if user else f"Пользователь #{ow.target_id}"
            )
            serialized.append(
                ChannelPermissionOverwriteResponse(
                    id=ow.id,
                    target_type="member",
                    target_id=ow.target_id,
                    allow=int(ow.allow),
                    deny=int(ow.deny),
                    target_name=display_name,
                    target_avatar_url=user.avatar_url if user else None,
                )
            )

    serialized.sort(
        key=lambda item: (
            0 if item.target_type == "role" and item.is_default_role else 1,
            item.target_name.lower(),
        )
    )
    return serialized


async def _ensure_manage_channels(
    db: AsyncSession, server_id: int, user: User
) -> None:
    await require_permission(db, server_id, user, Permission.MANAGE_CHANNELS)


@router.get("/permissions/catalog/{channel_kind}", response_model=ChannelPermissionCatalogResponse)
async def get_channel_permission_catalog(channel_kind: Literal["text", "voice"]):
    if channel_kind == "text":
        return ChannelPermissionCatalogResponse(
            permissions=TEXT_CHANNEL_PERMISSIONS,
            groups=CHANNEL_PERMISSION_GROUPS,
        )
    return ChannelPermissionCatalogResponse(
        permissions=VOICE_CHANNEL_PERMISSIONS,
        groups=CHANNEL_PERMISSION_GROUPS,
    )


@router.get("/text/{text_channel_id}/permission-overwrites", response_model=ChannelPermissionOverwriteListResponse)
async def get_text_channel_overwrites(
    text_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await _get_text_channel(db, text_channel_id)
    await _ensure_manage_channels(db, text_channel.channel_id, current_user)

    overwrites = await get_channel_overwrites(db, "text", text_channel_id)
    return ChannelPermissionOverwriteListResponse(
        overwrites=await _serialize_overwrites(db, text_channel.channel_id, overwrites)
    )


@router.get("/voice/{voice_channel_id}/permission-overwrites", response_model=ChannelPermissionOverwriteListResponse)
async def get_voice_channel_overwrites(
    voice_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    voice_channel = await _get_voice_channel(db, voice_channel_id)
    await _ensure_manage_channels(db, voice_channel.channel_id, current_user)

    overwrites = await get_channel_overwrites(db, "voice", voice_channel_id)
    return ChannelPermissionOverwriteListResponse(
        overwrites=await _serialize_overwrites(db, voice_channel.channel_id, overwrites)
    )


async def _upsert_overwrite(
    db: AsyncSession,
    server_id: int,
    channel_kind: ChannelKind,
    channel_id: int,
    payload: ChannelPermissionOverwriteUpsert,
) -> ChannelPermissionOverwrite:
    if payload.target_type == "role":
        role_result = await db.execute(
            select(Role).where(Role.id == payload.target_id, Role.server_id == server_id)
        )
        if not role_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Роль не найдена")
    else:
        member_result = await db.execute(
            select(ChannelMember).where(
                ChannelMember.channel_id == server_id,
                ChannelMember.user_id == payload.target_id,
            )
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Участник не найден на этом сервере",
            )

    target_type = (
        OverwriteTargetType.ROLE if payload.target_type == "role" else OverwriteTargetType.MEMBER
    )

    result = await db.execute(
        select(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.channel_kind == channel_kind,
            ChannelPermissionOverwrite.channel_id == channel_id,
            ChannelPermissionOverwrite.target_type == target_type,
            ChannelPermissionOverwrite.target_id == payload.target_id,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.allow = payload.allow
        existing.deny = payload.deny
        existing.legacy_allow = miscord_permissions_to_legacy(payload.allow)
        existing.legacy_deny = miscord_permissions_to_legacy(payload.deny)
        overwrite = existing
    else:
        overwrite = ChannelPermissionOverwrite(
            server_id=server_id,
            channel_kind=channel_kind,
            channel_id=channel_id,
            target_type=target_type,
            target_id=payload.target_id,
            allow=payload.allow,
            deny=payload.deny,
            legacy_allow=miscord_permissions_to_legacy(payload.allow),
            legacy_deny=miscord_permissions_to_legacy(payload.deny),
        )
        db.add(overwrite)

    await db.commit()
    await db.refresh(overwrite)
    return overwrite


@router.put("/text/{text_channel_id}/permission-overwrites", response_model=ChannelPermissionOverwriteResponse)
async def upsert_text_channel_overwrite(
    text_channel_id: int,
    payload: ChannelPermissionOverwriteUpsert,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await _get_text_channel(db, text_channel_id)
    await _ensure_manage_channels(db, text_channel.channel_id, current_user)

    overwrite = await _upsert_overwrite(
        db,
        text_channel.channel_id,
        ChannelKind.TEXT,
        text_channel_id,
        payload,
    )
    serialized = await _serialize_overwrites(db, text_channel.channel_id, [overwrite])
    return serialized[0]


@router.put("/voice/{voice_channel_id}/permission-overwrites", response_model=ChannelPermissionOverwriteResponse)
async def upsert_voice_channel_overwrite(
    voice_channel_id: int,
    payload: ChannelPermissionOverwriteUpsert,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    voice_channel = await _get_voice_channel(db, voice_channel_id)
    await _ensure_manage_channels(db, voice_channel.channel_id, current_user)

    overwrite = await _upsert_overwrite(
        db,
        voice_channel.channel_id,
        ChannelKind.VOICE,
        voice_channel_id,
        payload,
    )
    serialized = await _serialize_overwrites(db, voice_channel.channel_id, [overwrite])
    return serialized[0]


@router.delete("/text/{text_channel_id}/permission-overwrites/{target_type}/{target_id}")
async def delete_text_channel_overwrite(
    text_channel_id: int,
    target_type: Literal["role", "member"],
    target_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await _get_text_channel(db, text_channel_id)
    await _ensure_manage_channels(db, text_channel.channel_id, current_user)

    enum_target = (
        OverwriteTargetType.ROLE if target_type == "role" else OverwriteTargetType.MEMBER
    )
    await db.execute(
        delete(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.channel_kind == ChannelKind.TEXT,
            ChannelPermissionOverwrite.channel_id == text_channel_id,
            ChannelPermissionOverwrite.target_type == enum_target,
            ChannelPermissionOverwrite.target_id == target_id,
        )
    )
    await db.commit()
    return {"detail": "Переопределение удалено"}


@router.delete("/voice/{voice_channel_id}/permission-overwrites/{target_type}/{target_id}")
async def delete_voice_channel_overwrite(
    voice_channel_id: int,
    target_type: Literal["role", "member"],
    target_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    voice_channel = await _get_voice_channel(db, voice_channel_id)
    await _ensure_manage_channels(db, voice_channel.channel_id, current_user)

    enum_target = (
        OverwriteTargetType.ROLE if target_type == "role" else OverwriteTargetType.MEMBER
    )
    await db.execute(
        delete(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.channel_kind == ChannelKind.VOICE,
            ChannelPermissionOverwrite.channel_id == voice_channel_id,
            ChannelPermissionOverwrite.target_type == enum_target,
            ChannelPermissionOverwrite.target_id == target_id,
        )
    )
    await db.commit()
    return {"detail": "Переопределение удалено"}
