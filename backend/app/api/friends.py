from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.dependencies import get_db
from app.models.user import User
from app.schemas.user import RelationshipUser
from app.services import friend_service
from app.services.friend_service import normalize_login
from app.websocket.connection_manager import manager
from app.core.dependencies import get_current_user
from app.services.notifications import create_notification
from app.models.safety import UserPrivacySettings
from app.services.communication_safety import is_blocked_between, share_server

router = APIRouter()

@router.post("/friends/request", response_model=RelationshipUser)
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

    if await is_blocked_between(db, current_user.id, friend.id):
        raise HTTPException(status_code=403, detail="Запрос этому пользователю недоступен.")
    privacy = await db.get(UserPrivacySettings, friend.id)
    friend_request_mode = privacy.friend_requests if privacy else "everyone"
    if friend_request_mode == "nobody":
        raise HTTPException(status_code=403, detail="Пользователь отключил запросы в друзья.")
    if friend_request_mode == "server_members" and not await share_server(db, current_user.id, friend.id):
        raise HTTPException(status_code=403, detail="Пользователь принимает запросы только от участников общих серверов.")

    friend_request = await friend_service.create_friend_request(db, user_from_id=current_user.id, user_to_id=friend.id)
    if not friend_request:
        raise HTTPException(status_code=400, detail="Запрос уже отправлен или пользователь уже у вас в друзьях.")

    # Отправляем уведомление по WebSocket
    # Добавляем request_id к объекту current_user для отправки
    current_user_schema = RelationshipUser.model_validate(current_user)
    current_user_schema.request_id = friend_request.id

    await manager.send_personal_message(
        {
            "type": "new_friend_request",
            "data": jsonable_encoder(current_user_schema)
        },
        friend.id
    )
    await create_notification(
        db,
        user_id=friend.id,
        type="friend_request",
        actor_user_id=current_user.id,
        dedupe_key=f"friend_request:{friend_request.id}",
        payload={"request_id": friend_request.id},
    )
    await db.commit()

    return friend


@router.get("/friends", response_model=List[RelationshipUser])
async def get_friends(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get the list of friends for the current user.
    """
    return await friend_service.get_friends(db, user_id=current_user.id)

@router.get("/friends/requests/pending", response_model=List[RelationshipUser])
async def get_pending_friend_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get the list of pending friend requests for the current user.
    """
    return await friend_service.get_pending_requests(db, user_id=current_user.id)

@router.post("/friends/accept/{request_id}", response_model=RelationshipUser)
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
        raise HTTPException(status_code=404, detail="Запрос в друзья не найден или уже обработан.")

    acceptor_schema = RelationshipUser.model_validate(current_user)
    await manager.send_personal_message(
        {
            "type": "friend_request_accepted",
            "data": {
                "request_id": request_id,
                "user": jsonable_encoder(acceptor_schema),
            },
        },
        friend.id,
    )
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
    other_user_id = await friend_service.reject_friend_request(
        db, request_id=request_id, current_user_id=current_user.id
    )
    if other_user_id is None:
        raise HTTPException(status_code=404, detail="Запрос в друзья не найден или уже обработан.")

    if other_user_id:
        await manager.send_personal_message(
            {
                "type": "friend_request_rejected",
                "data": {"request_id": request_id},
            },
            other_user_id,
        )
    return {"message": "Запрос в друзья отклонён."}
