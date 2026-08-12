from fastapi import WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
from app.db.database import get_db, AsyncSessionLocal
from app.models import User, Message, TextChannel, ChannelMember, Attachment, Reaction
from app.schemas.message import MessageCreate, Message as MessageSchema
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user_ws
from app.services import direct_message_service
from app.services.user_activity_service import user_activity_service
from app.services.text_channel_visibility import get_visible_text_channel
from app.services.slow_mode import check_slow_mode
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload
from app.services.mentions import notify_message_mentions
from app.services.message_notifications import notify_channel_message_activity
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.communication_safety import can_send_dm
from fastapi.encoders import jsonable_encoder
import asyncio
from datetime import timezone


async def get_user_by_token_ws(token: str, db: AsyncSession) -> User | None:
    """Получение пользователя по токену для WebSocket без создания новых сессий"""
    return await get_current_user_ws(token, db)


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
            print("[WS_CHAT] Неавторизованная попытка подключения")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Проверяем существование текстового канала
        text_channel = await get_visible_text_channel(db, text_channel_id)
        
        if not text_channel:
            print(f"[WS_CHAT] Текстовый канал с id={text_channel_id} не найден!")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        from app.services.channel_access import user_can_access_text_channel
        if not await user_can_access_text_channel(db, user, text_channel, need_send=False):
            print(f"[WS_CHAT] Нет доступа к каналу {text_channel_id} для user={user.id}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id, text_channel_id)
        # Обновляем активность пользователя
        await user_activity_service.update_user_activity(user.id, db)
        print(f"[WS_CHAT] Пользователь {user.username} (id={user.id}) подключился к текстовому каналу {text_channel_id}")
        
        try:
            while True:
                data = await websocket.receive_text()
                print(f"[WS_CHAT] Frame received from user_id={user.id}")
                
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

                    print(
                        f"[WS_CHAT] Message metadata: channel_id={msg_channel_id}, "
                        f"attachments={len(attachments)}, has_reply={reply_to_id is not None}"
                    )

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
                    if len(attachments) > 10:
                        print("[WS_CHAT] Отклонено: слишком много вложений")
                        continue

                    if not await user_can_access_text_channel(
                        db, user, text_channel, need_send=True
                    ):
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Нет права писать в этот канал",
                        }))
                        continue

                    allowed, retry_after, limit_message = enforce_message_antispam(
                        user.id,
                        dest_key=f"channel:{text_channel_id}",
                        content=content,
                    )
                    if not allowed:
                        await websocket.send_text(json.dumps(rate_limit_payload(
                            message=limit_message,
                            retry_after_seconds=retry_after,
                            scope="channel",
                            text_channel_id=text_channel_id,
                        )))
                        continue

                    allowed, retry_after = await check_slow_mode(db, text_channel, user)
                    if not allowed:
                        await websocket.send_text(json.dumps({
                            "type": "slow_mode",
                            "text_channel_id": text_channel_id,
                            "retry_after_seconds": retry_after,
                        }))
                        continue
                    
                    # Создаем сообщение
                    if reply_to_id:
                        reply_channel_id = await db.scalar(
                            select(Message.text_channel_id).where(Message.id == reply_to_id)
                        )
                        if reply_channel_id != text_channel_id:
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "code": "invalid_reply",
                                "message": "Reply target does not belong to this channel",
                            }))
                            continue

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
                        "reactions": [],  # Пока пустой массив, реакции будут добавляться позже
                        "reply_to": None if not full_message.reply_to else {
                            "id": full_message.reply_to.id,
                            "content": "Сообщение удалено" if full_message.reply_to.is_deleted else full_message.reply_to.content,
                            "is_deleted": full_message.reply_to.is_deleted,
                            "author": {
                                "id": full_message.reply_to.webhook_id or full_message.reply_to.author.id,
                                "username": full_message.reply_to.webhook_name if full_message.reply_to.webhook_id else (full_message.reply_to.author.display_name or full_message.reply_to.author.username),
                                "email": "",
                                "display_name": None if full_message.reply_to.webhook_id else full_message.reply_to.author.display_name,
                                "avatar_url": full_message.reply_to.webhook_avatar_url if full_message.reply_to.webhook_id else getattr(full_message.reply_to.author, 'avatar_url', None),
                                "is_webhook": full_message.reply_to.webhook_id is not None
                            }
                        }
                    }
                    
                    print(f"[WS_CHAT] Delivering message_id={full_message.id} to channel_id={text_channel_id}")
                    
                    # Отправляем сообщение всем подключенным к этому каналу
                    await manager.send_to_channel(text_channel_id, {
                        "type": "new_message",
                        "data": message_dict
                    })
                    await bot_event_dispatcher.dispatch_message_create(db, full_message)

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
                        await bot_event_dispatcher.dispatch_typing_start(db, text_channel_id, user.id)
                        
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
                    print(f"[WS_NOTIFICATIONS] Frame received from user_id={user.id}")

                    # Проверяем, что data является строкой перед парсингом
                    if not isinstance(data, str):
                        print(f"[WS_NOTIFICATIONS] Ошибка: полученные данные не являются строкой, тип: {type(data)}")
                        continue

                    try:
                        message_data = json.loads(data)
                    except json.JSONDecodeError as e:
                        print(f"[WS_NOTIFICATIONS] Invalid JSON: {e}")
                        continue

                    # Проверяем, что message_data является словарем
                    if not isinstance(message_data, dict):
                        print(f"[WS_NOTIFICATIONS] Invalid payload type: {type(message_data)}")
                        # Попробуем повторно распарсить, возможно это двойной JSON
                        try:
                            message_data = json.loads(message_data)
                            if not isinstance(message_data, dict):
                                print(f"[WS_NOTIFICATIONS] Повторный парсинг тоже вернул не словарь: {type(message_data)}")
                                continue
                            print(f"[WS_NOTIFICATIONS] Успешный повторный парсинг JSON")
                        except:
                            print(f"[WS_NOTIFICATIONS] Повторный парсинг тоже неудачен")
                            continue

                    if message_data.get("type") == "ping":
                        # Обновляем активность при ping
                        await user_activity_service.heartbeat_user(user.id, db)
                        await websocket.send_text(json.dumps({"type": "pong"}))



                    elif message_data.get("type") == "dm_message":
                        recipient_id = message_data.get("recipient_id")
                        content = message_data.get("content", "").strip()
                        attachments = message_data.get("attachments", [])
                        reply_to_id = message_data.get("reply_to_id")

                        # Валидация: должен быть либо контент, либо вложения
                        if (not content and not attachments) or not recipient_id:
                            continue
                        
                        # Ограничения
                        if len(content) > 5000 or len(attachments) > 10:
                            continue

                        dm_allowed, dm_error = await can_send_dm(db, user.id, int(recipient_id))
                        if not dm_allowed:
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "code": "dm_forbidden",
                                "message": dm_error or "Direct messages are unavailable",
                            }))
                            continue

                        allowed, retry_after, limit_message = enforce_message_antispam(
                            user.id,
                            dest_key=f"dm:{min(user.id, int(recipient_id))}:{max(user.id, int(recipient_id))}",
                            content=content,
                        )
                        if not allowed:
                            await websocket.send_text(json.dumps(rate_limit_payload(
                                message=limit_message,
                                retry_after_seconds=retry_after,
                                scope="dm",
                                recipient_id=int(recipient_id),
                            )))
                            continue

                        try:
                            db_message = await direct_message_service.create_message(
                                db,
                                sender_id=user.id,
                                recipient_id=recipient_id,
                                content=content if content else None,
                                attachments=attachments,
                                reply_to_id=reply_to_id,
                            )
                        except direct_message_service.DirectMessageReplyError:
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "code": "invalid_reply",
                                "message": "Reply target does not belong to this conversation",
                            }))
                            continue
                        
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
                            "data": jsonable_encoder(message_dict)
                        }

                        await manager.send_personal_message(message_to_send, recipient_id)
                        await manager.send_personal_message(message_to_send, user.id)

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
