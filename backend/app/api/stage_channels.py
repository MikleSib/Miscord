from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user, get_db
from app.core.permissions import Permission, has_permission, require_membership
from app.models import (
    Channel,
    StageInstance,
    StageSpeakerGrant,
    StageSpeakerRequest,
    User,
    VoiceChannel,
    VoiceChannelUser,
)
from app.schemas.stage import StageCreate, StageInstanceResponse, StageRoleUpdate, StageUpdate
from app.services.realtime_events import enqueue_realtime_event
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.voice_presence import voice_presence
from app.services.stage_runtime import disconnect_stage_participants, publish_stage_command


router = APIRouter()
MAX_STAGE_SPEAKERS = 8


async def _stage_for_channel(db: AsyncSession, channel_id: int) -> StageInstance:
    stage = await db.scalar(select(StageInstance).where(
        StageInstance.channel_id == channel_id,
        StageInstance.status == "active",
    ))
    if stage is None:
        raise HTTPException(status_code=404, detail="Активная сцена не найдена")
    return stage


async def _voice_channel(db: AsyncSession, channel_id: int) -> VoiceChannel:
    channel = await db.get(VoiceChannel, channel_id)
    if channel is None or channel.kind != "stage":
        raise HTTPException(status_code=404, detail="Stage-канал не найден")
    return channel


async def _require_channel_permission(
    db: AsyncSession, channel: VoiceChannel, user: User, permission: Permission,
) -> int:
    await require_membership(db, int(channel.channel_id), user)
    permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), user.id, "voice", channel.id,
    )
    if not has_permission(permissions, permission):
        raise HTTPException(status_code=403, detail="Недостаточно прав для этого действия")
    return permissions


async def _require_stage_moderator(
    db: AsyncSession, channel: VoiceChannel, stage: StageInstance, user: User,
) -> None:
    await require_membership(db, int(channel.channel_id), user)
    permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), user.id, "voice", channel.id,
    )
    if has_permission(permissions, Permission.MUTE_MEMBERS):
        return
    moderator = await db.scalar(select(StageSpeakerGrant.id).where(
        StageSpeakerGrant.stage_instance_id == stage.id,
        StageSpeakerGrant.user_id == user.id,
        StageSpeakerGrant.role == "moderator",
    ))
    if moderator is None:
        raise HTTPException(status_code=403, detail="Требуется роль модератора сцены")


async def _response(db: AsyncSession, stage: StageInstance) -> StageInstanceResponse:
    speakers = await db.scalar(select(func.count(StageSpeakerGrant.id)).where(
        StageSpeakerGrant.stage_instance_id == stage.id
    ))
    requests = await db.scalar(select(func.count(StageSpeakerRequest.id)).where(
        StageSpeakerRequest.stage_instance_id == stage.id,
        StageSpeakerRequest.status == "pending",
    ))
    return StageInstanceResponse(
        **{key: getattr(stage, key) for key in (
            "id", "channel_id", "server_id", "owner_id", "topic", "status",
            "request_to_speak_enabled", "started_at", "ended_at",
        )},
        speaker_count=int(speakers or 0),
        request_count=int(requests or 0),
    )


def _event_data(stage: StageInstance) -> dict:
    return {
        "id": stage.id,
        "channel_id": stage.channel_id,
        "server_id": stage.server_id,
        "topic": stage.topic,
        "status": stage.status,
        "request_to_speak_enabled": stage.request_to_speak_enabled,
    }


@router.post("/stage-instances", response_model=StageInstanceResponse, status_code=status.HTTP_201_CREATED)
async def create_stage(
    payload: StageCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.STAGE_CHANNELS_ENABLED:
        raise HTTPException(status_code=404, detail="Stage-каналы отключены")
    channel = await _voice_channel(db, payload.channel_id)
    await _require_channel_permission(db, channel, current_user, Permission.MANAGE_CHANNELS)
    existing = await db.scalar(select(StageInstance).where(
        StageInstance.channel_id == channel.id,
        StageInstance.status == "active",
    ))
    if existing:
        raise HTTPException(status_code=409, detail="Сцена уже запущена")
    stage = StageInstance(
        channel_id=channel.id,
        server_id=channel.channel_id,
        owner_id=current_user.id,
        topic=payload.topic.strip(),
        request_to_speak_enabled=payload.request_to_speak_enabled,
        empty_since=datetime.now(timezone.utc),
    )
    db.add(stage)
    await db.flush()
    db.add(StageSpeakerGrant(
        stage_instance_id=stage.id,
        user_id=current_user.id,
        granted_by_id=current_user.id,
        role="moderator",
    ))
    enqueue_realtime_event(
        db,
        event_type="STAGE_INSTANCE_CREATE",
        data=_event_data(stage),
        topic="server",
        target_id=channel.channel_id,
    )
    await db.commit()
    await db.refresh(stage)
    return await _response(db, stage)


@router.get("/stage-instances/{channel_id}", response_model=StageInstanceResponse)
async def get_stage(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    await require_membership(db, channel.channel_id, current_user)
    return await _response(db, await _stage_for_channel(db, channel_id))


@router.patch("/stage-instances/{channel_id}", response_model=StageInstanceResponse)
async def update_stage(
    channel_id: int,
    payload: StageUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    await _require_channel_permission(db, channel, current_user, Permission.MANAGE_CHANNELS)
    stage = await _stage_for_channel(db, channel_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(stage, field, value.strip() if field == "topic" and value else value)
    enqueue_realtime_event(
        db, event_type="STAGE_INSTANCE_UPDATE", data=_event_data(stage),
        topic="server", target_id=channel.channel_id,
    )
    await db.commit()
    await db.refresh(stage)
    return await _response(db, stage)


@router.delete("/stage-instances/{channel_id}", status_code=204)
async def end_stage(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    await _require_channel_permission(db, channel, current_user, Permission.MANAGE_CHANNELS)
    stage = await _stage_for_channel(db, channel_id)
    stage.status = "ended"
    stage.ended_at = datetime.now(timezone.utc)
    stage.empty_since = None
    await db.execute(delete(StageSpeakerRequest).where(StageSpeakerRequest.stage_instance_id == stage.id))
    await db.execute(delete(StageSpeakerGrant).where(StageSpeakerGrant.stage_instance_id == stage.id))
    await db.execute(delete(VoiceChannelUser).where(VoiceChannelUser.voice_channel_id == channel_id))
    enqueue_realtime_event(
        db, event_type="STAGE_INSTANCE_DELETE", data=_event_data(stage),
        topic="server", target_id=channel.channel_id,
    )
    await db.commit()
    await disconnect_stage_participants(channel_id)


@router.put("/stage-instances/{channel_id}/requests/@me", status_code=204)
async def request_to_speak(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    await require_membership(db, channel.channel_id, current_user)
    permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), current_user.id, "voice", channel.id,
    )
    if not has_permission(permissions, Permission.REQUEST_TO_SPEAK):
        raise HTTPException(status_code=403, detail="Нет права просить слово")
    stage = await _stage_for_channel(db, channel_id)
    if not stage.request_to_speak_enabled:
        raise HTTPException(status_code=409, detail="Запросы слова отключены")
    voice_user = await db.scalar(select(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == channel_id,
        VoiceChannelUser.user_id == current_user.id,
    ))
    if voice_user is None or voice_user.stage_role != "audience":
        raise HTTPException(status_code=409, detail="Просить слово может только слушатель этой сцены")
    request = await db.scalar(select(StageSpeakerRequest).where(
        StageSpeakerRequest.stage_instance_id == stage.id,
        StageSpeakerRequest.user_id == current_user.id,
    ))
    if request is None:
        request = StageSpeakerRequest(stage_instance_id=stage.id, user_id=current_user.id)
        db.add(request)
    else:
        request.status = "pending"
        request.requested_at = datetime.now(timezone.utc)
        request.resolved_at = None
    voice_user.requested_to_speak_at = request.requested_at
    enqueue_realtime_event(
        db, event_type="STAGE_REQUEST_CREATE",
        data={"channel_id": channel_id, "user_id": current_user.id, "requested_at": request.requested_at},
        topic="server", target_id=channel.channel_id,
    )
    await db.commit()


@router.delete("/stage-instances/{channel_id}/requests/@me", status_code=204)
async def cancel_request(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    await require_membership(db, channel.channel_id, current_user)
    stage = await _stage_for_channel(db, channel_id)
    await db.execute(delete(StageSpeakerRequest).where(
        StageSpeakerRequest.stage_instance_id == stage.id,
        StageSpeakerRequest.user_id == current_user.id,
    ))
    voice_user = await db.scalar(select(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == channel_id,
        VoiceChannelUser.user_id == current_user.id,
    ))
    if voice_user:
        voice_user.requested_to_speak_at = None
    enqueue_realtime_event(
        db, event_type="STAGE_REQUEST_DELETE", data={"channel_id": channel_id, "user_id": current_user.id},
        topic="server", target_id=channel.channel_id,
    )
    await db.commit()


@router.get("/stage-instances/{channel_id}/requests")
async def list_requests(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    stage = await _stage_for_channel(db, channel_id)
    await _require_stage_moderator(db, channel, stage, current_user)
    rows = (await db.execute(select(StageSpeakerRequest, User).join(
        User, User.id == StageSpeakerRequest.user_id
    ).where(
        StageSpeakerRequest.stage_instance_id == stage.id,
        StageSpeakerRequest.status == "pending",
    ).order_by(StageSpeakerRequest.requested_at))).all()
    return [{
        "user_id": item.user_id,
        "requested_at": item.requested_at,
        "user": {"id": user.id, "username": user.username, "display_name": user.display_name, "avatar_url": user.avatar_url},
    } for item, user in rows]


@router.put("/stage-instances/{channel_id}/participants/{user_id}", status_code=204)
async def set_stage_role(
    channel_id: int,
    user_id: int,
    payload: StageRoleUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await _voice_channel(db, channel_id)
    stage = await _stage_for_channel(db, channel_id)
    await _require_stage_moderator(db, channel, stage, current_user)
    target_user = await db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    await require_membership(db, channel.channel_id, target_user)
    if payload.role in {"speaker", "moderator"}:
        target_permissions = await get_effective_channel_permissions(
            db, int(channel.channel_id), user_id, "voice", channel_id,
        )
        if not has_permission(target_permissions, Permission.SPEAK):
            raise HTTPException(status_code=403, detail="Пользователь не может говорить в этом канале")
    grant = await db.scalar(select(StageSpeakerGrant).where(
        StageSpeakerGrant.stage_instance_id == stage.id,
        StageSpeakerGrant.user_id == user_id,
    ))
    if payload.role in {"speaker", "moderator"}:
        count = await db.scalar(select(func.count(StageSpeakerGrant.id)).where(
            StageSpeakerGrant.stage_instance_id == stage.id
        ))
        if grant is None and int(count or 0) >= MAX_STAGE_SPEAKERS:
            raise HTTPException(status_code=409, detail="На сцене уже восемь выступающих")
        if grant is None:
            grant = StageSpeakerGrant(
                stage_instance_id=stage.id, user_id=user_id,
                granted_by_id=current_user.id, role=payload.role,
            )
            db.add(grant)
        else:
            grant.role = payload.role
    elif grant is not None:
        await db.delete(grant)
    request = await db.scalar(select(StageSpeakerRequest).where(
        StageSpeakerRequest.stage_instance_id == stage.id,
        StageSpeakerRequest.user_id == user_id,
    ))
    if request:
        request.status = "accepted" if payload.role != "audience" else "declined"
        request.resolved_at = datetime.now(timezone.utc)
    voice_user = await db.scalar(select(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == channel_id,
        VoiceChannelUser.user_id == user_id,
    ))
    if voice_user:
        voice_user.stage_role = payload.role
        voice_user.stage_suppressed = payload.role == "audience"
        voice_user.requested_to_speak_at = None
    enqueue_realtime_event(
        db, event_type="STAGE_PARTICIPANT_UPDATE",
        data={"channel_id": channel_id, "user_id": user_id, "stage_role": payload.role, "stage_suppressed": payload.role == "audience"},
        topic="server", target_id=channel.channel_id,
    )
    await db.commit()
    presence = await voice_presence.get_for_user(user_id)
    if presence and int(presence.get("channel_id", 0)) == channel_id:
        can_speak = payload.role != "audience"
        await voice_presence.update(
            str(presence["session_id"]), stage_role=payload.role,
            stage_suppressed=not can_speak, can_speak=can_speak, can_stream=False,
        )
        await publish_stage_command(str(presence["session_id"]), stage_role=payload.role)
