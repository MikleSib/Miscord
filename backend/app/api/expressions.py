from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user, get_db
from app.core.permissions import Permission, get_member_permissions, has_permission, require_membership, require_permission
from app.models import ChannelMember, PendingChatUpload, ServerExpression, User, VoiceChannel
from app.schemas.expressions import ExpressionCreate, ExpressionResponse, ExpressionUpdate
from app.services.realtime_events import enqueue_realtime_event
from app.services.media_ticket import create_soundboard_ticket
from app.services.voice_presence import voice_presence
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.expression_media import InvalidExpressionMedia, inspect_and_normalize_expression
from app.services.object_storage import ObjectStorageError, download_bytes


router = APIRouter()

QUOTAS = {"emoji": 100, "sticker": 30, "sound": 24}
MAX_BYTES = {"emoji": 256 * 1024, "sticker": 512 * 1024, "sound": 2 * 1024 * 1024}


def _validate_upload(payload: ExpressionCreate, upload: PendingChatUpload) -> None:
    if upload.size_bytes > MAX_BYTES[payload.kind]:
        raise HTTPException(status_code=413, detail="Файл превышает лимит для этого типа")
    if payload.kind in {"emoji", "sticker"} and not upload.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Для emoji и стикеров требуется изображение")
    if payload.kind == "sound":
        if not upload.content_type.startswith("audio/"):
            raise HTTPException(status_code=415, detail="Для звуковой панели требуется аудиофайл")


def _response(item: ServerExpression) -> ExpressionResponse:
    return ExpressionResponse.model_validate(item)


@router.get("/media/giphy/config")
async def giphy_config(current_user: User = Depends(get_current_active_user)) -> dict:
    if not settings.GIPHY_API_KEY:
        raise HTTPException(status_code=404, detail="GIF-каталог не настроен")
    return {
        "provider": "giphy",
        "api_key": settings.GIPHY_API_KEY,
        "rating": settings.GIPHY_RATING,
        "direct_client_requests": True,
        "attribution_required": True,
    }


@router.get("/servers/{server_id}/expressions", response_model=list[ExpressionResponse])
async def list_server_expressions(
    server_id: int,
    kind: str | None = Query(default=None, pattern="^(emoji|sticker|sound)$"),
    include_unavailable: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)
    query = select(ServerExpression).where(ServerExpression.server_id == server_id)
    if kind:
        query = query.where(ServerExpression.kind == kind)
    if not include_unavailable:
        query = query.where(ServerExpression.available.is_(True))
    rows = (await db.execute(query.order_by(ServerExpression.kind, ServerExpression.name))).scalars().all()
    return [_response(item) for item in rows]


@router.get("/users/@me/expressions", response_model=list[ExpressionResponse])
async def list_my_expressions(
    kind: str | None = Query(default=None, pattern="^(emoji|sticker|sound)$"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server_ids = select(ChannelMember.channel_id).where(ChannelMember.user_id == current_user.id)
    query = select(ServerExpression).where(
        ServerExpression.server_id.in_(server_ids),
        ServerExpression.available.is_(True),
    )
    if kind:
        query = query.where(ServerExpression.kind == kind)
    rows = (await db.execute(query.order_by(ServerExpression.server_id, ServerExpression.name))).scalars().all()
    return [_response(item) for item in rows]


@router.get("/expressions/{expression_id}", response_model=ExpressionResponse)
async def get_expression(
    expression_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ServerExpression, expression_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Медиаэлемент не найден")
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == item.server_id,
        ChannelMember.user_id == current_user.id,
    ))
    if membership is None:
        raise HTTPException(status_code=404, detail="Медиаэлемент не найден")
    return _response(item)


@router.get("/expressions/{expression_id}/audio")
async def get_expression_audio(
    expression_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Serve short Soundboard audio from the Miscord origin for Web Audio."""
    item = await db.scalar(select(ServerExpression).where(
        ServerExpression.id == expression_id,
        ServerExpression.kind == "sound",
        ServerExpression.available.is_(True),
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Звук не найден")
    await require_membership(db, int(item.server_id), current_user)
    try:
        content, stored_type = await download_bytes(item.storage_key)
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="Хранилище звуков временно недоступно") from exc
    return Response(
        content=content,
        media_type=item.content_type or stored_type or "audio/ogg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "Content-Length": str(len(content)),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/servers/{server_id}/expressions",
    response_model=ExpressionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_expression(
    server_id: int,
    payload: ExpressionCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.EXPRESSIONS_ENABLED:
        raise HTTPException(status_code=404, detail="Медианаборы отключены")
    server = await require_membership(db, server_id, current_user)
    permissions = await get_member_permissions(
        db, server_id, current_user.id, owner_id=int(server.owner_id),
    )
    may_create = has_permission(permissions, Permission.CREATE_GUILD_EXPRESSIONS)
    may_manage = has_permission(permissions, Permission.MANAGE_GUILD_EXPRESSIONS)
    if not may_create and not may_manage:
        raise HTTPException(status_code=403, detail="Нет права создавать медианаборы")
    upload = (await db.execute(select(PendingChatUpload).where(
        PendingChatUpload.id == payload.upload_id,
        PendingChatUpload.owner_id == current_user.id,
    ))).scalar_one_or_none()
    if upload is None:
        raise HTTPException(status_code=404, detail="Загрузка не найдена или истекла")
    _validate_upload(payload, upload)
    try:
        media_info = await inspect_and_normalize_expression(upload, payload.kind)
    except InvalidExpressionMedia as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    count = await db.scalar(select(func.count(ServerExpression.id)).where(
        ServerExpression.server_id == server_id,
        ServerExpression.kind == payload.kind,
        ServerExpression.available.is_(True),
    ))
    if int(count or 0) >= QUOTAS[payload.kind]:
        raise HTTPException(status_code=409, detail="Лимит медианабора исчерпан")
    if payload.kind == "emoji":
        subgroup_count = await db.scalar(select(func.count(ServerExpression.id)).where(
            ServerExpression.server_id == server_id,
            ServerExpression.kind == "emoji",
            ServerExpression.available.is_(True),
            ServerExpression.animated.is_(media_info.animated),
        ))
        if int(subgroup_count or 0) >= 50:
            label = "анимированных" if media_info.animated else "статичных"
            raise HTTPException(status_code=409, detail=f"Лимит {label} emoji исчерпан")
    item = ServerExpression(
        server_id=server_id,
        creator_id=current_user.id,
        kind=payload.kind,
        name=payload.name,
        description=payload.description,
        emoji=payload.emoji if payload.kind == "sound" else None,
        volume=payload.volume if payload.kind == "sound" else 100,
        storage_key=upload.storage_key,
        file_url=upload.file_url,
        content_type=upload.content_type,
        size_bytes=upload.size_bytes,
        width=media_info.width,
        height=media_info.height,
        duration_ms=media_info.duration_ms,
        animated=media_info.animated,
    )
    db.add(item)
    await db.delete(upload)
    try:
        await db.flush()
        enqueue_realtime_event(
            db,
            event_type="GUILD_EXPRESSIONS_UPDATE",
            data={"server_id": server_id, "expression": _response(item).model_dump(mode="json")},
            topic="server",
            target_id=server_id,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Элемент с таким именем уже существует") from exc
    await db.refresh(item)
    return _response(item)


async def _managed_expression(
    db: AsyncSession,
    server_id: int,
    expression_id: int,
    user: User,
) -> ServerExpression:
    await require_permission(db, server_id, user, Permission.MANAGE_GUILD_EXPRESSIONS)
    item = await db.scalar(select(ServerExpression).where(
        ServerExpression.id == expression_id,
        ServerExpression.server_id == server_id,
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Элемент медианабора не найден")
    return item


@router.patch("/servers/{server_id}/expressions/{expression_id}", response_model=ExpressionResponse)
async def update_expression(
    server_id: int,
    expression_id: int,
    payload: ExpressionUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _managed_expression(db, server_id, expression_id, current_user)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(item, field, value)
    enqueue_realtime_event(
        db,
        event_type="GUILD_EXPRESSIONS_UPDATE",
        data={"server_id": server_id, "expression": _response(item).model_dump(mode="json")},
        topic="server",
        target_id=server_id,
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Элемент с таким именем уже существует") from exc
    await db.refresh(item)
    return _response(item)


@router.delete("/servers/{server_id}/expressions/{expression_id}", status_code=204)
async def delete_expression(
    server_id: int,
    expression_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _managed_expression(db, server_id, expression_id, current_user)
    item.available = False
    item.deleted_at = datetime.now(timezone.utc)
    enqueue_realtime_event(
        db,
        event_type="GUILD_EXPRESSIONS_UPDATE",
        data={"server_id": server_id, "expression_id": expression_id, "deleted": True},
        topic="server",
        target_id=server_id,
    )
    await db.commit()


@router.post("/voice/{channel_id}/soundboard/{sound_id}/ticket")
async def create_soundboard_playback_ticket(
    channel_id: int,
    sound_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.SOUNDBOARD_ENABLED:
        raise HTTPException(status_code=404, detail="Звуковая панель отключена")
    channel = await db.get(VoiceChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Голосовой канал не найден")
    await require_membership(db, channel.channel_id, current_user)
    permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), current_user.id, "voice", channel_id,
    )
    if not has_permission(permissions, Permission.USE_SOUNDBOARD):
        raise HTTPException(status_code=403, detail="Нет права использовать звуковую панель")
    sound = await db.scalar(select(ServerExpression).where(
        ServerExpression.id == sound_id,
        ServerExpression.server_id == channel.channel_id,
        ServerExpression.kind == "sound",
        ServerExpression.available.is_(True),
    ))
    if sound is None:
        raise HTTPException(status_code=404, detail="Звук не найден")
    presence = await voice_presence.get_for_user(current_user.id)
    if not presence or int(presence.get("channel_id", 0)) != channel_id:
        raise HTTPException(status_code=409, detail="Сначала подключитесь к этому каналу")
    if channel.kind == "stage" and str(presence.get("stage_role", "audience")) == "audience":
        raise HTTPException(status_code=403, detail="Слушатели сцены не могут запускать звуки")
    redis = await voice_presence.client()
    accepted = await redis.set(f"soundboard:v1:cooldown:{current_user.id}", "1", ex=5, nx=True)
    if not accepted:
        raise HTTPException(status_code=429, detail="Подождите пять секунд перед следующим звуком")
    ticket, _ = create_soundboard_ticket(
        user_id=current_user.id,
        channel_id=channel_id,
        session_id=str(presence["session_id"]),
        sound_id=sound.id,
        duration_ms=int(sound.duration_ms or 5000),
    )
    return {"ticket": ticket, "sound": _response(sound), "expires_in": 20}
