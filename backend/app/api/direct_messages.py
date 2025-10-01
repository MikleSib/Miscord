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
