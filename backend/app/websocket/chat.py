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
        print(f"[WS_NOTIFICATIONS] Пользователь {user.username} подключился к уведомлениям")
        
        try:
            while True:
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                    message_data = json.loads(data)
                    
                    if message_data.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                        
                except asyncio.TimeoutError:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                    
        except WebSocketDisconnect:
            print(f"[WS_NOTIFICATIONS] Пользователь {user.username} отключился от уведомлений")
        except Exception as e:
            print(f"[WS_NOTIFICATIONS] Ошибка: {e}")
            
    except Exception as e:
        print(f"[WS_NOTIFICATIONS] Критическая ошибка подключения: {e}")
    finally:
        # Гарантированно отключаем и закрываем сессию
        if user:
            await manager.disconnect(websocket, user.id)
            print(f"[WS_NOTIFICATIONS] Пользователь {user.username} отключён от уведомлений")
            
        if db:
            await db.close()
            print("[WS_NOTIFICATIONS] Сессия БД закрыта")