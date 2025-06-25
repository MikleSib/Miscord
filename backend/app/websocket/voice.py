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
    print(f"[VOICE_WS] 🎙️ Запрос подключения к голосовому каналу {channel_id}")
    
    # Создаем сессию базы данных вручную
    async with AsyncSessionLocal() as db:
        # Аутентификация
        print(f"[VOICE_WS] 🔐 Аутентификация пользователя...")
        user = await get_current_user_voice(websocket, token, db)
        if not user:
            print(f"[VOICE_WS] ❌ Аутентификация не удалась")
            return
        
        print(f"[VOICE_WS] ✅ Пользователь аутентифицирован: {user.username} (ID: {user.id})")
        
        # Проверка существования голосового канала
        print(f"[VOICE_WS] 🔍 Проверка существования голосового канала {channel_id}")
        voice_result = await db.execute(
            select(VoiceChannel).where(VoiceChannel.id == channel_id)
        )
        voice_channel = voice_result.scalar_one_or_none()
        
        if not voice_channel:
            print(f"[VOICE_WS] ❌ Голосовой канал {channel_id} не найден")
            await websocket.close(code=4004, reason="Voice channel not found")
            return
        
        print(f"[VOICE_WS] ✅ Голосовой канал найден: {voice_channel.name} (лимит: {voice_channel.max_users})")
        
        # Убираем проверку членства - все пользователи могут заходить в любые каналы
        
        # Проверка лимита пользователей
        print(f"[VOICE_WS] 👥 Проверка лимита пользователей...")
        active_users_result = await db.execute(
            select(VoiceChannelUser).where(
                VoiceChannelUser.voice_channel_id == channel_id
            )
        )
        active_users = active_users_result.scalars().all()
        print(f"[VOICE_WS] 📊 Активных пользователей в канале: {len(active_users)}/{voice_channel.max_users}")
        
        if len(active_users) >= voice_channel.max_users:
            print(f"[VOICE_WS] ❌ Канал переполнен ({len(active_users)}/{voice_channel.max_users})")
            await websocket.close(code=4005, reason="Voice channel is full")
            return
        
        print(f"[VOICE_WS] 🤝 Принимаем WebSocket соединение...")
        await websocket.accept()
        print(f"[VOICE_WS] ✅ WebSocket соединение установлено для пользователя {user.username}")
        
        # Добавление в голосовой канал в БД
        print(f"[VOICE_WS] 💾 Добавляем пользователя {user.username} в БД голосового канала")
        voice_user = VoiceChannelUser(
            voice_channel_id=channel_id,
            user_id=user.id
        )
        db.add(voice_user)
        await db.commit()
        print(f"[VOICE_WS] ✅ Пользователь добавлен в БД голосового канала")
        
        # Инициализация хранилища для канала
        if channel_id not in voice_connections:
            voice_connections[channel_id] = {}
            print(f"[VOICE_WS] 🆕 Создано новое хранилище соединений для канала {channel_id}")
        
        voice_connections[channel_id][user.id] = {
            "websocket": websocket,
            "user_id": user.id,
            "username": user.display_name or user.username,
            "is_muted": False,
            "is_deafened": False
        }
        print(f"[VOICE_WS] 📝 Пользователь {user.username} добавлен в локальное хранилище соединений")
        
        try:
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
                        "is_deafened": conn_info["is_deafened"]
                    })
            
            print(f"[VOICE_WS] 👥 Отправляем список из {len(participants)} участников пользователю {user.username}")
            await websocket.send_json({
                "type": "participants",
                "participants": participants,
                "ice_servers": settings.ICE_SERVERS
            })
            print(f"[VOICE_WS] ✅ Список участников отправлен")
            
            # Уведомление других участников о новом пользователе
            join_message = {
                "type": "user_joined_voice",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url
            }
            
            notification_count = 0
            for uid, conn_info in voice_connections[channel_id].items():
                if uid != user.id:
                    try:
                        await conn_info["websocket"].send_json(join_message)
                        notification_count += 1
                        print(f"[VOICE_WS] 📤 Уведомление о присоединении отправлено пользователю {uid}")
                    except Exception as e:
                        print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления пользователю {uid}: {e}")
            
            print(f"[VOICE_WS] ✅ Уведомления о присоединении отправлены {notification_count} пользователям")
            
            # Глобальное уведомление всем онлайн пользователям
            global_join_message = {
                "type": "voice_channel_join",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "voice_channel_id": channel_id,
                "voice_channel_name": voice_channel.name
            }
            await manager.broadcast_to_all(global_join_message)
            print(f"[VOICE_WS] 📢 Глобальное уведомление о присоединении к каналу отправлено")
            
            # Обработка сообщений WebRTC
            print(f"[VOICE_WS] 🔄 Начинаем обработку WebRTC сообщений для {user.username}")
            while True:
                try:
                    data = await websocket.receive_json()
                    print(f"[VOICE_WS] 📨 Получено сообщение от {user.username}: {data.get('type', 'unknown')}")
                    
                    if data["type"] == "offer":
                        target_id = data.get("target_id")
                        print(f"[VOICE_WS] 📞 Обрабатываем offer от {user.id} для {target_id}")
                        # Пересылка offer целевому пользователю
                        if target_id and target_id in voice_connections[channel_id]:
                            await voice_connections[channel_id][target_id]["websocket"].send_json({
                                "type": "offer",
                                "from_id": user.id,
                                "offer": data["offer"]
                            })
                            print(f"[VOICE_WS] ✅ Offer переслан от {user.id} к {target_id}")
                        else:
                            print(f"[VOICE_WS] ⚠️ Целевой пользователь {target_id} не найден для offer")
                    
                    elif data["type"] == "answer":
                        target_id = data.get("target_id")
                        print(f"[VOICE_WS] 📞 Обрабатываем answer от {user.id} для {target_id}")
                        # Пересылка answer целевому пользователю
                        if target_id and target_id in voice_connections[channel_id]:
                            await voice_connections[channel_id][target_id]["websocket"].send_json({
                                "type": "answer",
                                "from_id": user.id,
                                "answer": data["answer"]
                            })
                            print(f"[VOICE_WS] ✅ Answer переслан от {user.id} к {target_id}")
                        else:
                            print(f"[VOICE_WS] ⚠️ Целевой пользователь {target_id} не найден для answer")
                    
                    elif data["type"] == "ice_candidate":
                        target_id = data.get("target_id")
                        print(f"[VOICE_WS] 🧊 Обрабатываем ICE candidate от {user.id} для {target_id}")
                        # Пересылка ICE candidate целевому пользователю
                        if target_id and target_id in voice_connections[channel_id]:
                            await voice_connections[channel_id][target_id]["websocket"].send_json({
                                "type": "ice_candidate",
                                "from_id": user.id,
                                "candidate": data["candidate"]
                            })
                            print(f"[VOICE_WS] ✅ ICE candidate переслан от {user.id} к {target_id}")
                        else:
                            print(f"[VOICE_WS] ⚠️ Целевой пользователь {target_id} не найден для ICE candidate")
                    
                    elif data["type"] == "mute":
                        # Обновление статуса mute
                        is_muted = data.get("is_muted", False)
                        print(f"[VOICE_WS] 🔇 Пользователь {user.username} изменил статус микрофона: {'заглушен' if is_muted else 'включен'}")
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
                            print(f"[VOICE_WS] 💾 Статус микрофона обновлен в БД")
                        
                        # Уведомление других участников
                        mute_message = {
                            "type": "user_muted",
                            "user_id": user.id,
                            "is_muted": is_muted
                        }
                        
                        notification_count = 0
                        for uid, conn_info in voice_connections[channel_id].items():
                            if uid != user.id:
                                try:
                                    await conn_info["websocket"].send_json(mute_message)
                                    notification_count += 1
                                except Exception as e:
                                    print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления о mute пользователю {uid}: {e}")
                        
                        print(f"[VOICE_WS] ✅ Уведомления о изменении микрофона отправлены {notification_count} пользователям")
                    
                    elif data["type"] == "deafen":
                        # Обновление статуса deafen
                        is_deafened = data.get("is_deafened", False)
                        print(f"[VOICE_WS] 🔇 Пользователь {user.username} изменил статус наушников: {'заглушены' if is_deafened else 'включены'}")
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
                            print(f"[VOICE_WS] 💾 Статус наушников обновлен в БД")
                        
                        # Уведомление других участников
                        deafen_message = {
                            "type": "user_deafened",
                            "user_id": user.id,
                            "is_deafened": is_deafened
                        }
                        
                        notification_count = 0
                        for uid, conn_info in voice_connections[channel_id].items():
                            if uid != user.id:
                                try:
                                    await conn_info["websocket"].send_json(deafen_message)
                                    notification_count += 1
                                except Exception as e:
                                    print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления о deafen пользователю {uid}: {e}")
                        
                        print(f"[VOICE_WS] ✅ Уведомления о изменении наушников отправлены {notification_count} пользователям")
                    
                    elif data["type"] == "speaking":
                        # Обработка информации о голосовой активности
                        is_speaking = data.get("is_speaking", False)
                        print(f"[VOICE_WS] 🗣️ Пользователь {user.username} {'говорит' if is_speaking else 'замолчал'}")
                        
                        # Уведомление других участников о голосовой активности
                        speaking_message = {
                            "type": "user_speaking",
                            "user_id": user.id,
                            "is_speaking": is_speaking
                        }
                        
                        notification_count = 0
                        for uid, conn_info in voice_connections[channel_id].items():
                            if uid != user.id:
                                try:
                                    await conn_info["websocket"].send_json(speaking_message)
                                    notification_count += 1
                                except Exception as e:
                                    print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления о speaking пользователю {uid}: {e}")
                        
                        # Не логируем каждое уведомление для speaking, так как их много
                    
                    elif data["type"] == "screen_share_start":
                        print(f"[VOICE_WS] 🖥️ Пользователь {user.username} начал демонстрацию экрана")
                        # Уведомляем всех участников канала о начале демонстрации экрана
                        screen_share_message = {
                            "type": "screen_share_started",
                            "user_id": user.id,
                            "username": user.display_name or user.username
                        }
                        
                        notification_count = 0
                        for uid, conn_info in voice_connections[channel_id].items():
                            if uid != user.id:
                                try:
                                    await conn_info["websocket"].send_json(screen_share_message)
                                    notification_count += 1
                                except Exception as e:
                                    print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления о начале демонстрации пользователю {uid}: {e}")
                        
                        print(f"[VOICE_WS] ✅ Уведомления о начале демонстрации экрана отправлены {notification_count} пользователям")
                    
                    elif data["type"] == "screen_share_stop":
                        print(f"[VOICE_WS] 🖥️ Пользователь {user.username} остановил демонстрацию экрана")
                        # Уведомляем всех участников канала об остановке демонстрации экрана
                        screen_share_message = {
                            "type": "screen_share_stopped",
                            "user_id": user.id,
                            "username": user.display_name or user.username
                        }
                        
                        notification_count = 0
                        for uid, conn_info in voice_connections[channel_id].items():
                            if uid != user.id:
                                try:
                                    await conn_info["websocket"].send_json(screen_share_message)
                                    notification_count += 1
                                except Exception as e:
                                    print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления об остановке демонстрации пользователю {uid}: {e}")
                        
                        print(f"[VOICE_WS] ✅ Уведомления об остановке демонстрации экрана отправлены {notification_count} пользователям")
                    
                    else:
                        print(f"[VOICE_WS] ❓ Неизвестный тип сообщения от {user.username}: {data['type']}")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Неизвестный тип сообщения: {data['type']}"
                        }))
                
                except json.JSONDecodeError as e:
                    print(f"[VOICE_WS] ❌ Ошибка парсинга JSON от {user.username}: {e}")
                except Exception as e:
                    print(f"[VOICE_WS] ❌ Ошибка обработки сообщения от {user.username}: {e}")
                    break
        
        except WebSocketDisconnect:
            print(f"[VOICE_WS] 🔌 Пользователь {user.username} отключился от голосового канала {channel_id}")
        except Exception as e:
            print(f"[VOICE_WS] ❌ Ошибка в голосовом WebSocket для {user.username}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            print(f"[VOICE_WS] 🧹 Начинаем cleanup для пользователя {user.username}")
            
            # Удаление из голосового канала
            if channel_id in voice_connections and user.id in voice_connections[channel_id]:
                del voice_connections[channel_id][user.id]
                print(f"[VOICE_WS] 🗑️ Пользователь {user.username} удален из локального хранилища")
                
                # Если канал пуст, удаляем его
                if not voice_connections[channel_id]:
                    del voice_connections[channel_id]
                    print(f"[VOICE_WS] 🗑️ Хранилище канала {channel_id} удалено (нет активных пользователей)")
            
            # Удаление из БД
            try:
                await db.execute(
                    delete(VoiceChannelUser).where(
                        and_(
                            VoiceChannelUser.voice_channel_id == channel_id,
                            VoiceChannelUser.user_id == user.id
                        )
                    )
                )
                await db.commit()
                print(f"[VOICE_WS] 💾 Пользователь {user.username} удален из БД голосового канала")
            except Exception as e:
                print(f"[VOICE_WS] ❌ Ошибка удаления из БД: {e}")
            
            # Уведомление других участников об уходе
            leave_message = {
                "type": "user_left_voice",
                "user_id": user.id
            }
            
            notification_count = 0
            if channel_id in voice_connections:
                for uid, conn_info in voice_connections[channel_id].items():
                    try:
                        await conn_info["websocket"].send_json(leave_message)
                        notification_count += 1
                    except Exception as e:
                        print(f"[VOICE_WS] ⚠️ Ошибка отправки уведомления о выходе пользователю {uid}: {e}")
            
            print(f"[VOICE_WS] ✅ Уведомления о выходе отправлены {notification_count} пользователям")
            
            # Глобальное уведомление всем онлайн пользователям
            global_leave_message = {
                "type": "voice_channel_leave",
                "user_id": user.id,
                "username": user.display_name or user.username,
                "voice_channel_id": channel_id
            }
            await manager.broadcast_to_all(global_leave_message)
            print(f"[VOICE_WS] 📢 Глобальное уведомление о выходе из канала отправлено")
            print(f"[VOICE_WS] ✅ Cleanup завершен для пользователя {user.username}")