from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app.models.user import User
from app.models.friendship import Friendship, FriendshipStatus

def get_user(db: Session, user_id: int):
    return db.query(User).filter(User.id == user_id).first()

def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()

def create_friend_request(db: Session, user_from_id: int, user_to_id: int):
    # Проверяем, не являются ли пользователи уже друзьями
    existing_friendship = db.query(Friendship).filter(
        or_(
            and_(Friendship.user_a_id == user_from_id, Friendship.user_b_id == user_to_id),
            and_(Friendship.user_a_id == user_to_id, Friendship.user_b_id == user_from_id)
        )
    ).first()
    if existing_friendship:
        return None

    # Создаем новый запрос
    new_request = Friendship(
        user_a_id=user_from_id,
        user_b_id=user_to_id,
        status=FriendshipStatus.PENDING
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    return new_request

def get_friends(db: Session, user_id: int):
    friendships = db.query(Friendship).filter(
        or_(
            Friendship.user_a_id == user_id,
            Friendship.user_b_id == user_id
        ),
        Friendship.status == FriendshipStatus.ACCEPTED
    ).all()
    
    friends = []
    for friendship in friendships:
        if friendship.user_a_id == user_id:
            friends.append(friendship.user_b)
        else:
            friends.append(friendship.user_a)
    return friends

def get_pending_requests(db: Session, user_id: int):
    # Запросы, отправленные пользователю
    requests_to_user = db.query(Friendship).filter(
        Friendship.user_b_id == user_id,
        Friendship.status == FriendshipStatus.PENDING
    ).all()
    
    # Возвращаем пользователей, которые отправили запросы
    return [friendship.user_a for friendship in requests_to_user]

def accept_friend_request(db: Session, request_id: int, current_user_id: int):
    friend_request = db.query(Friendship).filter(
        Friendship.id == request_id, 
        Friendship.user_b_id == current_user_id,
        Friendship.status == FriendshipStatus.PENDING
    ).first()

    if not friend_request:
        return None
    
    friend_request.status = FriendshipStatus.ACCEPTED
    db.commit()
    db.refresh(friend_request)

    return friend_request.user_a

def reject_friend_request(db: Session, request_id: int, current_user_id: int):
    friend_request = db.query(Friendship).filter(
        Friendship.id == request_id,
        Friendship.user_b_id == current_user_id,
        Friendship.status == FriendshipStatus.PENDING
    ).first()

    if not friend_request:
        return False
        
    db.delete(friend_request)
    db.commit()
    return True
