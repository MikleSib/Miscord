from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
from typing import Dict, Optional

from app.db.database import AsyncSessionLocal
from app.models import User, VoiceChannel, VoiceChannelUser, ChannelMember
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.core.config import settings
from app.services.voice_session import (
    new_connection_id,
    is_active_connection,
    register_connection,
    pop_connection_if_current,
    find_user_channels,
    participant_payload,
)

# channel_id -> { user_id -> connection_info }
voice_connections: Dict[int, Dict[int, dict]] = {}


async def get_current_user_voice(websocket: WebSocket, token: str, db) -> Optional[User]:
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return None

    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token")
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        await websocket.close(code=4001, reason="User not found")
        return None
    return user


async def _broadcast_voice(
    channel_id: int,
    message: dict,
    *,
    exclude_user_id: Optional[int] = None,
) -> None:
    """Надёжная доставка участникам голосового канала (без Redis-коллизий с чатом)."""
    for uid, conn_info in list(voice_connections.get(channel_id, {}).items()):
        if exclude_user_id is not None and uid == exclude_user_id:
            continue
        ws = conn_info.get("websocket")
        if not ws:
            continue
        try:
            await ws.send_json(message)
        except Exception as exc:
            print(f"[Voice] broadcast to {uid} failed: {exc}")


async def _notify_server_members(server_id: Optional[int], message: dict, exclude_user_id: int) -> None:
    if not server_id:
        return
    async with AsyncSessionLocal() as db:
        members_query = await db.execute(
            select(ChannelMember).where(ChannelMember.channel_id == server_id)
        )
        for member in members_query.scalars().all():
            if member.user_id == exclude_user_id:
                continue
            try:
                await manager.send_personal_message(message, member.user_id)
            except Exception as exc:
                print(f"[Voice] server notify to {member.user_id} failed: {exc}")


async def _force_leave_other_channels(user: User, keep_channel_id: int, db) -> None:
    """
    Miscord: пользователь одновременно только в одном голосовом канале.
    При входе в новый — принудительно выходим из остальных.
    """
    other_channels = [cid for cid in find_user_channels(voice_connections, user.id) if cid != keep_channel_id]

    for other_channel_id in other_channels:
        info = voice_connections.get(other_channel_id, {}).get(user.id)
        if not info:
            continue
        # Инвалидируем сессию до close — finally старого WS не шлёт leave и не трёт presence.
        info["connection_id"] = f"moved:{info.get('connection_id')}"
        try:
            old_ws = info.get("websocket")
            if old_ws:
                await old_ws.close(code=4000, reason="Joined another voice channel")
        except Exception:
            pass

        channel_users = voice_connections.get(other_channel_id)
        if channel_users and channel_users.get(user.id) is info:
            channel_users.pop(user.id, None)
            if not channel_users:
                voice_connections.pop(other_channel_id, None)

        await _broadcast_voice(
            other_channel_id,
            {
                "type": "user_left_voice",
                "user_id": user.id,
                "voice_channel_id": other_channel_id,
            },
            exclude_user_id=user.id,
        )

        vc_query = await db.execute(
            select(VoiceChannel)
            .options(selectinload(VoiceChannel.channel))
            .where(VoiceChannel.id == other_channel_id)
        )
        vc = vc_query.scalar_one_or_none()
        server_id = vc.channel.id if vc and vc.channel else None
        await _notify_server_members(
            server_id,
            {
                "type": "voice_channel_leave",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "voice_channel_id": other_channel_id,
                "server_id": server_id,
                "display_name": user.display_name,
            },
            user.id,
        )

    await db.execute(
        delete(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.user_id == user.id,
                VoiceChannelUser.voice_channel_id != keep_channel_id,
            )
        )
    )
    await db.commit()


async def _replace_same_channel_connection(channel_id: int, user_id: int) -> None:
    existing = voice_connections.get(channel_id, {}).get(user_id)
    if not existing:
        return
    # Инвалидируем старую сессию: её finally не должен трогать новую.
    existing["connection_id"] = f"replaced:{existing.get('connection_id')}"
    try:
        old_ws = existing.get("websocket")
        if old_ws:
            await old_ws.close(code=4000, reason="Replaced by new voice connection")
    except Exception:
        pass
    voice_connections.get(channel_id, {}).pop(user_id, None)


async def websocket_voice_endpoint(
    websocket: WebSocket,
    channel_id: int,
    token: str,
):
    """WebSocket сигнализации голосового канала (mesh WebRTC, как Miscord)."""
    connection_id = new_connection_id()
    manager_channel_id = -channel_id
    user: Optional[User] = None
    joined_presence = False

    async with AsyncSessionLocal() as db:
        user = await get_current_user_voice(websocket, token, db)
        if not user:
            return

        voice_result = await db.execute(select(VoiceChannel).where(VoiceChannel.id == channel_id))
        voice_channel = voice_result.scalar_one_or_none()
        if not voice_channel:
            await websocket.close(code=4004, reason="Voice channel not found")
            return

        membership_result = await db.execute(
            select(ChannelMember).where(
                and_(
                    ChannelMember.channel_id == voice_channel.channel_id,
                    ChannelMember.user_id == user.id,
                )
            )
        )
        if not membership_result.scalar_one_or_none():
            await websocket.close(code=4003, reason="Server membership required")
            return

        await _force_leave_other_channels(user, channel_id, db)
        await _replace_same_channel_connection(channel_id, user.id)

        # Presence ephemeral: чистим свой stale-row перед проверкой лимита
        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.voice_channel_id == channel_id,
                    VoiceChannelUser.user_id == user.id,
                )
            )
        )
        await db.commit()

        active_users_count = await db.execute(
            select(VoiceChannelUser).where(VoiceChannelUser.voice_channel_id == channel_id)
        )
        if voice_channel.max_users and len(active_users_count.scalars().all()) >= voice_channel.max_users:
            await websocket.close(code=4005, reason="Voice channel is full")
            return

        await manager.connect(websocket, user.id, manager_channel_id)

        db.add(
            VoiceChannelUser(
                voice_channel_id=channel_id,
                user_id=user.id,
            )
        )
        await db.commit()
        joined_presence = True

        register_connection(
            voice_connections,
            channel_id,
            user.id,
            websocket=websocket,
            username=user.display_name or user.username,
            connection_id=connection_id,
        )

        print(
            f"[Voice] user={user.id} channel={channel_id} connection_id={connection_id[:8]} waiting join"
        )

        try:
            while True:
                data = await websocket.receive_json()
                if not is_active_connection(voice_connections, channel_id, user.id, connection_id):
                    break

                message_type = data.get("type")

                if message_type == "join":
                    await _handle_join(
                        websocket=websocket,
                        db=db,
                        user=user,
                        channel_id=channel_id,
                        voice_channel=voice_channel,
                        data=data,
                    )

                elif message_type == "offer":
                    await _relay_signal(channel_id, user.id, data, "offer", "offer")

                elif message_type == "answer":
                    await _relay_signal(channel_id, user.id, data, "answer", "answer")

                elif message_type == "ice_candidate":
                    await _relay_signal(channel_id, user.id, data, "ice_candidate", "candidate")

                elif message_type == "request_offer":
                    # Сторона с большим user_id не шлёт offer сама —
                    # просит меньший id прислать (иначе тишина на минуты).
                    await _relay_request_offer(channel_id, user.id, data.get("target_id"))

                elif message_type == "mute":
                    await _handle_mute(db, channel_id, user.id, data.get("is_muted", False))

                elif message_type == "deafen":
                    await _handle_deafen(db, channel_id, user.id, data.get("is_deafened", False))

                elif message_type == "speaking":
                    await _broadcast_voice(
                        channel_id,
                        {
                            "type": "user_speaking",
                            "user_id": user.id,
                            "is_speaking": bool(data.get("is_speaking", False)),
                        },
                        exclude_user_id=user.id,
                    )

                elif message_type == "screen_share_start":
                    info = voice_connections.get(channel_id, {}).get(user.id)
                    if info:
                        info["is_sharing_screen"] = True
                    await _broadcast_voice(
                        channel_id,
                        {
                            "type": "screen_share_started",
                            "user_id": user.id,
                            "username": user.display_name or user.username,
                            "display_name": user.display_name,
                        },
                        exclude_user_id=user.id,
                    )

                elif message_type == "screen_share_stop":
                    info = voice_connections.get(channel_id, {}).get(user.id)
                    if info:
                        info["is_sharing_screen"] = False
                    await _broadcast_voice(
                        channel_id,
                        {
                            "type": "screen_share_stopped",
                            "user_id": user.id,
                            "username": user.display_name or user.username,
                        },
                    )

                elif message_type == "screen_share_viewer_joined":
                    streamer_id = data.get("streamer_id")
                    if streamer_id is not None and int(streamer_id) != user.id:
                        target = voice_connections.get(channel_id, {}).get(int(streamer_id))
                        if target and target.get("websocket"):
                            try:
                                await target["websocket"].send_json(
                                    {
                                        "type": "screen_share_viewer_joined",
                                        "viewer_id": user.id,
                                        "viewer_username": user.display_name or user.username,
                                    }
                                )
                            except Exception as exc:
                                print(f"[Voice] screen_share_viewer_joined to {streamer_id} failed: {exc}")

                elif message_type == "pong":
                    pass

                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Неизвестный тип сообщения: {message_type}",
                        }
                    )

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            print(f"[Voice] WebSocket error user={user.id}: {exc}")
        finally:
            await _cleanup_voice_session(
                websocket=websocket,
                db=db,
                user=user,
                channel_id=channel_id,
                connection_id=connection_id,
                manager_channel_id=manager_channel_id,
                joined_presence=joined_presence,
            )


async def _relay_signal(
    channel_id: int,
    from_user_id: int,
    data: dict,
    out_type: str,
    payload_key: str,
) -> None:
    target_id = data.get("target_id")
    payload = data.get(payload_key)
    if target_id is None or payload is None:
        return
    target = voice_connections.get(channel_id, {}).get(target_id)
    if not target or not target.get("websocket"):
        return
    try:
        await target["websocket"].send_json(
            {
                "type": out_type,
                "from_id": from_user_id,
                payload_key: payload,
            }
        )
    except Exception as exc:
        print(f"[Voice] relay {out_type} to {target_id} failed: {exc}")


async def _relay_request_offer(
    channel_id: int,
    from_user_id: int,
    target_id: Optional[int],
) -> None:
    if target_id is None:
        return
    target = voice_connections.get(channel_id, {}).get(int(target_id))
    if not target or not target.get("websocket"):
        return
    try:
        await target["websocket"].send_json(
            {
                "type": "request_offer",
                "from_id": from_user_id,
            }
        )
    except Exception as exc:
        print(f"[Voice] relay request_offer to {target_id} failed: {exc}")


async def _handle_join(
    *,
    websocket: WebSocket,
    db,
    user: User,
    channel_id: int,
    voice_channel: VoiceChannel,
    data: dict,
) -> None:
    is_muted = bool(data.get("is_muted", False))
    is_deafened = bool(data.get("is_deafened", False))
    info = voice_connections.get(channel_id, {}).get(user.id)
    if info:
        info["is_muted"] = is_muted
        info["is_deafened"] = is_deafened

    participants = []
    for uid, conn_info in voice_connections.get(channel_id, {}).items():
        if uid == user.id:
            continue
        user_info_result = await db.execute(select(User).where(User.id == uid))
        user_info = user_info_result.scalar_one_or_none()
        participants.append(
            participant_payload(
                uid,
                conn_info,
                display_name=user_info.display_name if user_info else None,
                avatar_url=user_info.avatar_url if user_info else None,
            )
        )

    await websocket.send_json(
        {
            "type": "participants",
            "participants": participants,
            "ice_servers": settings.ICE_SERVERS,
            "self": {
                "user_id": user.id,
                "is_muted": is_muted,
                "is_deafened": is_deafened,
            },
        }
    )

    join_message = {
        "type": "user_joined_voice",
        "user_id": user.id,
        "username": user.display_name or user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "voice_channel_id": channel_id,
        "is_muted": is_muted,
        "is_deafened": is_deafened,
        "connection_id": info.get("connection_id") if info else None,
    }
    await _broadcast_voice(channel_id, join_message, exclude_user_id=user.id)

    vc_query = await db.execute(
        select(VoiceChannel)
        .options(selectinload(VoiceChannel.channel))
        .where(VoiceChannel.id == channel_id)
    )
    vc = vc_query.scalar_one_or_none()
    server_id = vc.channel.id if vc and vc.channel else None
    await _notify_server_members(
        server_id,
        {
            "type": "voice_channel_join",
            "user_id": user.id,
            "username": user.display_name or user.username,
            "voice_channel_id": channel_id,
            "voice_channel_name": voice_channel.name,
            "server_id": server_id,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        },
        user.id,
    )


async def _handle_mute(db, channel_id: int, user_id: int, is_muted: bool) -> None:
    info = voice_connections.get(channel_id, {}).get(user_id)
    if info:
        info["is_muted"] = is_muted

    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == channel_id,
                VoiceChannelUser.user_id == user_id,
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_muted = is_muted
        await db.commit()

    await _broadcast_voice(
        channel_id,
        {"type": "user_muted", "user_id": user_id, "is_muted": is_muted},
        exclude_user_id=user_id,
    )


async def _handle_deafen(db, channel_id: int, user_id: int, is_deafened: bool) -> None:
    info = voice_connections.get(channel_id, {}).get(user_id)
    if info:
        info["is_deafened"] = is_deafened

    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == channel_id,
                VoiceChannelUser.user_id == user_id,
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_deafened = is_deafened
        await db.commit()

    await _broadcast_voice(
        channel_id,
        {"type": "user_deafened", "user_id": user_id, "is_deafened": is_deafened},
        exclude_user_id=user_id,
    )


async def _cleanup_voice_session(
    *,
    websocket: WebSocket,
    db,
    user: User,
    channel_id: int,
    connection_id: str,
    manager_channel_id: int,
    joined_presence: bool,
) -> None:
    await manager.disconnect(websocket, user.id, manager_channel_id)

    # Если сессию уже заменили/перенесли — НЕ трогаем presence и НЕ шлём leave.
    still_current = is_active_connection(voice_connections, channel_id, user.id, connection_id)
    removed = pop_connection_if_current(voice_connections, channel_id, user.id, connection_id)

    if not still_current and not removed:
        print(
            f"[Voice] skip cleanup leave user={user.id} channel={channel_id} "
            f"connection_id={connection_id[:8]} (superseded)"
        )
        return

    if joined_presence:
        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.voice_channel_id == channel_id,
                    VoiceChannelUser.user_id == user.id,
                )
            )
        )
        await db.commit()

    leave_message = {
        "type": "user_left_voice",
        "user_id": user.id,
        "voice_channel_id": channel_id,
    }
    await _broadcast_voice(channel_id, leave_message, exclude_user_id=user.id)

    vc_leave_query = await db.execute(
        select(VoiceChannel)
        .options(selectinload(VoiceChannel.channel))
        .where(VoiceChannel.id == channel_id)
    )
    vc_obj = vc_leave_query.scalar_one_or_none()
    leave_server_id = vc_obj.channel.id if vc_obj and vc_obj.channel else None
    await _notify_server_members(
        leave_server_id,
        {
            "type": "voice_channel_leave",
            "user_id": user.id,
            "username": user.display_name or user.username,
            "voice_channel_id": channel_id,
            "server_id": leave_server_id,
            "display_name": user.display_name,
        },
        user.id,
    )
    print(f"[Voice] cleaned up user={user.id} channel={channel_id}")
