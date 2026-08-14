from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.permissions import Permission, has_permission
from app.models import BotInstall, StageInstance, StageSpeakerGrant, VoiceChannel, VoiceChannelUser
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.bot_security import BotPrincipal
from app.services.bot_voice_sessions import registry as bot_voice_sessions
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.media_ticket import create_media_ticket
from app.services.miscord_serializers import miscord_voice_state
from app.services.voice_presence import voice_presence
from app.websocket.connection_manager import manager
from app.websocket.group_voice import broadcast_voice


def voice_gateway_endpoint() -> str:
    parsed = urlsplit(settings.SERVER_HOST.rstrip("/"))
    host = parsed.netloc or parsed.path
    return f"{host}/ws/voice-gateway?v=1"


def _integer(value: Any, default: Optional[int] = 0) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def handle_voice_state_update(
    db: AsyncSession,
    principal: BotPrincipal,
    state,
    data: dict[str, Any],
) -> None:
    guild_id = _integer(data.get("guild_id"), 0) or 0
    raw_channel_id = data.get("channel_id")
    channel_id = None if raw_channel_id is None else _integer(raw_channel_id, 0)
    if guild_id <= 0 or (channel_id is not None and channel_id <= 0):
        return

    installed = await db.scalar(select(BotInstall.id).where(
        BotInstall.application_id == principal.application.id,
        BotInstall.server_id == guild_id,
        BotInstall.status == "active",
    ))
    if installed is None:
        return
    if channel_id is None:
        await _disconnect(db, principal, state, guild_id, data)
        return

    voice_channel = await db.get(VoiceChannel, channel_id)
    if voice_channel is None or int(voice_channel.channel_id) != guild_id:
        return
    permissions = await get_effective_channel_permissions(
        db, guild_id, principal.bot_user.id, "voice", channel_id,
    )
    if not has_permission(permissions, Permission.VIEW_CHANNEL) or not has_permission(
        permissions, Permission.CONNECT,
    ):
        return

    existing = await bot_voice_sessions.get_for_application_guild(
        principal.application.id, guild_id,
    )
    if existing is not None and existing.channel_id == channel_id:
        await _update_existing(db, principal, state, existing, data)
        return

    active_count = await db.scalar(select(func.count(VoiceChannelUser.id)).where(
        VoiceChannelUser.voice_channel_id == channel_id,
        VoiceChannelUser.user_id != principal.bot_user.id,
    ))
    channel_limit = 100 if voice_channel.kind == "stage" else int(voice_channel.max_users or 0)
    if (
        channel_limit > 0
        and int(active_count or 0) >= channel_limit
        and not has_permission(permissions, Permission.MOVE_MEMBERS)
    ):
        return
    can_speak = has_permission(permissions, Permission.SPEAK)
    stage_role: str | None = None
    if voice_channel.kind == "stage":
        stage = await db.scalar(select(StageInstance).where(
            StageInstance.channel_id == channel_id,
            StageInstance.status == "active",
        ))
        if stage is None:
            return
        if has_permission(permissions, Permission.MUTE_MEMBERS):
            stage_role = "moderator"
        else:
            grant = await db.scalar(select(StageSpeakerGrant).where(
                StageSpeakerGrant.stage_instance_id == stage.id,
                StageSpeakerGrant.user_id == principal.bot_user.id,
            ))
            stage_role = grant.role if grant else "audience"
        if stage_role == "audience":
            can_speak = False

    await _connect(
        db, principal, state, guild_id, channel_id, data,
        can_speak=can_speak,
        stage_role=stage_role,
    )


async def _mark_stage_empty_if_needed(db: AsyncSession, channel_id: int) -> None:
    channel = await db.get(VoiceChannel, channel_id)
    if channel is None or channel.kind != "stage":
        return
    remaining = await db.scalar(select(func.count(VoiceChannelUser.id)).where(
        VoiceChannelUser.voice_channel_id == channel_id,
    ))
    if int(remaining or 0) == 0:
        stage = await db.scalar(select(StageInstance).where(
            StageInstance.channel_id == channel_id,
            StageInstance.status == "active",
        ))
        if stage is not None:
            stage.empty_since = datetime.now(timezone.utc)


async def _disconnect(
    db: AsyncSession,
    principal: BotPrincipal,
    state,
    guild_id: int,
    data: dict[str, Any],
) -> None:
    existing = await bot_voice_sessions.get_for_application_guild(
        principal.application.id, guild_id,
    )
    await bot_voice_sessions.revoke(principal.application.id, guild_id)
    if existing is not None:
        await voice_presence.remove(existing.session_id)
        client = await voice_presence.client()
        await client.publish("voice:v1:bot:revoke", existing.session_id)
        await db.execute(delete(VoiceChannelUser).where(
            VoiceChannelUser.voice_channel_id == existing.channel_id,
            VoiceChannelUser.user_id == principal.bot_user.id,
        ))
        await db.flush()
        await _mark_stage_empty_if_needed(db, existing.channel_id)
        await db.commit()
        await broadcast_voice(manager, existing.channel_id, {
            "type": "user_left_voice",
            "user_id": principal.bot_user.id,
            "voice_channel_id": existing.channel_id,
        })
    await bot_event_dispatcher.send_to_session(state, "VOICE_STATE_UPDATE", miscord_voice_state(
        guild_id=guild_id,
        channel_id=None,
        user_id=principal.bot_user.id,
        session_id=existing.session_id if existing else state.session_id,
        self_mute=bool(data.get("self_mute", False)),
        self_deaf=bool(data.get("self_deaf", False)),
    ))


async def _update_existing(
    db: AsyncSession,
    principal: BotPrincipal,
    state,
    existing,
    data: dict[str, Any],
) -> None:
    self_mute = bool(data.get("self_mute", False))
    self_deaf = bool(data.get("self_deaf", False))
    old_self_mute = existing.self_mute
    old_self_deaf = existing.self_deaf
    await bot_voice_sessions.update_state(
        existing.session_id, self_mute=self_mute, self_deaf=self_deaf,
    )
    await db.execute(update(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == existing.channel_id,
        VoiceChannelUser.user_id == principal.bot_user.id,
    ).values(is_muted=self_mute, is_deafened=self_deaf))
    await db.commit()
    await voice_presence.update(
        existing.session_id, is_muted=self_mute, is_deafened=self_deaf,
    )
    if old_self_mute != self_mute:
        await broadcast_voice(manager, existing.channel_id, {
            "type": "user_muted",
            "user_id": principal.bot_user.id,
            "is_muted": self_mute,
        })
    if old_self_deaf != self_deaf:
        await broadcast_voice(manager, existing.channel_id, {
            "type": "user_deafened",
            "user_id": principal.bot_user.id,
            "is_deafened": self_deaf,
        })
    state_payload = miscord_voice_state(
        guild_id=existing.guild_id,
        channel_id=existing.channel_id,
        user_id=principal.bot_user.id,
        session_id=existing.session_id,
        self_mute=self_mute,
        self_deaf=self_deaf,
    )
    await bot_event_dispatcher.send_to_session(state, "VOICE_STATE_UPDATE", state_payload)
    await bot_event_dispatcher.dispatch_voice_state_update(
        db,
        existing.guild_id,
        state_payload,
        exclude_application_id=principal.application.id,
    )


async def _connect(
    db: AsyncSession,
    principal: BotPrincipal,
    state,
    guild_id: int,
    channel_id: int,
    data: dict[str, Any],
    *,
    can_speak: bool,
    stage_role: str | None,
) -> None:
    replaced = await bot_voice_sessions.get_for_application_guild(
        principal.application.id, guild_id,
    )
    if replaced is not None:
        await voice_presence.remove(replaced.session_id)
        client = await voice_presence.client()
        await client.publish("voice:v1:bot:revoke", replaced.session_id)
    voice_session = await bot_voice_sessions.create(
        application_id=principal.application.id,
        bot_user_id=principal.bot_user.id,
        guild_id=guild_id,
        channel_id=channel_id,
        self_mute=bool(data.get("self_mute", False)),
        self_deaf=bool(data.get("self_deaf", False)),
    )
    room_epoch = await voice_presence.room_epoch(channel_id)
    await db.execute(delete(VoiceChannelUser).where(
        VoiceChannelUser.user_id == principal.bot_user.id,
    ))
    await db.flush()
    if replaced is not None and replaced.channel_id != channel_id:
        await _mark_stage_empty_if_needed(db, replaced.channel_id)
    db.add(VoiceChannelUser(
        voice_channel_id=channel_id,
        user_id=principal.bot_user.id,
        is_muted=voice_session.self_mute,
        is_deafened=voice_session.self_deaf,
        stage_role=stage_role or "audience",
        stage_suppressed=stage_role == "audience",
    ))
    if stage_role is not None:
        stage = await db.scalar(select(StageInstance).where(
            StageInstance.channel_id == channel_id,
            StageInstance.status == "active",
        ))
        if stage is not None:
            stage.empty_since = None
    await db.commit()
    username = principal.bot_user.display_name or principal.bot_user.username
    await voice_presence.register({
        "protocol_version": 1,
        "session_id": voice_session.session_id,
        "room_epoch": room_epoch,
        "channel_id": channel_id,
        "guild_id": guild_id,
        "user_id": principal.bot_user.id,
        "application_id": principal.application.id,
        "username": username,
        "display_name": principal.bot_user.display_name,
        "avatar_url": principal.bot_user.avatar_url,
        "is_muted": voice_session.self_mute,
        "is_deafened": voice_session.self_deaf,
        "is_sharing_screen": False,
        "is_bot": True,
        "stage_role": stage_role,
        "stage_suppressed": stage_role == "audience",
    })
    voice_token, _ = create_media_ticket(
        user_id=principal.bot_user.id,
        channel_id=channel_id,
        session_id=voice_session.session_id,
        room_epoch=room_epoch,
        username=username,
        display_name=principal.bot_user.display_name,
        avatar_url=principal.bot_user.avatar_url,
        is_bot=True,
        application_id=principal.application.id,
        guild_id=guild_id,
        self_mute=voice_session.self_mute,
        self_deaf=voice_session.self_deaf,
        can_speak=can_speak,
        stage_role=stage_role,
    )
    await broadcast_voice(manager, channel_id, {
        "type": "user_joined_voice",
        "user_id": principal.bot_user.id,
        "username": username,
        "display_name": principal.bot_user.display_name,
        "avatar_url": principal.bot_user.avatar_url,
        "voice_channel_id": channel_id,
        "is_muted": voice_session.self_mute,
        "is_deafened": voice_session.self_deaf,
        "is_bot": True,
        "connection_id": voice_session.session_id,
        "stage_role": stage_role,
        "stage_suppressed": stage_role == "audience",
    })
    await bot_event_dispatcher.send_to_session(state, "VOICE_STATE_UPDATE", miscord_voice_state(
        guild_id=guild_id,
        channel_id=channel_id,
        user_id=principal.bot_user.id,
        session_id=voice_session.session_id,
        self_mute=voice_session.self_mute,
        self_deaf=voice_session.self_deaf,
    ))
    await bot_event_dispatcher.send_to_session(state, "VOICE_SERVER_UPDATE", {
        "token": voice_token,
        "guild_id": str(guild_id),
        "endpoint": voice_gateway_endpoint(),
    })
