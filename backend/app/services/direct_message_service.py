from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from app.models.direct_message import DirectMessage
from app.models.attachment import Attachment

async def get_messages(db: AsyncSession, user1_id: int, user2_id: int, skip: int = 0, limit: int = 30):
    result = await db.execute(
        select(DirectMessage).filter(
            or_(
                (DirectMessage.sender_id == user1_id) & (DirectMessage.recipient_id == user2_id),
                (DirectMessage.sender_id == user2_id) & (DirectMessage.recipient_id == user1_id)
            )
        ).options(selectinload(DirectMessage.attachments)).order_by(DirectMessage.timestamp.desc()).offset(skip).limit(limit)
    )
    messages = result.scalars().all()
    # Сортируем сообщения по времени в возрастающем порядке для правильного отображения
    return sorted(messages, key=lambda x: x.timestamp)

async def create_message(db: AsyncSession, sender_id: int, recipient_id: int, content: str = None, attachments: list = None):
    db_message = DirectMessage(
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content
    )
    
    # Добавляем вложения если они есть
    if attachments:
        for url in attachments:
            attachment = Attachment(file_url=url)
            db_message.attachments.append(attachment)
    
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)
    
    # Загружаем с attachments
    result = await db.execute(
        select(DirectMessage)
        .where(DirectMessage.id == db_message.id)
        .options(selectinload(DirectMessage.attachments))
    )
    return result.scalar_one()
