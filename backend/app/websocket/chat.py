from fastapi import WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
from app.db.database import get_db
from app.models import User, Message, TextChannel, ChannelMember
from app.schemas.message import MessageCreate, Message as MessageSchema
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager

async def get_current_user_ws(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Получение текущего пользователя для WebSocket"""
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

async def websocket_chat_endpoint(
    websocket: WebSocket,
    channel_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """WebSocket эндпоинт для чата"""
    # Аутентификация
    user = await get_current_user_ws(websocket, token, db)
    if not user:
        return
    
    # Проверка членства в канале
    member_result = await db.execute(
        select(ChannelMember).where(
            (ChannelMember.channel_id == channel_id) &
            (ChannelMember.user_id == user.id)
        )
    )
    if not member_result.scalar_one_or_none():
        await websocket.close(code=4003, reason="Not a member of this channel")
        return
    
    # Подключение к менеджеру соединений
    await manager.connect(websocket, user.id, channel_id)
    
    try:
        # Обновление статуса пользователя
        user.is_online = True
        await db.commit()
        
        while True:
            # Получение сообщения от клиента
            data = await websocket.receive_json()
            
            if data["type"] == "message":
                # Создание нового сообщения
                text_channel_id = data.get("text_channel_id")
                content = data.get("content")
                
                if not text_channel_id or not content:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid message data"
                    })
                    continue
                
                # Проверка существования текстового канала
                text_channel_result = await db.execute(
                    select(TextChannel).where(
                        (TextChannel.id == text_channel_id) &
                        (TextChannel.channel_id == channel_id)
                    )
                )
                text_channel = text_channel_result.scalar_one_or_none()
                
                if not text_channel:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Text channel not found"
                    })
                    continue
                
                # Создание сообщения в БД
                new_message = Message(
                    content=content,
                    author_id=user.id,
                    text_channel_id=text_channel_id
                )
                db.add(new_message)
                await db.commit()
                await db.refresh(new_message)
                
                # Загрузка автора для отправки
                result = await db.execute(
                    select(Message)
                    .where(Message.id == new_message.id)
                    .options(selectinload(Message.author))
                )
                message_with_author = result.scalar_one()
                
                # Подготовка данных для отправки
                message_data = {
                    "type": "new_message",
                    "message": {
                        "id": message_with_author.id,
                        "content": message_with_author.content,
                        "author_id": message_with_author.author_id,
                        "text_channel_id": message_with_author.text_channel_id,
                        "created_at": message_with_author.created_at.isoformat(),
                        "is_edited": message_with_author.is_edited,
                        "author": {
                            "id": message_with_author.author.id,
                            "username": message_with_author.author.username,
                            "is_online": message_with_author.author.is_online
                        }
                    }
                }
                
                # Рассылка сообщения всем в канале
                await manager.broadcast_to_channel(channel_id, message_data)
            
            elif data["type"] == "typing":
                # Уведомление о наборе текста
                text_channel_id = data.get("text_channel_id")
                typing_data = {
                    "type": "user_typing",
                    "user_id": user.id,
                    "username": user.username,
                    "text_channel_id": text_channel_id
                }
                await manager.broadcast_to_channel(channel_id, typing_data)
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Отключение от менеджера
        await manager.disconnect(user.id, channel_id)
        
        # Обновление статуса пользователя
        user.is_online = False
        await db.commit()