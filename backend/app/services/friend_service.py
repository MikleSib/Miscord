from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
from app.models.user import User
from app.models.friendship import Friendship, FriendshipStatus

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
    
    friends = []
    for friendship in friendships:
        if friendship.user_a_id == user_id:
            friends.append(friendship.user_b)
        else:
            friends.append(friendship.user_a)
    return friends

async def get_pending_requests(db: AsyncSession, user_id: int):
    # Запросы, отправленные пользователю
    requests_to_user_result = await db.execute(
        select(Friendship).filter(
            Friendship.user_b_id == user_id,
            Friendship.status == FriendshipStatus.PENDING
        ).options(selectinload(Friendship.user_a))
    )
    requests_to_user = requests_to_user_result.scalars().all()
    
    users = []
    for req in requests_to_user:
        user = req.user_a
        user.request_id = req.id
        users.append(user)
    return users

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
            Friendship.user_b_id == current_user_id,
            Friendship.status == FriendshipStatus.PENDING
        )
    )
    friend_request = friend_request_result.scalar_one_or_none()

    if not friend_request:
        return False
        
    await db.delete(friend_request)
    await db.commit()
    return True
