from fastapi import WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
from app.db.database import get_db, AsyncSessionLocal
from app.models import User, Message, TextChannel, ChannelMember, Attachment
from app.schemas.message import MessageCreate, Message as MessageSchema
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user_ws
import asyncio



async def websocket_chat_endpoint(
    websocket: WebSocket,
    server_channel_id: int, # Переименовано для ясности
    token: str = Query(...),
):
    """WebSocket эндпоинт для чата в текстовых каналах"""
    async with AsyncSessionLocal() as db:
        user = await get_current_user_ws(token, db)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id, server_channel_id)
        
        try:
            while True:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                
                if message_data.get("type") == "message":
                    content = message_data.get("content", "").strip()
                    text_channel_id = message_data.get("text_channel_id")
                    attachments = message_data.get("attachments", [])

                    # Валидация
                    if not content and not attachments:
                        # Игнорируем или отправляем ошибку
                        continue 
                    if len(content) > 5000:
                        # Игнорируем или отправляем ошибку
                        continue
                    if len(attachments) > 3:
                        # Игнорируем или отправляем ошибку
                        continue
                    
                    text_channel_result = await db.execute(
                        select(TextChannel).where(TextChannel.id == text_channel_id)
                    )
                    text_channel = text_channel_result.scalar_one_or_none()
                    
                    if text_channel:
                        # Создаем сообщение
                        db_message = Message(
                            content=content if content else None,
                            author_id=user.id,
                            text_channel_id=text_channel_id,
                        )
                        
                        # Добавляем вложения
                        for url in attachments:
                            db_message.attachments.append(Attachment(file_url=url))

                        db.add(db_message)
                        await db.commit()
                        await db.refresh(db_message)
                        
                        # Загружаем связанные данные для схемы
                        await db.execute(
                           select(Message).where(Message.id == db_message.id).options(
                               selectinload(Message.author), 
                               selectinload(Message.attachments)
                           )
                        )
                        
                        message_schema = MessageSchema.from_orm(db_message)
                        
                        # Отправляем сообщение всем участникам сервера
                        await manager.broadcast_to_all({
                            "type": "new_message",
                            "data": message_schema.dict()
                        })
                
                elif message_data.get("type") == "typing":
                    text_channel_id = message_data.get("text_channel_id")
                    if text_channel_id:
                        await manager.broadcast_to_all({
                            "type": "typing",
                            "user": {
                                "id": user.id,
                                "username": user.username
                            },
                            "text_channel_id": text_channel_id
                        })
                        
        except WebSocketDisconnect:
            pass # Просто выходим из цикла
        except Exception as e:
            print(f"Ошибка в WebSocket чата: {e}")
        finally:
            await manager.disconnect(websocket, user.id, server_channel_id)
            

async def websocket_notifications_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """WebSocket эндпоинт для уведомлений (приглашения, синхронизация)"""
    async with AsyncSessionLocal() as db:
        try:
            # Аутентификация пользователя
            user = await get_current_user_ws(token, db)
            if not user:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Подключение к WebSocket (без привязки к каналу)
            await manager.connect(websocket, user.id)
            
            try:
                while True:
                    # Ожидаем сообщения от клиента (например, keepalive)
                    try:
                        data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                        message_data = json.loads(data)
                        
                        if message_data.get("type") == "ping":
                            await websocket.send_text(json.dumps({"type": "pong"}))
                            
                    except asyncio.TimeoutError:
                        # Отправляем ping для поддержания соединения
                        await websocket.send_text(json.dumps({"type": "ping"}))
                        
            except WebSocketDisconnect:
                pass
            except Exception as e:
                print(f"Ошибка в WebSocket уведомлений: {e}")
            finally:
                await manager.disconnect(websocket, user.id)
                
        except Exception as e:
            print(f"Ошибка подключения WebSocket уведомлений: {e}")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)