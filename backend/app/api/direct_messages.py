from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime, timedelta

from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.direct_message import DirectMessage
from app.models.reaction import Reaction
from app.schemas.message import Message as MessageSchema, MessageCreate, DirectMessageSchema
from app.schemas.reaction import ReactionToggleRequest, ReactionResponse
from app.schemas.user import RelationshipUser
from app.services import direct_message_service
from app.websocket.connection_manager import manager

router = APIRouter()


@router.get("/conversations", response_model=List[RelationshipUser])
async def get_dm_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await direct_message_service.get_conversations(db, current_user.id)


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


@router.delete("/{message_id}")
async def delete_dm_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Удаление DM сообщения (только автор, в течение 5 минут)"""
    # Получаем сообщение
    message_result = await db.execute(
        select(DirectMessage).where(DirectMessage.id == message_id)
    )
    message = message_result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    
    # Проверяем авторство
    if message.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете удалять только свои сообщения")
    
    # Проверяем временное ограничение (5 минут)
    time_limit = timedelta(minutes=5)
    time_since_creation = datetime.utcnow() - message.timestamp
    
    if time_since_creation > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно удалить только в течение 5 минут после отправки")
    
    # Сохраняем recipient_id для уведомления
    recipient_id = message.recipient_id
    
    # Удаляем реакции
    await db.execute(delete(Reaction).where(Reaction.dm_message_id == message_id))
    
    # Удаляем само сообщение
    await db.delete(message)
    await db.commit()
    
    # Отправляем WebSocket уведомление
    notification = {
        "type": "dm_deleted",
        "data": {
            "message_id": message_id,
            "sender_id": current_user.id,
            "recipient_id": recipient_id
        }
    }
    
    await manager.send_personal_message(notification, recipient_id)
    await manager.send_personal_message(notification, current_user.id)
    
    return {"message": "Сообщение удалено"}


@router.post("/{message_id}/reactions", response_model=ReactionResponse)
async def toggle_dm_reaction(
    message_id: int,
    reaction_data: ReactionToggleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Добавить или убрать реакцию на DM сообщение"""
    
    result = await db.execute(
        select(DirectMessage).filter(DirectMessage.id == message_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено"
        )

    if current_user.id not in (message.sender_id, message.recipient_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому сообщению",
        )
    
    # Проверяем, есть ли уже такая реакция от этого пользователя
    result = await db.execute(
        select(Reaction).filter(
            and_(
                Reaction.dm_message_id == message_id,
                Reaction.user_id == current_user.id,
                Reaction.emoji == reaction_data.emoji
            )
        )
    )
    existing_reaction = result.scalar_one_or_none()
    
    was_removed = False
    if existing_reaction:
        # Если реакция уже есть - удаляем её
        await db.execute(
            delete(Reaction).where(
                and_(
                    Reaction.dm_message_id == message_id,
                    Reaction.user_id == current_user.id,
                    Reaction.emoji == reaction_data.emoji
                )
            )
        )
        await db.commit()
        was_removed = True
    else:
        # Если реакции нет - добавляем
        new_reaction = Reaction(
            emoji=reaction_data.emoji,
            dm_message_id=message_id,
            user_id=current_user.id
        )
        db.add(new_reaction)
        await db.commit()
        await db.refresh(new_reaction)
    
    # Получаем актуальные данные о реакциях
    reactions_result = await db.execute(
        select(Reaction)
        .where(
            and_(
                Reaction.dm_message_id == message_id,
                Reaction.emoji == reaction_data.emoji
            )
        )
        .options(selectinload(Reaction.user))
    )
    reactions = reactions_result.scalars().all()
    
    if not reactions:
        reaction_summary = ReactionResponse(
            id=0,
            emoji=reaction_data.emoji,
            count=0,
            users=[],
            current_user_reacted=False
        )
    else:
        users = []
        current_user_reacted = False
        for r in reactions:
            users.append(r.user)
            if r.user_id == current_user.id:
                current_user_reacted = True
        
        reaction_summary = ReactionResponse(
            id=reactions[0].id,
            emoji=reaction_data.emoji,
            count=len(reactions),
            users=users,
            current_user_reacted=current_user_reacted
        )
    
    # Отправляем WebSocket уведомление
    notification = {
        "type": "dm_reaction_updated",
        "data": {
            "message_id": message_id,
            "emoji": reaction_data.emoji,
            "reaction": {
                "id": reaction_summary.id,
                "emoji": reaction_summary.emoji,
                "count": reaction_summary.count,
                "users": [{"id": u.id, "username": u.username, "display_name": u.display_name} for u in reaction_summary.users],
                "current_user_reacted": reaction_summary.current_user_reacted
            },
            "was_removed": was_removed,
            "user": {
                "id": current_user.id,
                "username": current_user.username,
                "display_name": current_user.display_name
            }
        }
    }
    
    # Отправляем обоим участникам
    await manager.send_personal_message(notification, message.sender_id)
    await manager.send_personal_message(notification, message.recipient_id)
    
    return reaction_summary
