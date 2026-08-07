"""
Унифицированный WebSocket endpoint для всего приложения
Обрабатывает: чаты, голос, уведомления, P2P звонки через одно соединение
"""

from fastapi import WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
import json
import asyncio
from typing import Dict, Optional
from datetime import timezone

from app.db.database import AsyncSessionLocal
from app.models import (
    User, Message, TextChannel, VoiceChannel, VoiceChannelUser,
    Attachment, Reaction, ChannelMember
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
from app.core.config import settings


# Глобальное хранилище голосовых соединений
# voice_channel_id -> {user_id -> connection_info}
voice_connections: Dict[int, Dict[int, dict]] = {}


async def get_user_by_token_ws(token: str, db: AsyncSession) -> Optional[User]:
    """Получение пользователя по токену для WebSocket"""
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
        print(f"[UnifiedWS] Ошибка аутентификации: {e}")
        return None


async def websocket_unified_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """
    Единый WebSocket эндпоинт для всех типов соединений:
    - Чат сообщения
    - Голосовые каналы + WebRTC сигналинг
    - Уведомления
    - P2P звонки
    - Direct messages
    """
    db: Optional[AsyncSession] = None
    user: Optional[User] = None
    current_text_channels: set = set()  # Текстовые каналы, к которым подключен
    current_voice_channel: Optional[int] = None  # Голосовой канал
    
    try:
        # Создаем сессию БД
        db = AsyncSessionLocal()
        
        # Аутентификация
        user = await get_user_by_token_ws(token, db)
        if not user:
            print(f"[UnifiedWS] ❌ Неавторизованное подключение")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Подключаем WebSocket
        await manager.connect(websocket, user.id)
        await user_activity_service.update_user_activity(user.id, db)
        
        print(f"[UnifiedWS] ✅ {user.username} (id={user.id}) подключился")
        
        try:
            # Главный цикл обработки сообщений
            while True:
                try:
                    # Ждем сообщение с таймаутом для heartbeat
                    data = await asyncio.wait_for(
                        websocket.receive_text(),
                        timeout=30.0
                    )
                    
                    if not isinstance(data, str):
                        continue

                    try:
                        message_data = json.loads(data)
                    except json.JSONDecodeError as e:
                        print(f"[UnifiedWS] ❌ Ошибка JSON: {e}")
                        continue

                    if not isinstance(message_data, dict):
                        continue

                    msg_type = message_data.get("type")
                    print(f"[UnifiedWS] 📨 {user.username}: {msg_type}")

                    # ==================== HEARTBEAT ====================
                    if msg_type == "ping":
                        await user_activity_service.heartbeat_user(user.id, db)
                        await websocket.send_text(json.dumps({"type": "pong"}))

                    # ==================== ЧАТ СООБЩЕНИЯ ====================
                    elif msg_type == "chat_message":
                        await handle_chat_message(
                            user, message_data, db, manager, 
                            current_text_channels
                        )

                    elif msg_type == "typing":
                        await handle_typing(
                            user, message_data, manager,
                            current_text_channels
                        )

                    # ==================== ГОЛОСОВЫЕ КАНАЛЫ ====================
                    elif msg_type == "join_voice":
                        current_voice_channel = await handle_join_voice(
                            user, message_data, db, websocket, manager,
                            voice_connections
                        )

                    elif msg_type == "leave_voice":
                        current_voice_channel = await handle_leave_voice(
                            user, current_voice_channel, db, manager,
                            voice_connections
                        )

                    elif msg_type == "voice_offer":
                        await handle_voice_offer(
                            user, message_data, manager
                        )

                    elif msg_type == "voice_answer":
                        await handle_voice_answer(
                            user, message_data, manager
                        )

                    elif msg_type == "voice_ice_candidate":
                        await handle_voice_ice_candidate(
                            user, message_data, manager
                        )

                    elif msg_type == "voice_mute":
                        await handle_voice_mute(
                            user, message_data, current_voice_channel,
                            db, manager, voice_connections
                        )

                    elif msg_type == "voice_deafen":
                        await handle_voice_deafen(
                            user, message_data, current_voice_channel,
                            db, manager, voice_connections
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

                    # ==================== P2P ЗВОНКИ ====================
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

                    # ==================== DIRECT MESSAGES ====================
                    elif msg_type == "dm_message":
                        await handle_dm_message(user, message_data, db, manager)

                    else:
                        print(f"[UnifiedWS] ⚠️ Неизвестный тип: {msg_type}")

                except asyncio.TimeoutError:
                    # Отправляем ping при таймауте
                    await websocket.send_text(json.dumps({"type": "ping"}))

        except WebSocketDisconnect:
            print(f"[UnifiedWS] 🔌 {user.username} отключился")
        except Exception as e:
            print(f"[UnifiedWS] ❌ Ошибка: {e}")
            import traceback
            traceback.print_exc()

    except Exception as e:
        print(f"[UnifiedWS] ❌ Критическая ошибка: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Очистка при отключении
        if user and db:
            # Отключение от голосового канала
            if current_voice_channel:
                await cleanup_voice_connection(
                    user, current_voice_channel, db, manager, voice_connections
                )

            # Отключение WebSocket
            await manager.disconnect(websocket, user.id)

            # Установка оффлайн статуса если нет других соединений
            if not manager.is_user_connected(user.id):
                await user_activity_service.set_user_offline(user.id, db)

            print(f"[UnifiedWS] ✅ {user.username} полностью отключен")

        if db:
            await db.close()


# ==================== ОБРАБОТЧИКИ СООБЩЕНИЙ ====================

async def handle_chat_message(
    user: User,
    message_data: dict,
    db: AsyncSession,
    manager,
    current_channels: set
):
    """Обработка чат сообщения"""
    content = message_data.get("content", "").strip()
    text_channel_id = message_data.get("text_channel_id")
    attachments = message_data.get("attachments", [])
    reply_to_id = message_data.get("reply_to_id")

    if not text_channel_id:
        return

    text_channel = await get_visible_text_channel(db, text_channel_id)
    if not text_channel:
        return

    from app.services.channel_access import user_can_access_text_channel
    if not await user_can_access_text_channel(db, user, text_channel, need_send=True):
        await manager.send_to_user(user.id, {
            "type": "error",
            "message": "Нет доступа к этому каналу",
            "text_channel_id": text_channel_id,
        })
        return

    # Валидация
    if not content and not attachments:
        return
    if len(content) > 5000 or len(attachments) > 10:
        return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"channel:{text_channel_id}",
        content=content,
    )
    if not allowed:
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
        await manager.send_to_user(user.id, {
            "type": "slow_mode",
            "text_channel_id": text_channel_id,
            "retry_after_seconds": retry_after,
        })
        return

    # Создаем сообщение
    db_message = Message(
        content=content if content else None,
        author_id=user.id,
        text_channel_id=text_channel_id,
        reply_to_id=reply_to_id if reply_to_id else None,
    )

    for url in attachments:
        attachment = Attachment(file_url=url)
        db_message.attachments.append(attachment)

    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)

    # Загружаем полное сообщение
    message_result = await db.execute(
        select(Message)
        .where(Message.id == db_message.id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(Reaction.user),
            selectinload(Message.reply_to).selectinload(Message.author)
        )
    )
    full_message = message_result.scalar_one()

    # Формируем ответ
    message_dict = {
        "id": full_message.id,
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
            "avatar_url": getattr(full_message.author, 'avatar_url', None)
        },
        "attachments": [
            {
                "id": att.id,
                "file_url": att.file_url,
                "filename": getattr(att, 'filename', None)
            } for att in full_message.attachments
        ],
        "reactions": [],
        "reply_to": None if not full_message.reply_to else {
            "id": full_message.reply_to.id,
            "content": "Сообщение удалено" if full_message.reply_to.is_deleted else full_message.reply_to.content,
            "is_deleted": full_message.reply_to.is_deleted,
            "author": {
                "id": full_message.reply_to.author.id,
                "username": full_message.reply_to.author.display_name or full_message.reply_to.author.username,
                "email": "",
                "display_name": full_message.reply_to.author.display_name,
                "avatar_url": getattr(full_message.reply_to.author, 'avatar_url', None)
            }
        }
    }

    # Отправляем в канал через Redis
    await manager.send_to_channel(text_channel_id, {
        "type": "new_message",
        "data": message_dict
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

    # Обновляем активность
    await user_activity_service.update_user_activity(user.id, db)


async def handle_typing(user: User, message_data: dict, manager, current_channels: set):
    """Обработка статуса печатания"""
    text_channel_id = message_data.get("text_channel_id")
    if text_channel_id:
        await manager.send_to_channel(text_channel_id, {
            "type": "typing",
            "user": {
                "id": user.id,
                "username": user.display_name or user.username
            },
            "text_channel_id": text_channel_id
        })


async def handle_join_voice(
    user: User,
    message_data: dict,
    db: AsyncSession,
    websocket: WebSocket,
    manager,
    voice_connections: dict
) -> Optional[int]:
    """Присоединение к голосовому каналу"""
    voice_channel_id = message_data.get("voice_channel_id")
    if not voice_channel_id:
        return None

    # Проверяем существование канала
    voice_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
    )
    voice_channel = voice_result.scalar_one_or_none()

    if not voice_channel:
        return None

    from app.services.channel_access import user_can_access_voice_channel
    if not await user_can_access_voice_channel(db, user, voice_channel):
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Нет доступа к голосовому каналу",
        }))
        return None

    # Проверяем лимит
    active_users = await db.execute(
        select(VoiceChannelUser).where(
            VoiceChannelUser.voice_channel_id == voice_channel_id
        )
    )
    # 0 = без лимита (∞)
    active_count = len(active_users.scalars().all())
    max_users = int(voice_channel.max_users or 0)
    if max_users > 0 and active_count >= max_users:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Voice channel is full"
        }))
        return None

    # Добавляем в БД
    voice_user = VoiceChannelUser(
        voice_channel_id=voice_channel_id,
        user_id=user.id
    )
    db.add(voice_user)
    await db.commit()

    # Инициализируем хранилище
    if voice_channel_id not in voice_connections:
        voice_connections[voice_channel_id] = {}

    voice_connections[voice_channel_id][user.id] = {
        "websocket": websocket,
        "user_id": user.id,
        "username": user.display_name or user.username,
        "is_muted": False,
        "is_deafened": False,
        "is_sharing_screen": False
    }

    # Отправляем список участников
    participants = []
    for uid, conn_info in voice_connections[voice_channel_id].items():
        if uid != user.id:
            user_info_result = await db.execute(select(User).where(User.id == uid))
            user_info = user_info_result.scalar_one_or_none()

            participants.append({
                "user_id": uid,
                "username": conn_info["username"],
                "display_name": user_info.display_name if user_info else None,
                "avatar_url": user_info.avatar_url if user_info else None,
                "is_muted": conn_info["is_muted"],
                "is_deafened": conn_info["is_deafened"],
                "is_sharing_screen": conn_info["is_sharing_screen"]
            })

    await websocket.send_text(json.dumps({
        "type": "voice_participants",
        "participants": participants,
        "ice_servers": settings.ICE_SERVERS
    }))

    # Уведомляем других участников
    await manager.send_to_channel(voice_channel_id, {
        "type": "user_joined_voice",
        "user_id": user.id,
        "username": user.display_name or user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url
    })

    # Глобальное уведомление всем онлайн пользователям
    # Получаем информацию о канале для имени
    voice_channel_name = voice_channel.name if voice_channel else f"Channel {voice_channel_id}"
    await manager.broadcast({
        "type": "voice_channel_join",
        "user_id": user.id,
        "username": user.display_name or user.username,
        "voice_channel_id": voice_channel_id,
        "voice_channel_name": voice_channel_name
    })

    print(f"[UnifiedWS] 🎤 {user.username} присоединился к голосовому каналу {voice_channel_id}")
    return voice_channel_id


async def handle_leave_voice(
    user: User,
    voice_channel_id: Optional[int],
    db: AsyncSession,
    manager,
    voice_connections: dict
) -> None:
    """Отключение от голосового канала"""
    if not voice_channel_id:
        return None

    await cleanup_voice_connection(user, voice_channel_id, db, manager, voice_connections)
    return None


async def cleanup_voice_connection(
    user: User,
    voice_channel_id: int,
    db: AsyncSession,
    manager,
    voice_connections: dict
):
    """Очистка голосового соединения"""
    # Удаляем из хранилища
    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        del voice_connections[voice_channel_id][user.id]

        if not voice_connections[voice_channel_id]:
            del voice_connections[voice_channel_id]

    # Удаляем из БД
    await db.execute(
        delete(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id
            )
        )
    )
    await db.commit()

    # Уведомляем других
    await manager.send_to_channel(voice_channel_id, {
        "type": "user_left_voice",
        "user_id": user.id
    })

    # Глобальное уведомление всем онлайн пользователям
    await manager.broadcast({
        "type": "voice_channel_leave",
        "user_id": user.id,
        "username": user.display_name or user.username,
        "voice_channel_id": voice_channel_id
    })

    print(f"[UnifiedWS] 🔇 {user.username} покинул голосовой канал {voice_channel_id}")


async def handle_voice_offer(user: User, message_data: dict, manager):
    """Пересылка WebRTC offer"""
    target_id = message_data.get("target_user_id")
    offer = message_data.get("offer")
    if target_id and offer:
        await manager.send_personal_message({
            "type": "voice_offer",
            "from_id": user.id,
            "offer": offer
        }, target_id)


async def handle_voice_answer(user: User, message_data: dict, manager):
    """Пересылка WebRTC answer"""
    target_id = message_data.get("target_user_id")
    answer = message_data.get("answer")
    if target_id and answer:
        await manager.send_personal_message({
            "type": "voice_answer",
            "from_id": user.id,
            "answer": answer
        }, target_id)


async def handle_voice_ice_candidate(user: User, message_data: dict, manager):
    """Пересылка ICE candidate"""
    target_id = message_data.get("target_user_id")
    candidate = message_data.get("candidate")
    if target_id and candidate:
        await manager.send_personal_message({
            "type": "voice_ice_candidate",
            "from_id": user.id,
            "candidate": candidate
        }, target_id)


async def handle_voice_mute(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    db: AsyncSession,
    manager,
    voice_connections: dict
):
    """Обновление статуса mute"""
    if not voice_channel_id:
        return

    is_muted = message_data.get("is_muted", False)

    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_muted"] = is_muted

    # Обновляем в БД
    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_muted = is_muted
        await db.commit()

    # Уведомляем других
    await manager.send_to_channel(voice_channel_id, {
        "type": "user_muted",
        "user_id": user.id,
        "is_muted": is_muted
    })


async def handle_voice_deafen(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    db: AsyncSession,
    manager,
    voice_connections: dict
):
    """Обновление статуса deafen"""
    if not voice_channel_id:
        return

    is_deafened = message_data.get("is_deafened", False)

    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_deafened"] = is_deafened

    # Обновляем в БД
    voice_user_result = await db.execute(
        select(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == voice_channel_id,
                VoiceChannelUser.user_id == user.id
            )
        )
    )
    voice_user_db = voice_user_result.scalar_one_or_none()
    if voice_user_db:
        voice_user_db.is_deafened = is_deafened
        await db.commit()

    # Уведомляем других
    await manager.send_to_channel(voice_channel_id, {
        "type": "user_deafened",
        "user_id": user.id,
        "is_deafened": is_deafened
    })


async def handle_voice_speaking(
    user: User,
    message_data: dict,
    voice_channel_id: Optional[int],
    manager
):
    """Обновление статуса speaking"""
    if not voice_channel_id:
        return

    is_speaking = message_data.get("is_speaking", False)
    await manager.send_to_channel(voice_channel_id, {
        "type": "user_speaking",
        "user_id": user.id,
        "is_speaking": is_speaking
    })


async def handle_screen_share_start(
    user: User,
    voice_channel_id: Optional[int],
    manager,
    voice_connections: dict
):
    """Начало демонстрации экрана"""
    if not voice_channel_id:
        return

    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_sharing_screen"] = True

    await manager.send_to_channel(voice_channel_id, {
        "type": "screen_share_started",
        "user_id": user.id,
        "username": user.display_name or user.username
    })


async def handle_screen_share_stop(
    user: User,
    voice_channel_id: Optional[int],
    manager,
    voice_connections: dict
):
    """Остановка демонстрации экрана"""
    if not voice_channel_id:
        return

    if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
        voice_connections[voice_channel_id][user.id]["is_sharing_screen"] = False

    await manager.send_to_channel(voice_channel_id, {
        "type": "screen_share_stopped",
        "user_id": user.id,
        "username": user.display_name or user.username
    })


async def handle_p2p_initiate(user: User, message_data: dict, manager):
    """Инициация P2P звонка"""
    recipient_id = message_data.get("to")
    if recipient_id:
        caller_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message({
            "type": "p2p-incoming-call",
            "caller": caller_info,
        }, recipient_id)


async def handle_p2p_accept(user: User, message_data: dict, manager):
    """Принятие P2P звонка"""
    caller_id = message_data.get("to")
    if caller_id:
        recipient_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message({
            "type": "p2p-call-accepted",
            "recipient": recipient_info,
        }, caller_id)


async def handle_p2p_decline(user: User, message_data: dict, manager):
    """Отклонение P2P звонка"""
    caller_id = message_data.get("to")
    if caller_id:
        recipient_info = {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        }
        await manager.send_personal_message({
            "type": "p2p-call-declined",
            "recipient": recipient_info,
        }, caller_id)


async def handle_p2p_hangup(user: User, message_data: dict, manager):
    """Завершение P2P звонка"""
    recipient_id = message_data.get("to")
    if recipient_id:
        await manager.send_personal_message({
            "type": "p2p-call-ended",
        }, recipient_id)


async def handle_p2p_offer(user: User, message_data: dict, manager):
    """Пересылка P2P offer"""
    recipient_id = message_data.get("to")
    offer = message_data.get("offer")
    if recipient_id and offer:
        await manager.send_personal_message({
            "type": "p2p-offer",
            "from": user.id,
            "offer": offer,
        }, recipient_id)


async def handle_p2p_answer(user: User, message_data: dict, manager):
    """Пересылка P2P answer"""
    recipient_id = message_data.get("to")
    answer = message_data.get("answer")
    if recipient_id and answer:
        await manager.send_personal_message({
            "type": "p2p-answer",
            "from": user.id,
            "answer": answer,
        }, recipient_id)


async def handle_p2p_ice_candidate(user: User, message_data: dict, manager):
    """Пересылка P2P ICE candidate"""
    recipient_id = message_data.get("to")
    candidate = message_data.get("candidate")
    if recipient_id and candidate:
        await manager.send_personal_message({
            "type": "p2p-ice-candidate",
            "from": user.id,
            "candidate": candidate,
        }, recipient_id)


async def handle_dm_message(user: User, message_data: dict, db: AsyncSession, manager):
    """Обработка личного сообщения"""
    recipient_id = message_data.get("recipient_id")
    content = message_data.get("content", "").strip()
    attachments = message_data.get("attachments", [])
    reply_to_id = message_data.get("reply_to_id")

    # Валидация: должен быть либо контент, либо вложения
    if (not content and not attachments) or not recipient_id:
        return
    
    # Ограничения
    if len(content) > 5000 or len(attachments) > 10:
        return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"dm:{min(user.id, int(recipient_id))}:{max(user.id, int(recipient_id))}",
        content=content,
    )
    if not allowed:
        await manager.send_to_user(
            user.id,
            rate_limit_payload(
                message=limit_message,
                retry_after_seconds=retry_after,
                scope="dm",
                recipient_id=int(recipient_id),
            ),
        )
        return

    db_message = await direct_message_service.create_message(
        db, 
        sender_id=user.id, 
        recipient_id=recipient_id, 
        content=content if content else None,
        attachments=attachments,
        reply_to_id=reply_to_id
    )

    author = await db.get(User, user.id)

    message_dict = {
        "id": db_message.id,
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
                "message_id": att.dm_message_id
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

    message_to_send = {
        "type": "dm",
        "data": message_dict
    }

    await manager.send_personal_message(message_to_send, recipient_id)
    await manager.send_personal_message(message_to_send, user.id)

