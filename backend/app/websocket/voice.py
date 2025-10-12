from fastapi import WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
import json
import asyncio
from typing import Dict
from app.db.database import get_db, AsyncSessionLocal
from app.models import User, VoiceChannel, VoiceChannelUser, ChannelMember
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.core.config import settings

# Хранилище WebRTC соединений
voice_connections: Dict[int, Dict[int, dict]] = {}  # voice_channel_id -> {user_id -> connection_info}

async def get_current_user_voice(
    websocket: WebSocket,
    token: str,
    db: AsyncSession
) -> User:
    """Получение текущего пользователя для голосовой WebSocket"""
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return None
    
    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token")
        return None
    
    result = await db.execute(
        select(User).where(User.id == int(user_id))
    )
    user = result.scalar_one_or_none()
    
    if not user:
        await websocket.close(code=4001, reason="User not found")
        return None
    
    return user

async def websocket_voice_endpoint(
    websocket: WebSocket,
    channel_id: int,
    token: str
):
    """WebSocket эндпоинт для голосовой связи"""
    # Создаем сессию базы данных вручную
    async with AsyncSessionLocal() as db:
        # Аутентификация
        user = await get_current_user_voice(websocket, token, db)
        if not user:
            return
        
        # Проверка существования голосового канала
        voice_result = await db.execute(
            select(VoiceChannel).where(VoiceChannel.id == channel_id)
        )
        voice_channel = voice_result.scalar_one_or_none()
        
        if not voice_channel:
            await websocket.close(code=4004, reason="Voice channel not found")
            return
        
        # Убираем проверку членства - все пользователи могут заходить в любые каналы
        
        # Проверка лимита пользователей
        active_users_count = await db.execute(
            select(VoiceChannelUser).where(
                VoiceChannelUser.voice_channel_id == channel_id
            )
        )
        if len(active_users_count.scalars().all()) >= voice_channel.max_users:
            await websocket.close(code=4005, reason="Voice channel is full")
            return
        
        await websocket.accept()
        await manager.connect(websocket, user.id, channel_id)
        
        # Добавление в голосовой канал в БД
        voice_user = VoiceChannelUser(
            voice_channel_id=channel_id,
            user_id=user.id
        )
        db.add(voice_user)
        await db.commit()
        
        # Инициализация хранилища для канала
        if channel_id not in voice_connections:
            voice_connections[channel_id] = {}
        
        voice_connections[channel_id][user.id] = {
            "websocket": websocket,
            "user_id": user.id,
            "username": user.display_name or user.username,
            "is_muted": False,
            "is_deafened": False,
            "is_sharing_screen": False
        }
        
        print(f"[Voice] Пользователь {user.id} ({user.username}) подключился к каналу {channel_id}, ожидаем сообщение 'join'")
        
        try:
            # Обработка сообщений WebRTC
            while True:
                data = await websocket.receive_json()
                
                if data["type"] == "join":
                    # Обработка сообщения о подключении пользователя
                    print(f"[Voice] Получено сообщение 'join' от пользователя {user.id} ({user.username})")
                    
                    # Обновляем начальные статусы из сообщения
                    is_muted = data.get("is_muted", False)
                    is_deafened = data.get("is_deafened", False)
                    voice_connections[channel_id][user.id]["is_muted"] = is_muted
                    voice_connections[channel_id][user.id]["is_deafened"] = is_deafened
                    
                    # Отправка списка участников новому пользователю
                    participants = []
                    for uid, conn_info in voice_connections[channel_id].items():
                        if uid != user.id:
                            # Получаем полную информацию о пользователе
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
                    
                    await websocket.send_json({
                        "type": "participants",
                        "participants": participants,
                        "ice_servers": settings.ICE_SERVERS
                    })
                    print(f"[Voice] Отправлен список из {len(participants)} участников пользователю {user.id}")
                    
                    # Уведомление других участников о новом пользователе
                    join_message = {
                        "type": "user_joined_voice",
                        "user_id": user.id,
                        "username": user.display_name or user.username,
                        "display_name": user.display_name,
                        "avatar_url": user.avatar_url,
                        "is_muted": is_muted,
                        "is_deafened": is_deafened
                    }
                    
                    await manager.send_to_channel(channel_id, join_message)
                    print(f"[Voice] Уведомление о присоединении пользователя {user.id} отправлено в канал {channel_id}")
                    
                    # Глобальное уведомление всем онлайн пользователям
                    global_join_message = {
                        "type": "voice_channel_join",
                        "user_id": user.id,
                        "username": user.display_name or user.username,
                        "voice_channel_id": channel_id,
                        "voice_channel_name": voice_channel.name
                    }
                    await manager.broadcast(global_join_message)
                    print(f"[Voice] Глобальное уведомление о присоединении к каналу {channel_id} отправлено")
                
                elif data["type"] == "offer":
                    # Пересылка offer целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[channel_id]:
                        await manager.send_personal_message({
                            "type": "offer",
                            "from_id": user.id,
                            "offer": data["offer"]
                        }, target_id)
                
                elif data["type"] == "answer":
                    # Пересылка answer целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[channel_id]:
                        await manager.send_personal_message({
                            "type": "answer",
                            "from_id": user.id,
                            "answer": data["answer"]
                        }, target_id)
                
                elif data["type"] == "ice_candidate":
                    # Пересылка ICE candidate целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[channel_id]:
                        await manager.send_personal_message({
                            "type": "ice_candidate",
                            "from_id": user.id,
                            "candidate": data["candidate"]
                        }, target_id)
                
                elif data["type"] == "mute":
                    # Обновление статуса mute
                    is_muted = data.get("is_muted", False)
                    voice_connections[channel_id][user.id]["is_muted"] = is_muted
                    
                    # Обновление в БД
                    voice_user_result = await db.execute(
                        select(VoiceChannelUser).where(
                            and_(
                                VoiceChannelUser.voice_channel_id == channel_id,
                                VoiceChannelUser.user_id == user.id
                            )
                        )
                    )
                    voice_user_db = voice_user_result.scalar_one_or_none()
                    if voice_user_db:
                        voice_user_db.is_muted = is_muted
                        await db.commit()
                    
                    # Уведомление других участников
                    mute_message = {
                        "type": "user_muted",
                        "user_id": user.id,
                        "is_muted": is_muted
                    }
                    await manager.send_to_channel(channel_id, mute_message)
                
                elif data["type"] == "deafen":
                    # Обновление статуса deafen
                    is_deafened = data.get("is_deafened", False)
                    voice_connections[channel_id][user.id]["is_deafened"] = is_deafened
                    
                    # Обновление в БД
                    voice_user_result = await db.execute(
                        select(VoiceChannelUser).where(
                            and_(
                                VoiceChannelUser.voice_channel_id == channel_id,
                                VoiceChannelUser.user_id == user.id
                            )
                        )
                    )
                    voice_user_db = voice_user_result.scalar_one_or_none()
                    if voice_user_db:
                        voice_user_db.is_deafened = is_deafened
                        await db.commit()
                    
                    # Уведомление других участников
                    deafen_message = {
                        "type": "user_deafened",
                        "user_id": user.id,
                        "is_deafened": is_deafened
                    }
                    await manager.send_to_channel(channel_id, deafen_message)
                
                elif data["type"] == "speaking":
                    # Обработка информации о голосовой активности
                    is_speaking = data.get("is_speaking", False)
                    
                    # Уведомление других участников о голосовой активности
                    speaking_message = {
                        "type": "user_speaking",
                        "user_id": user.id,
                        "is_speaking": is_speaking
                    }
                    await manager.send_to_channel(channel_id, speaking_message)
                
                elif data["type"] == "screen_share_start":
                    # Обновляем состояние пользователя
                    voice_connections[channel_id][user.id]["is_sharing_screen"] = True

                    # Уведомляем всех участников канала о начале демонстрации экрана
                    screen_share_message = {
                        "type": "screen_share_started",
                        "user_id": user.id,
                        "username": user.display_name or user.username
                    }

                    await manager.send_to_channel(channel_id, screen_share_message)

                    print(f"Пользователь {user.username} начал демонстрацию экрана")
                
                elif data["type"] == "screen_share_stop":
                    # Обновляем состояние пользователя
                    voice_connections[channel_id][user.id]["is_sharing_screen"] = False

                    # Уведомляем всех участников канала об остановке демонстрации экрана
                    screen_share_message = {
                        "type": "screen_share_stopped",
                        "user_id": user.id,
                        "username": user.display_name or user.username
                    }

                    await manager.send_to_channel(channel_id, screen_share_message)

                    print(f"Пользователь {user.username} остановил демонстрацию экрана")
                
                elif data["type"] == "pong":
                    # Ответ на ping - просто игнорируем, соединение живо
                    pass
                
                else:
                    print(f"Неизвестный тип сообщения: {data['type']}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Неизвестный тип сообщения: {data['type']}"
                    }))
        
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"Voice WebSocket error: {e}")
        finally:
            await manager.disconnect(websocket, user.id, channel_id)
            # Удаление из голосового канала
            if channel_id in voice_connections and user.id in voice_connections[channel_id]:
                del voice_connections[channel_id][user.id]
                
                # Если канал пуст, удаляем его
                if not voice_connections[channel_id]:
                    del voice_connections[channel_id]
            
            # Удаление из БД
            await db.execute(
                delete(VoiceChannelUser).where(
                    and_(
                        VoiceChannelUser.voice_channel_id == channel_id,
                        VoiceChannelUser.user_id == user.id
                    )
                )
            )
            await db.commit()
            
            # Уведомление других участников об уходе
            leave_message = {
                "type": "user_left_voice",
                "user_id": user.id
            }
            await manager.send_to_channel(channel_id, leave_message)
            
            # Глобальное уведомление всем онлайн пользователям
            global_leave_message = {
                "type": "voice_channel_leave",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "voice_channel_id": channel_id
            }
            await manager.broadcast(global_leave_message)
