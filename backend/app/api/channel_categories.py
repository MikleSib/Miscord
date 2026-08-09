"""Категории каналов: группировка текстовых и голосовых каналов сервера."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.permissions import Permission, require_permission
from app.db.database import get_db
from app.models import Channel, ChannelCategory, ChannelMember, TextChannel, User, VoiceChannel
from app.schemas.channel_category import (
    ChannelCategoryCreate,
    ChannelCategoryResponse,
    ChannelCategoryUpdate,
    ChannelReorderRequest,
)
from app.services.audit_service import AuditAction, log_audit
from app.websocket.connection_manager import manager
from app.websocket.events import (
    CHANNEL_CATEGORY_CREATED,
    CHANNEL_CATEGORY_DELETED,
    CHANNEL_CATEGORY_UPDATED,
    CHANNEL_POSITIONS_UPDATED,
)

router = APIRouter()

MAX_CATEGORIES_PER_SERVER = 50


def _serialize(category: ChannelCategory) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "server_id": category.server_id,
        "position": int(category.position or 0),
    }


async def _notify_members(db: AsyncSession, server_id: int, payload: dict) -> None:
    """Рассылает событие всем участникам сервера."""
    result = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    )
    for row in result.fetchall():
        await manager.send_to_user(row[0], payload)


async def _get_server(db: AsyncSession, server_id: int) -> Channel:
    result = await db.execute(select(Channel).where(Channel.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сервер не найден")
    return server


async def _get_category(db: AsyncSession, category_id: int) -> ChannelCategory:
    result = await db.execute(
        select(ChannelCategory).where(ChannelCategory.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Категория не найдена")
    return category


@router.get("/{server_id}/categories", response_model=list[ChannelCategoryResponse])
async def list_categories(
    server_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_server(db, server_id)
    # Категории — часть структуры сервера, видеть их может любой участник
    await require_permission(db, server_id, current_user, Permission.VIEW_CHANNELS)

    result = await db.execute(
        select(ChannelCategory)
        .where(ChannelCategory.server_id == server_id)
        .order_by(ChannelCategory.position, ChannelCategory.id)
    )
    return [_serialize(category) for category in result.scalars().all()]


@router.post("/{server_id}/categories", response_model=ChannelCategoryResponse, status_code=201)
async def create_category(
    server_id: int,
    payload: ChannelCategoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.MANAGE_CHANNELS)

    count_result = await db.execute(
        select(func.count())
        .select_from(ChannelCategory)
        .where(ChannelCategory.server_id == server_id)
    )
    if int(count_result.scalar() or 0) >= MAX_CATEGORIES_PER_SERVER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Достигнут предел в {MAX_CATEGORIES_PER_SERVER} категорий",
        )

    if payload.position is None:
        max_position = await db.execute(
            select(func.coalesce(func.max(ChannelCategory.position), -1)).where(
                ChannelCategory.server_id == server_id
            )
        )
        position = int(max_position.scalar() or -1) + 1
    else:
        position = payload.position

    category = ChannelCategory(
        name=payload.name.strip(),
        server_id=server_id,
        position=position,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)

    data = _serialize(category)
    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.CHANNEL_CATEGORY_CREATE,
        target_type="channel_category",
        target_id=category.id,
        target_name=category.name,
    )
    await _notify_members(
        db,
        server_id,
        {"type": CHANNEL_CATEGORY_CREATED, "data": {"server_id": server_id, "category": data}},
    )
    return data


@router.patch("/categories/{category_id}", response_model=ChannelCategoryResponse)
async def update_category(
    category_id: int,
    payload: ChannelCategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    category = await _get_category(db, category_id)
    await require_permission(db, category.server_id, current_user, Permission.MANAGE_CHANNELS)

    if payload.name is not None:
        category.name = payload.name.strip()
    if payload.position is not None:
        category.position = payload.position

    await db.commit()
    await db.refresh(category)

    data = _serialize(category)
    await log_audit(
        db,
        category.server_id,
        current_user,
        AuditAction.CHANNEL_CATEGORY_UPDATE,
        target_type="channel_category",
        target_id=category.id,
        target_name=category.name,
    )
    await _notify_members(
        db,
        category.server_id,
        {"type": CHANNEL_CATEGORY_UPDATED, "data": {"server_id": category.server_id, "category": data}},
    )
    return data


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Каналы категории не удаляются — они возвращаются в общий список."""
    category = await _get_category(db, category_id)
    await require_permission(db, category.server_id, current_user, Permission.MANAGE_CHANNELS)

    server_id = category.server_id
    name = category.name
    await db.delete(category)
    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.CHANNEL_CATEGORY_DELETE,
        target_type="channel_category",
        target_id=category_id,
        target_name=name,
    )
    await _notify_members(
        db,
        server_id,
        {"type": CHANNEL_CATEGORY_DELETED, "data": {"server_id": server_id, "category_id": category_id}},
    )
    return {"message": "Категория удалена"}


@router.patch("/{server_id}/channels/reorder")
async def reorder_channels(
    server_id: int,
    payload: ChannelReorderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Клиент присылает итоговый порядок; применяем одной транзакцией."""
    await _get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.MANAGE_CHANNELS)

    category_ids = {
        item.category_id for item in payload.channels if item.category_id is not None
    }
    if category_ids:
        known = await db.execute(
            select(ChannelCategory.id).where(
                ChannelCategory.id.in_(category_ids),
                ChannelCategory.server_id == server_id,
            )
        )
        known_ids = {row[0] for row in known.all()}
        missing = category_ids - known_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Категория не принадлежит этому серверу",
            )

    text_ids = [item.id for item in payload.channels if item.type == "text"]
    voice_ids = [item.id for item in payload.channels if item.type == "voice"]

    text_map: dict[int, TextChannel] = {}
    if text_ids:
        result = await db.execute(
            select(TextChannel).where(
                TextChannel.id.in_(text_ids), TextChannel.channel_id == server_id
            )
        )
        text_map = {channel.id: channel for channel in result.scalars().all()}

    voice_map: dict[int, VoiceChannel] = {}
    if voice_ids:
        result = await db.execute(
            select(VoiceChannel).where(
                VoiceChannel.id.in_(voice_ids), VoiceChannel.channel_id == server_id
            )
        )
        voice_map = {channel.id: channel for channel in result.scalars().all()}

    updated: list[dict] = []
    for item in payload.channels:
        channel = text_map.get(item.id) if item.type == "text" else voice_map.get(item.id)
        if channel is None:
            # Чужой канал в списке — не трогаем и не раскрываем его существование
            continue
        channel.position = item.position
        channel.category_id = item.category_id
        updated.append(
            {
                "id": channel.id,
                "type": item.type,
                "position": item.position,
                "category_id": item.category_id,
            }
        )

    await db.commit()

    await _notify_members(
        db,
        server_id,
        {
            "type": CHANNEL_POSITIONS_UPDATED,
            "data": {"server_id": server_id, "channels": updated},
        },
    )
    return {"channels": updated}
