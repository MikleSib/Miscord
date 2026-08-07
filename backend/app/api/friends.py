from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.dependencies import get_db
from app.models.user import User
from app.schemas.user import User as UserSchema
from app.services import friend_service
from app.services.friend_service import normalize_login
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user

router = APIRouter()

@router.post("/friends/request", response_model=UserSchema)
async def send_friend_request(
    username: str = Body(..., embed=True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Отправить запрос в друзья по логину (@username), не по отображаемому имени.
    """
    login = normalize_login(username)
    if not login:
        raise HTTPException(status_code=400, detail="Укажите логин пользователя.")

    if current_user.username.lower() == login.lower():
        raise HTTPException(status_code=400, detail="Нельзя отправить запрос самому себе.")
    
    friend = await friend_service.get_user_by_username(db, username=login)
    if not friend:
        raise HTTPException(
            status_code=404,
            detail="Пользователь не найден. Укажите логин (@username), а не отображаемое имя.",
        )

    friend_request = await friend_service.create_friend_request(db, user_from_id=current_user.id, user_to_id=friend.id)
    if not friend_request:
        raise HTTPException(status_code=400, detail="Friend request already sent or users are already friends.")
    
    # Отправляем уведомление по WebSocket
    # Добавляем request_id к объекту current_user для отправки
    current_user_schema = UserSchema.from_orm(current_user)
    current_user_schema.request_id = friend_request.id

    await manager.send_personal_message(
        {
            "type": "new_friend_request",
            "data": jsonable_encoder(current_user_schema)
        },
        friend.id
    )

    return friend


@router.get("/friends", response_model=List[UserSchema])
async def get_friends(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get the list of friends for the current user.
    """
    return await friend_service.get_friends(db, user_id=current_user.id)

@router.get("/friends/requests/pending", response_model=List[UserSchema])
async def get_pending_friend_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get the list of pending friend requests for the current user.
    """
    return await friend_service.get_pending_requests(db, user_id=current_user.id)

@router.post("/friends/accept/{request_id}", response_model=UserSchema)
async def accept_friend_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept a friend request.
    """
    friend = await friend_service.accept_friend_request(db, request_id=request_id, current_user_id=current_user.id)
    if not friend:
        raise HTTPException(status_code=404, detail="Friend request not found or you are not the recipient.")
    return friend

@router.post("/friends/reject/{request_id}")
async def reject_friend_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reject a friend request.
    """
    success = await friend_service.reject_friend_request(db, request_id=request_id, current_user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Friend request not found or you are not the recipient.")
    return {"message": "Friend request rejected."}
