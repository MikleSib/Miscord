from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.schemas.message import Message as MessageSchema, MessageCreate, DirectMessageSchema
from app.services import direct_message_service
from app.websocket.connection_manager import manager

router = APIRouter()

@router.get("/{recipient_id}", response_model=List[DirectMessageSchema])
async def get_direct_messages(
    recipient_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    messages = await direct_message_service.get_messages(
        db, current_user.id, recipient_id, skip, limit
    )
    return messages
