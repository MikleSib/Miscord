from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.models.direct_message import DirectMessage

async def get_messages(db: AsyncSession, user1_id: int, user2_id: int, skip: int = 0, limit: int = 30):
    result = await db.execute(
        select(DirectMessage).filter(
            or_(
                (DirectMessage.sender_id == user1_id) & (DirectMessage.recipient_id == user2_id),
                (DirectMessage.sender_id == user2_id) & (DirectMessage.recipient_id == user1_id)
            )
        ).order_by(DirectMessage.timestamp.desc()).offset(skip).limit(limit)
    )
    messages = result.scalars().all()
    # Сортируем сообщения по времени в возрастающем порядке для правильного отображения
    return sorted(messages, key=lambda x: x.timestamp)

async def create_message(db: AsyncSession, sender_id: int, recipient_id: int, content: str):
    db_message = DirectMessage(
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content
    )
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)
    return db_message
