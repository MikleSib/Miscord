from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
from app.models.user import User
from app.models.friendship import Friendship, FriendshipStatus
from app.models.direct_message import DirectMessage
from sqlalchemy.sql import func

async def get_user(db: AsyncSession, user_id: int):
    result = await db.execute(select(User).filter(User.id == user_id))
    return result.scalar_one_or_none()

async def get_user_by_username(db: AsyncSession, username: str):
    result = await db.execute(select(User).filter(User.username == username))
    return result.scalar_one_or_none()

async def create_friend_request(db: AsyncSession, user_from_id: int, user_to_id: int):
    # Проверяем, не являются ли пользователи уже друзьями
    existing_friendship_result = await db.execute(
        select(Friendship).filter(
            or_(
                and_(Friendship.user_a_id == user_from_id, Friendship.user_b_id == user_to_id),
                and_(Friendship.user_a_id == user_to_id, Friendship.user_b_id == user_from_id)
            )
        )
    )
    if existing_friendship_result.scalar_one_or_none():
        return None

    # Создаем новый запрос
    new_request = Friendship(
        user_a_id=user_from_id,
        user_b_id=user_to_id,
        status=FriendshipStatus.PENDING
    )
    db.add(new_request)
    await db.commit()
    await db.refresh(new_request)
    return new_request

async def get_friends(db: AsyncSession, user_id: int):
    friendships_result = await db.execute(
        select(Friendship).filter(
            or_(
                Friendship.user_a_id == user_id,
                Friendship.user_b_id == user_id
            ),
            Friendship.status == FriendshipStatus.ACCEPTED
        ).options(selectinload(Friendship.user_a), selectinload(Friendship.user_b))
    )
    friendships = friendships_result.scalars().all()
    
    friends_data = []
    for friendship in friendships:
        if friendship.user_a_id == user_id:
            friend = friendship.user_b
        else:
            friend = friendship.user_a
        
        # Получаем время последнего сообщения
        last_message_result = await db.execute(
            select(DirectMessage.timestamp)
            .filter(
                or_(
                    and_(DirectMessage.sender_id == user_id, DirectMessage.recipient_id == friend.id),
                    and_(DirectMessage.sender_id == friend.id, DirectMessage.recipient_id == user_id)
                )
            )
            .order_by(DirectMessage.timestamp.desc())
            .limit(1)
        )
        last_message_at = last_message_result.scalar_one_or_none()

        friend_data = {
            "id": friend.id,
            "username": friend.username,
            "email": friend.email,
            "display_name": friend.display_name,
            "avatar_url": friend.avatar_url,
            "is_active": friend.is_active,
            "is_online": friend.is_online,
            "created_at": friend.created_at,
            "updated_at": friend.updated_at,
            "friendship_created_at": friendship.created_at,
            "last_message_at": last_message_at,
        }
        friends_data.append(friend_data)
        
    return friends_data

async def get_pending_requests(db: AsyncSession, user_id: int):
    """
    Получает список входящих запросов в друзья для текущего пользователя.
    """
    pending_friendships_result = await db.execute(
        select(Friendship)
        .filter(
            Friendship.user_b_id == user_id,
            Friendship.status == FriendshipStatus.PENDING
        )
        .options(selectinload(Friendship.user_a))
    )
    pending_friendships = pending_friendships_result.unique().scalars().all()

    users_data = []
    for req in pending_friendships:
        user = req.user_a
        if user:
            user_data = {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "is_active": user.is_active,
                "is_online": user.is_online,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "request_id": req.id,
                "friendship_created_at": req.created_at,
                "last_message_at": None,
            }
            users_data.append(user_data)
            
    return users_data

async def accept_friend_request(db: AsyncSession, request_id: int, current_user_id: int):
    friend_request_result = await db.execute(
        select(Friendship).filter(
            Friendship.id == request_id, 
            Friendship.user_b_id == current_user_id,
            Friendship.status == FriendshipStatus.PENDING
        ).options(selectinload(Friendship.user_a))
    )
    friend_request = friend_request_result.scalar_one_or_none()

    if not friend_request:
        return None
    
    friend_request.status = FriendshipStatus.ACCEPTED
    await db.commit()
    await db.refresh(friend_request)

    return friend_request.user_a

async def reject_friend_request(db: AsyncSession, request_id: int, current_user_id: int):
    friend_request_result = await db.execute(
        select(Friendship).filter(
            Friendship.id == request_id,
            or_(
                Friendship.user_a_id == current_user_id,
                Friendship.user_b_id == current_user_id
            ),
            Friendship.status == FriendshipStatus.PENDING
        )
    )
    friend_request = friend_request_result.scalar_one_or_none()

    if not friend_request:
        return False
        
    await db.delete(friend_request)
    await db.commit()
    return True
