from fastapi import WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
from app.db.database import get_db, AsyncSessionLocal
from app.models import User, Message, TextChannel, ChannelMember, Attachment, Reaction
from app.schemas.message import MessageCreate, Message as MessageSchema
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user_ws
from app.services import direct_message_service
from app.services.user_activity_service import user_activity_service
from fastapi.encoders import jsonable_encoder
import asyncio
from datetime import timezone


async def get_user_by_token_ws(token: str, db: AsyncSession) -> User | None:
    """Получение пользователя по токену для WebSocket без создания новых сессий"""
    try:
        payload = decode_access_token(token)
        if payload is None:
            return None
        
        user_id = payload.get("sub")
        if user_id is None:
            return None

        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        return user if user and user.is_active else None
    except Exception as e:
        print(f"[WS_AUTH] Ошибка получения пользователя: {e}")
        return None


async def websocket_chat_endpoint(
    websocket: WebSocket,
    text_channel_id: int,
    token: str = Query(...),
):
    """WebSocket эндпоинт для чата в текстовых каналах"""
    db = None
    user = None
    
    try:
        # Создаем единственную сессию для всего соединения
        db = AsyncSessionLocal()
        
        user = await get_user_by_token_ws(token, db)
        if not user:
            print(f"[WS_CHAT] Неавторизованная попытка подключения с токеном {token[:20]}...")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Проверяем существование текстового канала
        text_channel_result = await db.execute(
            select(TextChannel).where(TextChannel.id == text_channel_id)
        )
        text_channel = text_channel_result.scalar_one_or_none()
        
        if not text_channel:
            print(f"[WS_CHAT] Текстовый канал с id={text_channel_id} не найден!")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id, text_channel_id)
        # Обновляем активность пользователя
        await user_activity_service.update_user_activity(user.id, db)
        print(f"[WS_CHAT] Пользователь {user.username} (id={user.id}) подключился к текстовому каналу {text_channel_id}")
        
        try:
            while True:
                data = await websocket.receive_text()
                print(f"[WS_CHAT] Получено сообщение от {user.username}: {data}")
                
                try:
                    message_data = json.loads(data)
                except json.JSONDecodeError as e:
                    print(f"[WS_CHAT] Ошибка парсинга JSON: {e}")
                    continue
                
                if message_data.get("type") == "message":
                    # Обновляем активность пользователя при отправке сообщения
                    await user_activity_service.update_user_activity(user.id, db)
                    
                    content = message_data.get("content", "").strip()
                    msg_channel_id = message_data.get("text_channel_id")
                    attachments = message_data.get("attachments", [])
                    reply_to_id = message_data.get("reply_to_id")

                    print(f"[WS_CHAT] Обработка сообщения: content='{content}', msg_channel_id={msg_channel_id}, attachments={len(attachments)} файлов, reply_to={reply_to_id}")

                    # Проверяем, что сообщение для этого канала
                    if msg_channel_id != text_channel_id:
                        print(f"[WS_CHAT] Сообщение для канала {msg_channel_id}, но подключен к {text_channel_id}")
                        continue

                    # Валидация
                    if not content and not attachments:
                        print("[WS_CHAT] Отклонено: пустое сообщение")
                        continue 
                    if len(content) > 5000:
                        print("[WS_CHAT] Отклонено: слишком длинное сообщение")
                        continue
                    if len(attachments) > 3:
                        print("[WS_CHAT] Отклонено: слишком много вложений")
                        continue
                    
                    # Создаем сообщение
                    db_message = Message(
                        content=content if content else None,
                        author_id=user.id,
                        text_channel_id=text_channel_id,  # Используем канал подключения
                        reply_to_id=reply_to_id if reply_to_id else None,
                    )
                    
                    # Добавляем вложения
                    for url in attachments:
                        attachment = Attachment(file_url=url)
                        db_message.attachments.append(attachment)

                    db.add(db_message)
                    await db.commit()
                    await db.refresh(db_message)
                    print(f"[WS_CHAT] Сообщение сохранено в БД: id={db_message.id}")
                    
                    # Загружаем полные данные сообщения со связями
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
                    
                    # Создаем схему для отправки
                    message_dict = {
                        "id": full_message.id,
                        "content": full_message.content,
                        "channelId": full_message.text_channel_id,  # Важно: channelId для фронта
                        "timestamp": full_message.timestamp.replace(tzinfo=timezone.utc).isoformat(),
                        "is_edited": full_message.is_edited,
                        "is_deleted": full_message.is_deleted,
                        "author": {
                            "id": full_message.author.id,
                            "username": full_message.author.display_name or full_message.author.username,
                            "email": full_message.author.email,
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
                        "reactions": [],  # Пока пустой массив, реакции будут добавляться позже
                        "reply_to": None if not full_message.reply_to else {
                            "id": full_message.reply_to.id,
                            "content": "Сообщение удалено" if full_message.reply_to.is_deleted else full_message.reply_to.content,
                            "is_deleted": full_message.reply_to.is_deleted,
                            "author": {
                                "id": full_message.reply_to.author.id,
                                "username": full_message.reply_to.author.display_name or full_message.reply_to.author.username,
                                "email": full_message.reply_to.author.email,
                                "display_name": full_message.reply_to.author.display_name,
                                "avatar_url": getattr(full_message.reply_to.author, 'avatar_url', None)
                            }
                        }
                    }
                    
                    print(f"[WS_CHAT] Отправка сообщения в канал {text_channel_id}: {message_dict}")
                    
                    # Отправляем сообщение всем подключенным к этому каналу
                    await manager.send_to_channel(text_channel_id, {
                        "type": "new_message",
                        "data": message_dict
                    })
                    
                elif message_data.get("type") == "typing":
                    # Обновляем активность при печати
                    await user_activity_service.update_user_activity(user.id, db)
                    
                    msg_channel_id = message_data.get("text_channel_id")
                    if msg_channel_id == text_channel_id:
                        print(f"[WS_CHAT] Статус печати от {user.username} в канал {text_channel_id}")
                        await manager.send_to_channel(text_channel_id, {
                            "type": "typing",
                            "user": {
                                "id": user.id,
                                "username": user.display_name or user.username
                            },
                            "text_channel_id": text_channel_id
                        })
                        
                elif message_data.get("type") == "heartbeat":
                    # Heartbeat для поддержания активности
                    await user_activity_service.heartbeat_user(user.id, db)
                    await websocket.send_text(json.dumps({"type": "heartbeat_ack"}))

                    
                else:
                    print(f"[WS_CHAT] Неизвестный тип сообщения: {message_data.get('type')}")
                        
        except WebSocketDisconnect:
            print(f"[WS_CHAT] Пользователь {user.username} отключился от чата")
        except Exception as e:
            print(f"[WS_CHAT] Ошибка в чате: {e}")
            import traceback
            traceback.print_exc()
            
    except Exception as e:
        print(f"[WS_CHAT] Критическая ошибка: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Гарантированно отключаем и закрываем сессию
        if user:
            await manager.disconnect(websocket, user.id, text_channel_id)
            # Проверяем, есть ли у пользователя другие активные соединения
            if not manager.is_user_connected(user.id):
                # Если нет других соединений, устанавливаем пользователя как оффлайн
                await user_activity_service.set_user_offline(user.id, db)
            print(f"[WS_CHAT] Пользователь {user.username} отключён от текстового канала {text_channel_id}")
        
        if db:
            await db.close()
            print("[WS_CHAT] Сессия БД закрыта")


async def websocket_notifications_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """WebSocket эндпоинт для уведомлений (приглашения, синхронизация)"""
    db = None
    user = None
    
    try:
        # Создаем единственную сессию для всего соединения  
        db = AsyncSessionLocal()
        
        user = await get_user_by_token_ws(token, db)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id)
        # Обновляем активность пользователя
        await user_activity_service.update_user_activity(user.id, db)
        print(f"[WS_NOTIFICATIONS] Пользователь {user.username} подключился к уведомлениям")
        
        try:
            while True:
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                    print(f"[WS_NOTIFICATIONS] Получено сообщение от {user.username}: {data}")
                    message_data = json.loads(data)
                    
                    if message_data.get("type") == "ping":
                        # Обновляем активность при ping
                        await user_activity_service.heartbeat_user(user.id, db)
                        await websocket.send_text(json.dumps({"type": "pong"}))



                    elif message_data.get("type") == "dm_message":
                        recipient_id = message_data.get("recipient_id")
                        content = message_data.get("content", "").strip()

                        if not content or not recipient_id:
                            continue

                        db_message = await direct_message_service.create_message(
                            db, sender_id=user.id, recipient_id=recipient_id, content=content
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
                                "email": author.email,
                                "display_name": author.display_name,
                                "avatar_url": author.avatar_url,
                                "is_active": author.is_active,
                                "is_online": author.is_online,
                                "created_at": author.created_at,
                                "updated_at": author.updated_at,
                            },
                            "attachments": [],
                            "reactions": [],
                        }
                        
                        message_to_send = {
                            "type": "dm",
                            "data": jsonable_encoder(message_dict)
                        }

                        await manager.send_personal_message(message_to_send, recipient_id)
                        await manager.send_personal_message(message_to_send, user.id)

                    elif message_data.get("type") == "p2p-initiate-call":
                        recipient_id = message_data.get("to")
                        if recipient_id:
                            print(f"[P2P] Инициация звонка от {user.username} (id={user.id}) к пользователю {recipient_id}")
                            # Получаем данные пользователя для отправки получателю
                            caller_info = {
                                "id": user.id,
                                "username": user.username,
                                "display_name": user.display_name,
                                "avatar_url": user.avatar_url,
                            }
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-incoming-call",
                                    "caller": caller_info,
                                },
                                recipient_id
                            )
                            print(f"[P2P] Сообщение отправлено пользователю {recipient_id}")

                    elif message_data.get("type") == "p2p-call-accept":
                        caller_id = message_data.get("caller_id")
                        if caller_id:
                            # Уведомляем обоих пользователей, что звонок принят
                            # и они могут начинать обмен WebRTC сигналами
                            recipient_info = {
                                "id": user.id,
                                "username": user.username,
                                "display_name": user.display_name,
                                "avatar_url": user.avatar_url,
                            }
                            # Отправляем подтверждение звонящему
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-call-accepted",
                                    "recipient": recipient_info,
                                },
                                caller_id
                            )
                            # Отправляем подтверждение принимающему
                            # Это может быть избыточно, но полезно для синхронизации состояния на клиенте
                            caller_info = message_data.get("caller_info", {}) # Предполагается, что клиент может передать инфо
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-call-accepted-by-you",
                                    "caller": caller_info
                                },
                                user.id
                            )

                    elif message_data.get("type") == "p2p-call-decline":
                        caller_id = message_data.get("caller_id")
                        if caller_id:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-call-declined",
                                    "recipient_id": user.id,
                                },
                                caller_id
                            )

                    elif message_data.get("type") == "p2p-call-hangup":
                        recipient_id = message_data.get("recipient_id")
                        if recipient_id:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-call-ended",
                                    "sender_id": user.id,
                                },
                                recipient_id
                            )

                    elif message_data.get("type") == "call_offer":
                        recipient_id = message_data.get("recipient_id")
                        signal = message_data.get("signal")
                        if recipient_id and signal:
                            await manager.send_personal_message(
                                {
                                    "type": "call_offer",
                                    "sender_id": user.id,
                                    "signal": signal,
                                },
                                recipient_id,
                            )
                    elif message_data.get("type") == "call_answer":
                        recipient_id = message_data.get("recipient_id")
                        signal = message_data.get("signal")
                        if recipient_id and signal:
                            await manager.send_personal_message(
                                {
                                    "type": "call_answer",
                                    "sender_id": user.id,
                                    "signal": signal,
                                },
                                recipient_id,
                            )
                    elif message_data.get("type") == "ice_candidate":
                        recipient_id = message_data.get("recipient_id")
                        candidate = message_data.get("candidate")
                        if recipient_id and candidate:
                            await manager.send_personal_message(
                                {
                                    "type": "ice_candidate",
                                    "sender_id": user.id,
                                    "candidate": candidate,
                                },
                                recipient_id,
                            )

                    # P2P WebRTC signaling messages
                    elif message_data.get("type") == "p2p-offer":
                        recipient_id = message_data.get("to")
                        offer = message_data.get("offer")
                        if recipient_id and offer:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-offer",
                                    "from": user.id,
                                    "offer": offer,
                                },
                                recipient_id,
                            )

                    elif message_data.get("type") == "p2p-answer":
                        recipient_id = message_data.get("to")
                        answer = message_data.get("answer")
                        if recipient_id and answer:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-answer",
                                    "from": user.id,
                                    "answer": answer,
                                },
                                recipient_id,
                            )

                    elif message_data.get("type") == "p2p-ice-candidate":
                        recipient_id = message_data.get("to")
                        candidate = message_data.get("candidate")
                        if recipient_id and candidate:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-ice-candidate",
                                    "from": user.id,
                                    "candidate": candidate,
                                },
                                recipient_id,
                            )

                    elif message_data.get("type") == "p2p-hang-up":
                        recipient_id = message_data.get("to")
                        if recipient_id:
                            await manager.send_personal_message(
                                {
                                    "type": "p2p-call-ended",
                                },
                                recipient_id,
                            )
                        
                except asyncio.TimeoutError:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                    
        except WebSocketDisconnect:
            print(f"[WS_NOTIFICATIONS] Пользователь {user.username} отключился от уведомлений")
        except Exception as e:
            print(f"[WS_NOTIFICATIONS] Ошибка: {e}")
            import traceback
            traceback.print_exc()
            
    except Exception as e:
        print(f"[WS_NOTIFICATIONS] Критическая ошибка подключения: {e}")
    finally:
        # Гарантированно отключаем и закрываем сессию
        if user:
            await manager.disconnect(websocket, user.id)
            # Проверяем, есть ли у пользователя другие активные соединения
            if not manager.is_user_connected(user.id):
                # Если нет других соединений, устанавливаем пользователя как оффлайн
                await user_activity_service.set_user_offline(user.id, db)
            print(f"[WS_NOTIFICATIONS] Пользователь {user.username} отключён от уведомлений")
            
        if db:
            await db.close()
            print("[WS_NOTIFICATIONS] Сессия БД закрыта")
