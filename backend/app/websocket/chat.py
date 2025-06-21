from fastapi import WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
from app.db.database import get_db, AsyncSessionLocal
from app.models import User, Message, TextChannel, ChannelMember
from app.schemas.message import MessageCreate, Message as MessageSchema
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user_ws
import asyncio

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
    """WebSocket эндпоинт для чата в текстовых каналах"""
    try:
        # Аутентификация пользователя
        user = await get_current_user_ws(token, db)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Подключение к WebSocket
        await manager.connect(websocket, user.id, channel_id)
        
        try:
            while True:
                # Получение сообщения от клиента
                data = await websocket.receive_text()
                message_data = json.loads(data)
                
                if message_data.get("type") == "message":
                    # Обработка текстового сообщения
                    content = message_data.get("content", "").strip()
                    text_channel_id = message_data.get("text_channel_id")
                    
                    if content and text_channel_id:
                        # Проверяем существование текстового канала
                        text_channel_result = await db.execute(
                            select(TextChannel).where(TextChannel.id == text_channel_id)
                        )
                        text_channel = text_channel_result.scalar_one_or_none()
                        
                        if text_channel:
                            # Создаем сообщение
                            db_message = Message(
                                content=content,
                                author_id=user.id,
                                text_channel_id=text_channel_id
                            )
                            db.add(db_message)
                            await db.commit()
                            await db.refresh(db_message)
                            
                            # Отправляем сообщение всем участникам канала
                            await manager.send_to_channel(channel_id, {
                                "type": "message",
                                "id": db_message.id,
                                "content": db_message.content,
                                "author": {
                                    "id": user.id,
                                    "username": user.username
                                },
                                "timestamp": db_message.created_at.isoformat(),
                                "text_channel_id": text_channel_id
                            })
                
                elif message_data.get("type") == "typing":
                    # Обработка индикатора печати
                    text_channel_id = message_data.get("text_channel_id")
                    if text_channel_id:
                        await manager.send_to_channel(channel_id, {
                            "type": "typing",
                            "user": {
                                "id": user.id,
                                "username": user.username
                            },
                            "text_channel_id": text_channel_id
                        })
                        
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"Ошибка в WebSocket чата: {e}")
        finally:
            await manager.disconnect(websocket, user.id, channel_id)
            
    except Exception as e:
        print(f"Ошибка подключения WebSocket чата: {e}")
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)


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