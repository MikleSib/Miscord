from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.schemas.message import Message as MessageSchema, MessageCreate
from app.services import direct_message_service
from app.websocket.connection_manager import manager

router = APIRouter()
