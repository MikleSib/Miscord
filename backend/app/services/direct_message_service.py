from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.models.direct_message import DirectMessage
from app.models.user import User

def get_messages(db: Session, user1_id: int, user2_id: int):
    return db.query(DirectMessage).filter(
        or_(
            (DirectMessage.sender_id == user1_id) & (DirectMessage.recipient_id == user2_id),
            (DirectMessage.sender_id == user2_id) & (DirectMessage.recipient_id == user1_id)
        )
    ).order_by(DirectMessage.timestamp.asc()).all()

def create_message(db: Session, sender_id: int, recipient_id: int, content: str):
    db_message = DirectMessage(
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message
