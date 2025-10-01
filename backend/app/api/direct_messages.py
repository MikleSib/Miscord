from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.schemas.message import Message as MessageSchema, MessageCreate
from app.services import direct_message_service
from app.websocket.connection_manager import manager

router = APIRouter()

@router.get("/dm/{friend_id}", response_model=List[MessageSchema])
async def get_direct_messages(
    friend_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get message history with a friend.
    """
    return await direct_message_service.get_messages(db, user1_id=current_user.id, user2_id=friend_id)

@router.post("/dm/{friend_id}", response_model=MessageSchema)
async def send_direct_message(
    friend_id: int,
    message: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a direct message to a friend.
    """
    db_message = await direct_message_service.create_message(
        db, sender_id=current_user.id, recipient_id=friend_id, content=message.content
    )

    # Отправка сообщения через WebSocket
    await manager.send_personal_message(
        {
            "type": "dm",
            "data": {
                "id": db_message.id,
                "content": db_message.content,
                "timestamp": db_message.timestamp.isoformat(),
                "sender_id": db_message.sender_id,
                "recipient_id": db_message.recipient_id,
                "sender_username": current_user.username
            }
        },
        friend_id
    )

    return db_message
