from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List

from app.core.dependencies import get_db, get_current_user
from app.models import User, Message, Reaction
from app.schemas.reaction import ReactionToggleRequest, ReactionResponse
from app.schemas.user import UserResponse

router = APIRouter()

@router.post("/api/messages/{message_id}/reactions", response_model=ReactionResponse)
async def toggle_reaction(
    message_id: int,
    reaction_data: ReactionToggleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Добавить или убрать реакцию на сообщение"""
    
    # Проверяем, существует ли сообщение
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено"
        )
    
    # Проверяем, есть ли уже такая реакция от этого пользователя
    existing_reaction = db.query(Reaction).filter(
        and_(
            Reaction.message_id == message_id,
            Reaction.user_id == current_user.id,
            Reaction.emoji == reaction_data.emoji
        )
    ).first()
    
    if existing_reaction:
        # Если реакция уже есть - удаляем её
        db.delete(existing_reaction)
        db.commit()
    else:
        # Если реакции нет - добавляем
        new_reaction = Reaction(
            emoji=reaction_data.emoji,
            message_id=message_id,
            user_id=current_user.id
        )
        db.add(new_reaction)
        db.commit()
        db.refresh(new_reaction)
    
    # Возвращаем актуальные данные о реакциях на это сообщение
    return get_reaction_summary(db, message_id, reaction_data.emoji, current_user.id)

@router.get("/api/messages/{message_id}/reactions", response_model=List[ReactionResponse])
async def get_message_reactions(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Получить все реакции на сообщение"""
    
    # Проверяем, существует ли сообщение
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено"
        )
    
    # Получаем все уникальные эмодзи для этого сообщения
    unique_emojis = db.query(Reaction.emoji).filter(
        Reaction.message_id == message_id
    ).distinct().all()
    
    reactions = []
    for (emoji,) in unique_emojis:
        reaction_summary = get_reaction_summary(db, message_id, emoji, current_user.id)
        reactions.append(reaction_summary)
    
    return reactions

def get_reaction_summary(db: Session, message_id: int, emoji: str, current_user_id: int) -> ReactionResponse:
    """Получить сводку по конкретной реакции"""
    
    # Получаем всех пользователей, поставивших эту реакцию
    reactions = db.query(Reaction).filter(
        and_(
            Reaction.message_id == message_id,
            Reaction.emoji == emoji
        )
    ).all()
    
    users = [UserResponse.from_orm(reaction.user) for reaction in reactions]
    current_user_reacted = any(reaction.user_id == current_user_id for reaction in reactions)
    
    return ReactionResponse(
        id=reactions[0].id if reactions else 0,  # Берем ID первой реакции
        emoji=emoji,
        count=len(reactions),
        users=users,
        current_user_reacted=current_user_reacted
    ) 