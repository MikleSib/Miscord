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
    """Получение текущего пользователя для голосового WebSocket"""
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
    voice_channel_id: int,
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
            select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
        )
        voice_channel = voice_result.scalar_one_or_none()
        
        if not voice_channel:
            await websocket.close(code=4004, reason="Voice channel not found")
            return
        
        # Убираем проверку членства - все пользователи могут заходить в любые каналы
        
        # Проверка лимита пользователей
        active_users_count = await db.execute(
            select(VoiceChannelUser).where(
                VoiceChannelUser.voice_channel_id == voice_channel_id
            )
        )
        if len(active_users_count.scalars().all()) >= voice_channel.max_users:
            await websocket.close(code=4005, reason="Voice channel is full")
            return
        
        await websocket.accept()
        
        # Добавление в голосовой канал в БД
        voice_user = VoiceChannelUser(
            voice_channel_id=voice_channel_id,
            user_id=user.id
        )
        db.add(voice_user)
        await db.commit()
        
        # Инициализация хранилища для канала
        if voice_channel_id not in voice_connections:
            voice_connections[voice_channel_id] = {}
        
        voice_connections[voice_channel_id][user.id] = {
            "websocket": websocket,
            "user_id": user.id,
            "username": user.username,
            "is_muted": False,
            "is_deafened": False
        }
        
        try:
            # Отправка списка участников новому пользователю
            participants = []
            for uid, conn_info in voice_connections[voice_channel_id].items():
                if uid != user.id:
                    participants.append({
                        "user_id": uid,
                        "username": conn_info["username"],
                        "is_muted": conn_info["is_muted"],
                        "is_deafened": conn_info["is_deafened"]
                    })
            
            await websocket.send_json({
                "type": "participants",
                "participants": participants,
                "ice_servers": settings.ICE_SERVERS
            })
            
            # Уведомление других участников о новом пользователе
            join_message = {
                "type": "user_joined_voice",
                "user_id": user.id,
                "username": user.username
            }
            
            for uid, conn_info in voice_connections[voice_channel_id].items():
                if uid != user.id:
                    try:
                        await conn_info["websocket"].send_json(join_message)
                    except:
                        pass
            
            # Глобальное уведомление всем онлайн пользователям
            global_join_message = {
                "type": "voice_channel_join",
                "user_id": user.id,
                "username": user.username,
                "voice_channel_id": voice_channel_id,
                "voice_channel_name": voice_channel.name
            }
            await manager.broadcast_to_all(global_join_message)
            
            # Обработка сообщений WebRTC
            while True:
                data = await websocket.receive_json()
                
                if data["type"] == "offer":
                    # Пересылка offer целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[voice_channel_id]:
                        await voice_connections[voice_channel_id][target_id]["websocket"].send_json({
                            "type": "offer",
                            "from_id": user.id,
                            "offer": data["offer"]
                        })
                
                elif data["type"] == "answer":
                    # Пересылка answer целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[voice_channel_id]:
                        await voice_connections[voice_channel_id][target_id]["websocket"].send_json({
                            "type": "answer",
                            "from_id": user.id,
                            "answer": data["answer"]
                        })
                
                elif data["type"] == "ice_candidate":
                    # Пересылка ICE candidate целевому пользователю
                    target_id = data.get("target_id")
                    if target_id and target_id in voice_connections[voice_channel_id]:
                        await voice_connections[voice_channel_id][target_id]["websocket"].send_json({
                            "type": "ice_candidate",
                            "from_id": user.id,
                            "candidate": data["candidate"]
                        })
                
                elif data["type"] == "mute":
                    # Обновление статуса mute
                    is_muted = data.get("is_muted", False)
                    voice_connections[voice_channel_id][user.id]["is_muted"] = is_muted
                    
                    # Обновление в БД
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
                    
                    # Уведомление других участников
                    mute_message = {
                        "type": "user_muted",
                        "user_id": user.id,
                        "is_muted": is_muted
                    }
                    
                    for uid, conn_info in voice_connections[voice_channel_id].items():
                        if uid != user.id:
                            try:
                                await conn_info["websocket"].send_json(mute_message)
                            except:
                                pass
                
                elif data["type"] == "deafen":
                    # Обновление статуса deafen
                    is_deafened = data.get("is_deafened", False)
                    voice_connections[voice_channel_id][user.id]["is_deafened"] = is_deafened
                    
                    # Обновление в БД
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
                    
                    # Уведомление других участников
                    deafen_message = {
                        "type": "user_deafened",
                        "user_id": user.id,
                        "is_deafened": is_deafened
                    }
                    
                    for uid, conn_info in voice_connections[voice_channel_id].items():
                        if uid != user.id:
                            try:
                                await conn_info["websocket"].send_json(deafen_message)
                            except:
                                pass
                
                elif data["type"] == "speaking":
                    # Обработка информации о голосовой активности
                    is_speaking = data.get("is_speaking", False)
                    
                    # Уведомление других участников о голосовой активности
                    speaking_message = {
                        "type": "user_speaking",
                        "user_id": user.id,
                        "is_speaking": is_speaking
                    }
                    
                    for uid, conn_info in voice_connections[voice_channel_id].items():
                        if uid != user.id:
                            try:
                                await conn_info["websocket"].send_json(speaking_message)
                            except:
                                pass
        
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"Voice WebSocket error: {e}")
        finally:
            # Удаление из голосового канала
            if voice_channel_id in voice_connections and user.id in voice_connections[voice_channel_id]:
                del voice_connections[voice_channel_id][user.id]
                
                # Если канал пуст, удаляем его
                if not voice_connections[voice_channel_id]:
                    del voice_connections[voice_channel_id]
            
            # Удаление из БД
            await db.execute(
                delete(VoiceChannelUser).where(
                    and_(
                        VoiceChannelUser.voice_channel_id == voice_channel_id,
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
            
            if voice_channel_id in voice_connections:
                for uid, conn_info in voice_connections[voice_channel_id].items():
                    try:
                        await conn_info["websocket"].send_json(leave_message)
                    except:
                        pass
            
            # Глобальное уведомление всем онлайн пользователям
            global_leave_message = {
                "type": "voice_channel_leave",
                "user_id": user.id,
                "username": user.username,
                "voice_channel_id": voice_channel_id
            }
            await manager.broadcast_to_all(global_leave_message)