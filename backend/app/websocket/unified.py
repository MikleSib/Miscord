from fastapi import WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
import json
import asyncio
from typing import Dict, Optional, Any
from datetime import timezone

from app.db.database import AsyncSessionLocal
from app.models import (
    User,
    Message,
    TextChannel,
    VoiceChannel,
    VoiceChannelUser,
    Attachment,
    Reaction,
    ChannelMember,
)
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.services import direct_message_service
from app.services.user_activity_service import user_activity_service
from app.services.text_channel_visibility import get_visible_text_channel
from app.services.slow_mode import check_slow_mode
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload
from app.services.mentions import notify_message_mentions
from app.services.message_notifications import notify_channel_message_activity
from app.services.voice_session import (
    new_connection_id,
    is_active_connection,
    pop_connection_if_current,
    register_connection,
    find_user_channels,
    participant_payload,
)
from app.core.config import settings
from app.models import DirectMessage, PendingChatUpload


async def _send_message_failure(
    user_id: int,
    client_nonce: Optional[str],
    code: str,
    message: str,
    retryable: bool = False,
    retry_after_seconds: Optional[float] = None,
) -> None:
    if not client_nonce:
        return
    await manager.send_to_user(user_id, {
        "type": "message_send_failed",
        "data": {
            "client_nonce": client_nonce,
            "code": code,
            "message": message,
            "retryable": retryable,
            "retry_after_seconds": retry_after_seconds,
        },
    })


voice_connections: Dict[int, Dict[int, dict]] = {}
VOICE_OPERATION_LOCK = asyncio.Lock()
VOICE_DEBUG_METRICS: Dict[str, int] = {
    "voice_reconnections": 0,
    "orphan_cleanup_count": 0,
    "cleanup_calls": 0,
}


def _extract_request_id(message_data: dict) -> Optional[str]:
    request_id = message_data.get("request_id")
    return str(request_id) if request_id is not None else None


def _normalize_voice_channel_id(message_data: dict) -> Optional[int]:
    raw_channel_id = (
        message_data.get("voice_channel_id")
        or message_data.get("channel_id")
        or message_data.get("channelId")
    )
    if raw_channel_id is None:
        return None
    try:
        return int(raw_channel_id)
    except (TypeError, ValueError):
        return None


def _normalize_target_user_id(message_data: dict) -> Optional[int]:
    raw_target_id = message_data.get("target_user_id")
    if raw_target_id is None:
        raw_target_id = message_data.get("target_id")
    if raw_target_id is None:
        return None
    try:
        return int(raw_target_id)
    except (TypeError, ValueError):
        return None


def _normalize_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return bool(value)


def _safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _structured_log(user: Optional[User], event: str, **fields: Any) -> None:
    payload = {
        "source": "unified_ws",
        "event": event,
    }
    if user:
        payload["user_id"] = user.id
        payload["username"] = getattr(user, "username", None)
    payload.update({k: v for k, v in fields.items() if v is not None})
    print(f"[UnifiedWS] {json.dumps(payload, ensure_ascii=False)}")


def _voice_debug_metrics() -> dict:
    return {
        "voice_reconnections": VOICE_DEBUG_METRICS["voice_reconnections"],
        "orphan_cleanup_count": VOICE_DEBUG_METRICS["orphan_cleanup_count"],
        "cleanup_calls": VOICE_DEBUG_METRICS["cleanup_calls"],
        "active_channels": len(voice_connections),
        "active_sessions": sum(
            len(users) for users in voice_connections.values()
        ),
    }


async def _broadcast_voice(
    channel_id: int,
    message: dict,
    exclude_user_id: Optional[int] = None,
) -> None:
    participants = list(voice_connections.get(channel_id, {}).items())
    for uid, info in participants:
        if exclude_user_id is not None and uid == exclude_user_id:
            continue
        ws = info.get("websocket")
        if not ws:
            continue
        try:
            await ws.send_text(json.dumps(message))
        except Exception as exc:
            print(
                f"[UnifiedWS] broadcast to user={uid} channel={channel_id} failed: {exc}"
            )


async def get_user_by_token_ws(token: str, db: AsyncSession) -> Optional[User]:
    try:
        payload = decode_access_token(token)
        if not payload:
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        return user if user and user.is_active else None
    except Exception as e:
        print(f"[UnifiedWS] auth error: {e}")
        return None


async def websocket_unified_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    db: Optional[AsyncSession] = None
    user: Optional[User] = None
    current_text_channels: set = set()
    current_voice_channel: Optional[int] = None
    current_voice_connection_id: Optional[str] = None
    ws_id = id(websocket)
    heartbeat_misses = 0

    try:
        db = AsyncSessionLocal()
        user = await get_user_by_token_ws(token, db)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id)
        await user_activity_service.update_user_activity(user.id, db)
        _structured_log(user, "connect", ws_id=ws_id)

        try:
            while True:
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                    if not isinstance(data, str):
                        continue

                    try:
                        message_data = json.loads(data)
                    except json.JSONDecodeError as e:
                        _structured_log(user, "invalid_json", ws_id=ws_id, error=str(e))
                        continue

                    if not isinstance(message_data, dict):
                        continue

                    msg_type = message_data.get("type")
                    request_id = _extract_request_id(message_data)
                    heartbeat_misses = 0
                    _structured_log(
                        user,
                        "message_received",
                        message_type=msg_type,
                        request_id=request_id,
                        ws_id=ws_id,
                    )

                    if msg_type == "ping":
                        await user_activity_service.heartbeat_user(user.id, db)
                        await websocket.send_text(json.dumps({"type": "pong"}))

                    elif msg_type == "chat_message":
                        await handle_chat_message(user, message_data, db, manager, current_text_channels)

                    elif msg_type == "typing":
                        await handle_typing(user, message_data, manager, current_text_channels)

                    elif msg_type == "join_voice":
                        current_voice_channel, current_voice_connection_id = await handle_join_voice(
                            user,
                            message_data,
                            db,
                            websocket,
                            ws_id,
                            manager,
                            voice_connections,
                            request_id=request_id,
                        )

                    elif msg_type == "leave_voice":
                        current_voice_channel, current_voice_connection_id = await handle_leave_voice(
                            user,
                            current_voice_channel,
                            current_voice_connection_id,
                            db,
                            manager,
                            voice_connections,
                        )

                    elif msg_type == "voice_offer":
                        await handle_voice_offer(user, message_data, manager)

                    elif msg_type == "voice_answer":
                        await handle_voice_answer(user, message_data, manager)

                    elif msg_type == "voice_ice_candidate":
                        await handle_voice_ice_candidate(user, message_data, manager)

                    elif msg_type == "voice_mute":
                        await handle_voice_mute(
                            user, message_data, current_voice_channel, db, manager, voice_connections
                        )

                    elif msg_type == "voice_deafen":
                        await handle_voice_deafen(
                            user, message_data, current_voice_channel, db, manager, voice_connections
                        )

                    elif msg_type == "voice_speaking":
                        await handle_voice_speaking(
                            user, message_data, current_voice_channel, manager
                        )

                    elif msg_type == "screen_share_start":
                        await handle_screen_share_start(
                            user, current_voice_channel, manager, voice_connections
                        )

                    elif msg_type == "screen_share_stop":
                        await handle_screen_share_stop(
                            user, current_voice_channel, manager, voice_connections
                        )

                    elif msg_type == "p2p-initiate-call":
                        await handle_p2p_initiate(user, message_data, manager)

                    elif msg_type == "p2p-accept-call":
                        await handle_p2p_accept(user, message_data, manager)

                    elif msg_type == "p2p-decline-call":
                        await handle_p2p_decline(user, message_data, manager)

                    elif msg_type == "p2p-hang-up":
                        await handle_p2p_hangup(user, message_data, manager)

                    elif msg_type == "p2p-offer":
                        await handle_p2p_offer(user, message_data, manager)

                    elif msg_type == "p2p-answer":
                        await handle_p2p_answer(user, message_data, manager)

                    elif msg_type == "p2p-ice-candidate":
                        await handle_p2p_ice_candidate(user, message_data, manager)

                    elif msg_type == "dm_message":
                        await handle_dm_message(user, message_data, db, manager)

                    elif msg_type == "pong":
                        await user_activity_service.heartbeat_user(user.id, db)

                    elif msg_type == "voice_debug":
                        await websocket.send_text(json.dumps({
                            "type": "voice_debug",
                            "data": _voice_debug_metrics(),
                        }))

                    else:
                        print(f"[UnifiedWS] unhandled message: {msg_type}")

                except asyncio.TimeoutError:
                    heartbeat_misses += 1
                    if heartbeat_misses >= 2:
                        _structured_log(
                            user,
                            "heartbeat_timeout",
                            ws_id=ws_id,
                            misses=heartbeat_misses,
                        )
                        break
                    await websocket.send_text(json.dumps({"type": "ping"}))

        except WebSocketDisconnect:
            _structured_log(user, "disconnect_socket", ws_id=ws_id)
        except Exception as e:
            _structured_log(user, "endpoint_error", error=str(e))
            import traceback
            traceback.print_exc()

    except Exception as e:
        _structured_log(user, "startup_error", error=str(e))
        import traceback
        traceback.print_exc()
    finally:
        if user and db:
            if current_voice_channel:
                await cleanup_voice_connection(
                    user,
                    current_voice_channel,
                    current_voice_connection_id,
                    db,
                    manager,
                    voice_connections,
                )

            await manager.disconnect(websocket, user.id)
            if not manager.is_user_connected(user.id):
                await user_activity_service.set_user_offline(user.id, db)
            _structured_log(user, "disconnect", ws_id=ws_id)

        if db:
            await db.close()


# ==================== CHAT ====================


async def handle_chat_message(
    user: User,
    message_data: dict,
    db: AsyncSession,
    manager,
    current_channels: set
):
    content = message_data.get("content", "").strip()
    text_channel_id = message_data.get("text_channel_id")
    attachments = list(message_data.get("attachments", []) or [])
    attachment_upload_ids = list(dict.fromkeys(str(item) for item in (message_data.get("attachment_upload_ids") or [])))
    client_nonce = message_data.get("client_nonce")
    reply_to_id = message_data.get("reply_to_id")

    if client_nonce is not None and (not isinstance(client_nonce, str) or len(client_nonce) > 64):
        return

    if not text_channel_id:
        await _send_message_failure(user.id, client_nonce, "invalid_channel", "Канал не указан")
        return

    text_channel = await get_visible_text_channel(db, text_channel_id)
    if not text_channel:
        await _send_message_failure(user.id, client_nonce, "access_denied", "Канал не найден или недоступен")
        return

    from app.services.channel_access import user_can_access_text_channel
    if not await user_can_access_text_channel(db, user, text_channel, need_send=True):
        await _send_message_failure(user.id, client_nonce, "access_denied", "Нет права отправлять сообщения в этот канал")
        await manager.send_to_user(user.id, {
            "type": "error",
            "message": "No access to channel",
            "text_channel_id": text_channel_id,
        })
        return

    if client_nonce:
        existing = (await db.execute(select(Message).where(
            Message.author_id == user.id,
            Message.client_nonce == client_nonce,
        ))).scalar_one_or_none()
        if existing is not None:
            if existing.text_channel_id != text_channel_id or (existing.content or "") != content:
                await _send_message_failure(user.id, client_nonce, "nonce_conflict", "client_nonce уже использован для другого сообщения")
                return
            await manager.send_to_user(user.id, {
                "type": "message_ack",
                "data": {"id": existing.id, "client_nonce": existing.client_nonce},
            })
            return

    pending_uploads = []
    if attachment_upload_ids:
        pending_uploads = (await db.execute(select(PendingChatUpload).where(
            PendingChatUpload.id.in_(attachment_upload_ids),
            PendingChatUpload.owner_id == user.id,
        ))).scalars().all()
        if len(pending_uploads) != len(attachment_upload_ids):
            await _send_message_failure(user.id, client_nonce, "upload_expired", "Загрузка файла не найдена или истекла", True)
            return
        attachments.extend(item.file_url for item in pending_uploads)

    if not content and not attachments:
        await _send_message_failure(user.id, client_nonce, "empty_message", "Сообщение не содержит текста или файлов")
        return
    if len(content) > 5000 or len(attachments) > 10:
        await _send_message_failure(user.id, client_nonce, "validation_error", "Превышен лимит текста или вложений")
        return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"channel:{text_channel_id}",
        content=content,
    )
    if not allowed:
        await _send_message_failure(user.id, client_nonce, "rate_limited", limit_message, True, retry_after)
        await manager.send_to_user(
            user.id,
            rate_limit_payload(
                message=limit_message,
                retry_after_seconds=retry_after,
                scope="channel",
                text_channel_id=text_channel_id,
            ),
        )
        return

    allowed, retry_after = await check_slow_mode(db, text_channel, user)
    if not allowed:
        await _send_message_failure(user.id, client_nonce, "slow_mode", "В канале включен медленный режим", True, retry_after)
        await manager.send_to_user(user.id, {
            "type": "slow_mode",
            "text_channel_id": text_channel_id,
            "retry_after_seconds": retry_after,
        })
        return

    db_message = Message(
        client_nonce=client_nonce,
        content=content if content else None,
        author_id=user.id,
        text_channel_id=text_channel_id,
        reply_to_id=reply_to_id if reply_to_id else None,
    )

    pending_by_url = {item.file_url: item for item in pending_uploads}
    for url in attachments:
        pending = pending_by_url.get(url)
        attachment = Attachment(
            file_url=url,
            original_filename=pending.original_filename if pending else None,
            content_type=pending.content_type if pending else None,
            size_bytes=pending.size_bytes if pending else None,
            storage_key=pending.storage_key if pending else None,
        )
        db_message.attachments.append(attachment)

    db.add(db_message)
    for pending in pending_uploads:
        await db.delete(pending)
    await db.commit()
    await db.refresh(db_message)

    message_result = await db.execute(
        select(Message)
        .where(Message.id == db_message.id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(Reaction.user),
            selectinload(Message.reply_to).selectinload(Message.author),
        )
    )
    full_message = message_result.scalar_one()

    message_dict = {
        "id": full_message.id,
        "client_nonce": full_message.client_nonce,
        "content": full_message.content,
        "channelId": full_message.text_channel_id,
        "timestamp": full_message.timestamp.replace(tzinfo=timezone.utc).isoformat(),
        "is_edited": full_message.is_edited,
        "is_deleted": full_message.is_deleted,
        "author": {
            "id": full_message.author.id,
            "username": full_message.author.display_name or full_message.author.username,
            "email": "",
            "display_name": full_message.author.display_name,
            "avatar_url": full_message.author.avatar_url,
        },
        "attachments": [
            {
                "id": att.id,
                "file_url": att.file_url,
                "filename": getattr(att, "filename", None),
            } for att in full_message.attachments
        ],
        "reactions": [],
        "reply_to": None
        if not full_message.reply_to else {
            "id": full_message.reply_to.id,
            "content": "Message is deleted" if full_message.reply_to.is_deleted else full_message.reply_to.content,
            "is_deleted": full_message.reply_to.is_deleted,
            "author": {
                "id": full_message.reply_to.webhook_id or full_message.reply_to.author.id,
                "username": full_message.reply_to.webhook_name if full_message.reply_to.webhook_id else (full_message.reply_to.author.display_name or full_message.reply_to.author.username),
                "email": "",
                "display_name": None if full_message.reply_to.webhook_id else full_message.reply_to.author.display_name,
                "avatar_url": full_message.reply_to.webhook_avatar_url if full_message.reply_to.webhook_id else getattr(full_message.reply_to.author, "avatar_url", None),
                "is_webhook": full_message.reply_to.webhook_id is not None,
            },
        }
    }

    await manager.send_to_channel(text_channel_id, {
        "type": "new_message",
        "data": message_dict,
    })

    await notify_message_mentions(
        db,
        manager,
        content=content,
        author=user,
        text_channel=text_channel,
        message_id=full_message.id,
    )
    await notify_channel_message_activity(
        db,
        manager,
        content=content,
        author=user,
        text_channel=text_channel,
        message_id=full_message.id,
    )
    await user_activity_service.update_user_activity(user.id, db)


async def handle_typing(user: User, message_data: dict, manager, current_channels: set):
    text_channel_id = message_data.get("text_channel_id")
    if text_channel_id:
        await manager.send_to_channel(text_channel_id, {
            "type": "typing",
            "user": {"id": user.id, "username": user.display_name or user.username},
            "text_channel_id": text_channel_id,
        })


async def handle_join_voice(
    user: User,
    message_data: dict,
    db: AsyncSession,
    websocket: WebSocket,
    ws_id: int,
    manager,
    voice_connections: dict,
    request_id: Optional[str] = None,
) -> tuple[Optional[int], Optional[str]]:
    voice_channel_id = _normalize_voice_channel_id(message_data)
    if not voice_channel_id:
        return None, None

    # prevent concurrent joins/leaves on the same global state:
    async with VOICE_OPERATION_LOCK:
        voice_channel_result = await db.execute(
            select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
        )
        voice_channel = voice_channel_result.scalar_one_or_none()
        if not voice_channel:
            await websocket.send_text(json.dumps({"type": "error", "message": "Voice channel not found"}))
            return None, None

        from app.services.channel_access import user_can_access_voice_channel
        if not await user_can_access_voice_channel(db, user, voice_channel):
            await websocket.send_text(
                json.dumps({"type": "error", "message": "No access to voice channel"})
            )
            return None, None

        # remove stale connections on all user channels before proceeding
        active_user_channels = list(find_user_channels(voice_connections, user.id))
        for old_channel_id in active_user_channels:
            if old_channel_id == voice_channel_id:
                continue
            await cleanup_voice_connection(
                user,
                old_channel_id,
                None,
                db,
                manager,
                voice_connections,
                silent=False,
            )

        # explicit replacement for same channel before presence write/broadcast
        old_info = voice_connections.get(voice_channel_id, {}).get(user.id)
        if old_info:
            VOICE_DEBUG_METRICS["voice_reconnections"] += 1
            VOICE_DEBUG_METRICS["orphan_cleanup_count"] += 1
            old_info["connection_id"] = f"replaced:{old_info.get('connection_id')}"
            try:
                old_ws = old_info.get("websocket")
                if old_ws and old_ws is not websocket:
                    await old_ws.close(code=4000, reason="Replaced by new voice connection")
            except Exception:
                pass
            if voice_channel_id in voice_connections:
                voice_connections[voice_channel_id].pop(user.id, None)

        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.voice_channel_id == voice_channel_id,
                    VoiceChannelUser.user_id == user.id,
                )
            )
        )
        await db.commit()

        active_users_query = await db.execute(
            select(VoiceChannelUser).where(VoiceChannelUser.voice_channel_id == voice_channel_id)
        )
        active_count = len(active_users_query.scalars().all())
        max_users = int(voice_channel.max_users or 0)
        if max_users > 0 and active_count >= max_users:
            await websocket.send_text(json.dumps({"type": "error", "message": "Voice channel is full"}))
            return None, None

        connection_id = new_connection_id()
        db.add(VoiceChannelUser(voice_channel_id=voice_channel_id, user_id=user.id))
        await db.commit()

        await manager.register_channel(websocket, user.id, voice_channel_id)
        is_muted = _normalize_bool(message_data.get("is_muted"), False)
        is_deafened = _normalize_bool(message_data.get("is_deafened"), False)
        register_connection(
            voice_connections,
            voice_channel_id,
            user.id,
            websocket=websocket,
            username=user.display_name or user.username,
            connection_id=connection_id,
            is_muted=is_muted,
            is_deafened=is_deafened,
            is_sharing_screen=False,
        )

        participants = []
        for uid, conn_info in list(voice_connections.get(voice_channel_id, {}).items()):
            if uid == user.id:
                continue
            user_info_result = await db.execute(select(User).where(User.id == uid))
            user_info = user_info_result.scalar_one_or_none()
            participants.append(participant_payload(
                uid,
                conn_info,
                display_name=user_info.display_name if user_info else None,
                avatar_url=user_info.avatar_url if user_info else None,
            ))

        await websocket.send_text(
            json.dumps({
                "type": "voice_participants",
                "participants": participants,
                "ice_servers": settings.ICE_SERVERS,
                "self": {
                    "user_id": user.id,
                    "is_muted": is_muted,
                    "is_deafened": is_deafened,
                },
            })
        )

        await _broadcast_voice(
            voice_channel_id,
            {
                "type": "user_joined_voice",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "voice_channel_id": voice_channel_id,
                "is_muted": is_muted,
                "is_deafened": is_deafened,
                "connection_id": connection_id,
            },
            exclude_user_id=user.id,
        )

        await manager.broadcast({
            "type": "voice_channel_join",
            "user_id": user.id,
            "username": user.display_name or user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "voice_channel_id": voice_channel_id,
            "voice_channel_name": voice_channel.name,
            "request_id": request_id,
        })

        _structured_log(
            user,
            "join_voice_ok",
            voice_channel_id=voice_channel_id,
            ws_id=ws_id,
            request_id=request_id,
            connection_id=connection_id,
        )
        return voice_channel_id, connection_id


async def handle_leave_voice(
    user: User,
    voice_channel_id: Optional[int],
    connection_id: Optional[str],
    db: AsyncSession,
    manager,
    voice_connections: dict,
) -> tuple[Optional[int], Optional[str]]:
    if not voice_channel_id:
        return None, None

    async with VOICE_OPERATION_LOCK:
        await cleanup_voice_connection(
            user,
            voice_channel_id,
            connection_id,
            db,
            manager,
            voice_connections,
            silent=False,
        )
    return None, None


async def cleanup_voice_connection(
    user: User,
    voice_channel_id: int,
    connection_id: Optional[str],
    db: AsyncSession,
    manager,
    voice_connections: dict,
    silent: bool = False,
) -> None:
    VOICE_DEBUG_METRICS["cleanup_calls"] += 1

    channel_users = voice_connections.get(voice_channel_id, {})
    removed = None
    if connection_id is not None:
        is_current = is_active_connection(
            voice_connections, voice_channel_id, user.id, connection_id
        )
        if not is_current:
            _structured_log(
                user,
                "cleanup_skipped_stale",
                voice_channel_id=voice_channel_id,
                connection_id=connection_id,
            )
            return

        removed = pop_connection_if_current(
            voice_connections, voice_channel_id, user.id, connection_id
        )
    else:
        removed = channel_users.pop(user.id, None)
        if voice_channel_id in voice_connections and not voice_connections[voice_channel_id]:
            voice_connections.pop(voice_channel_id, None)

    if removed is None and connection_id is not None:
        _structured_log(
            user,
            "cleanup_skipped_stale",
            voice_channel_id=voice_channel_id,
            connection_id=connection_id,
        )
        return

    removed_ws = removed.get("websocket") if isinstance(removed, dict) else None
    if removed_ws is not None:
        await manager.unregister_channel(
            removed_ws,
            user.id,
            voice_channel_id,
        )

    await db.execute(
        delete(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id,
            )
        )
    )
    await db.commit()

    if not silent and removed is not None:
        await _broadcast_voice(
            voice_channel_id,
            {"type": "user_left_voice", "user_id": user.id, "voice_channel_id": voice_channel_id},
            exclude_user_id=user.id,
        )
        await manager.broadcast({
            "type": "voice_channel_leave",
            "user_id": user.id,
            "username": user.display_name or user.username,
            "voice_channel_id": voice_channel_id,
        })

    _structured_log(user, "leave_voice", voice_channel_id=voice_channel_id, connection_id=connection_id)


async def handle_voice_offer(user: User, message_data: dict, manager):
    target_id = _normalize_target_user_id(message_data)
    offer = message_data.get("offer")
    if target_id is not None and offer:
        await manager.send_personal_message(
            {
                "type": "voice_offer",
                "from_id": user.id,
                "offer": offer,
                "request_id": _extract_request_id(message_data),
            },
            target_id
        )


async def handle_voice_answer(user: User, message_data: dict, manager):
    target_id = _normalize_target_user_id(message_data)
    answer = message_data.get("answer")
    if target_id is not None and answer:
        await manager.send_personal_message(
            {
                "type": "voice_answer",
                "from_id": user.id,
                "answer": answer,
                "request_id": _extract_request_id(message_data),
            },
            target_id
        )


async def handle_voice_ice_candidate(user: User, message_data: dict, manager):
    target_id = _normalize_target_user_id(message_data)
    candidate = message_data.get("candidate")
    if target_id is not None and candidate:
        await manager.send_personal_message(
            {
                "type": "voice_ice_candidate",
                "from_id": user.id,
                "candidate": candidate,
                "request_id": _extract_request_id(message_data),
            },
            target_id
        )


async def handle_voice_mute(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    db: AsyncSession,
    manager,
    voice_connections: dict,
):
    if not voice_channel_id:
        return
    is_muted = _normalize_bool(message_data.get("is_muted"), False)
    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_muted"] = is_muted

    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id,
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_muted = is_muted
        await db.commit()

    await _broadcast_voice(
        voice_channel_id,
        {"type": "user_muted", "user_id": user.id, "is_muted": is_muted},
        exclude_user_id=user.id,
    )


async def handle_voice_deafen(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    db: AsyncSession,
    manager,
    voice_connections: dict,
):
    if not voice_channel_id:
        return
    is_deafened = _normalize_bool(message_data.get("is_deafened"), False)
    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_deafened"] = is_deafened

    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id,
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_deafened = is_deafened
        await db.commit()

    await _broadcast_voice(
        voice_channel_id,
        {"type": "user_deafened", "user_id": user.id, "is_deafened": is_deafened},
        exclude_user_id=user.id,
    )


async def handle_voice_speaking(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    manager,
):
    if not voice_channel_id:
        return
    is_speaking = message_data.get("is_speaking", False)
    await _broadcast_voice(
        voice_channel_id,
        {"type": "user_speaking", "user_id": user.id, "is_speaking": bool(is_speaking)},
        exclude_user_id=user.id,
    )


async def handle_screen_share_start(
    user: User,
    voice_channel_id: Optional[int],
    manager,
    voice_connections: dict,
):
    if not voice_channel_id:
        return
    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_sharing_screen"] = True
    await _broadcast_voice(
        voice_channel_id,
        {
            "type": "screen_share_started",
            "user_id": user.id,
            "username": user.display_name or user.username,
        },
    )


async def handle_screen_share_stop(
    user: User,
    voice_channel_id: Optional[int],
    manager,
    voice_connections: dict,
):
    if not voice_channel_id:
        return
    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_sharing_screen"] = False
    await _broadcast_voice(
        voice_channel_id,
        {
            "type": "screen_share_stopped",
            "user_id": user.id,
            "username": user.display_name or user.username,
        },
    )


async def handle_p2p_initiate(user: User, message_data: dict, manager):
    recipient_id = message_data.get("to")
    if recipient_id:
        caller_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message({"type": "p2p-incoming-call", "caller": caller_info}, recipient_id)


async def handle_p2p_accept(user: User, message_data: dict, manager):
    caller_id = message_data.get("to")
    if caller_id:
        recipient_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message(
            {"type": "p2p-call-accepted", "recipient": recipient_info},
            caller_id,
        )


async def handle_p2p_decline(user: User, message_data: dict, manager):
    caller_id = message_data.get("to")
    if caller_id:
        recipient_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message(
            {"type": "p2p-call-declined", "recipient": recipient_info},
            caller_id,
        )


async def handle_p2p_hangup(user: User, message_data: dict, manager):
    recipient_id = message_data.get("to")
    if recipient_id:
        await manager.send_personal_message({"type": "p2p-call-ended"}, recipient_id)


async def handle_p2p_offer(user: User, message_data: dict, manager):
    recipient_id = message_data.get("to")
    offer = message_data.get("offer")
    if recipient_id and offer:
        await manager.send_personal_message({
            "type": "p2p-offer",
            "from": user.id,
            "offer": offer,
        }, recipient_id)


async def handle_p2p_answer(user: User, message_data: dict, manager):
    recipient_id = message_data.get("to")
    answer = message_data.get("answer")
    if recipient_id and answer:
        await manager.send_personal_message({
            "type": "p2p-answer",
            "from": user.id,
            "answer": answer,
        }, recipient_id)


async def handle_p2p_ice_candidate(user: User, message_data: dict, manager):
    recipient_id = message_data.get("to")
    candidate = message_data.get("candidate")
    if recipient_id and candidate:
        await manager.send_personal_message({
            "type": "p2p-ice-candidate",
            "from": user.id,
            "candidate": candidate,
        }, recipient_id)


async def handle_dm_message(user: User, message_data: dict, db: AsyncSession, manager):
    recipient_id = message_data.get("recipient_id")
    content = message_data.get("content", "").strip()
    attachments = list(message_data.get("attachments", []) or [])
    attachment_upload_ids = list(dict.fromkeys(str(item) for item in (message_data.get("attachment_upload_ids") or [])))
    client_nonce = message_data.get("client_nonce")
    reply_to_id = message_data.get("reply_to_id")

    if (not content and not attachments and not attachment_upload_ids) or not recipient_id:
        await _send_message_failure(user.id, client_nonce, "invalid_message", "Получатель или содержимое сообщения не указаны")
        return

    if len(content) > 5000 or len(attachments) + len(attachment_upload_ids) > 10:
        await _send_message_failure(user.id, client_nonce, "validation_error", "Превышен лимит текста или вложений")
        return

    if client_nonce is not None and (not isinstance(client_nonce, str) or len(client_nonce) > 64):
        return

    if client_nonce:
        existing = (await db.execute(select(DirectMessage).where(
            DirectMessage.sender_id == user.id,
            DirectMessage.client_nonce == client_nonce,
        ))).scalar_one_or_none()
        if existing is not None:
            if existing.recipient_id != recipient_id or (existing.content or "") != content:
                await _send_message_failure(user.id, client_nonce, "nonce_conflict", "client_nonce уже использован для другого сообщения")
                return
            await manager.send_to_user(user.id, {
                "type": "message_ack",
                "data": {"id": existing.id, "client_nonce": existing.client_nonce},
            })
            return

    pending_uploads = []
    if attachment_upload_ids:
        pending_uploads = (await db.execute(select(PendingChatUpload).where(
            PendingChatUpload.id.in_(attachment_upload_ids),
            PendingChatUpload.owner_id == user.id,
        ))).scalars().all()
        if len(pending_uploads) != len(attachment_upload_ids):
            await _send_message_failure(user.id, client_nonce, "upload_expired", "Загрузка файла не найдена или истекла", True)
            return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"dm:{min(user.id, int(recipient_id))}:{max(user.id, int(recipient_id))}",
        content=content,
    )
    if not allowed:
        await _send_message_failure(user.id, client_nonce, "rate_limited", limit_message, True, retry_after)
        await manager.send_to_user(
            user.id,
            rate_limit_payload(
                message=limit_message,
                retry_after_seconds=retry_after,
                scope="dm",
                recipient_id=int(recipient_id),
            )
        )
        return

    db_message = await direct_message_service.create_message(
        db,
        sender_id=user.id,
        recipient_id=recipient_id,
        content=content if content else None,
        attachments=attachments,
        reply_to_id=reply_to_id,
        client_nonce=client_nonce,
        pending_uploads=pending_uploads,
    )
    author = await db.get(User, user.id)

    message_dict = {
        "id": db_message.id,
        "client_nonce": db_message.client_nonce,
        "content": db_message.content,
        "timestamp": db_message.timestamp,
        "sender_id": db_message.sender_id,
        "recipient_id": db_message.recipient_id,
        "author": {
            "id": author.id,
            "username": author.username,
            "email": "",
            "display_name": author.display_name,
            "avatar_url": author.avatar_url,
            "is_active": author.is_active,
            "is_online": author.is_online,
            "created_at": author.created_at,
            "updated_at": author.updated_at,
        },
        "attachments": [
            {
                "id": att.id,
                "file_url": att.file_url,
                "message_id": att.dm_message_id,
            } for att in (db_message.attachments or [])
        ],
        "reactions": [],
        "reply_to": None if not db_message.reply_to else {
            "id": db_message.reply_to.id,
            "content": db_message.reply_to.content,
            "timestamp": db_message.reply_to.timestamp,
            "sender_id": db_message.reply_to.sender_id,
            "recipient_id": db_message.reply_to.recipient_id,
        }
    }

    message_to_send = {"type": "dm", "data": message_dict}
    await manager.send_personal_message(message_to_send, recipient_id)
    await manager.send_personal_message(message_to_send, user.id)
