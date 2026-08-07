from app.models import PendingChatUpload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, case
from sqlalchemy.orm import selectinload
from app.models.direct_message import DirectMessage
from app.models.attachment import Attachment
from app.models.user import User

async def get_messages(db: AsyncSession, user1_id: int, user2_id: int, skip: int = 0, limit: int = 30):
    result = await db.execute(
        select(DirectMessage).filter(
            or_(
                (DirectMessage.sender_id == user1_id) & (DirectMessage.recipient_id == user2_id),
                (DirectMessage.sender_id == user2_id) & (DirectMessage.recipient_id == user1_id)
            )
        ).options(
            selectinload(DirectMessage.attachments)
            # reactions РїСЂРёС…РѕРґСЏС‚ С‡РµСЂРµР· WebSocket
        ).order_by(DirectMessage.timestamp.desc()).offset(skip).limit(limit)
    )
    messages = result.scalars().all()
    # РЎРѕСЂС‚РёСЂСѓРµРј СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕ РІСЂРµРјРµРЅРё РІ РІРѕР·СЂР°СЃС‚Р°СЋС‰РµРј РїРѕСЂСЏРґРєРµ РґР»СЏ РїСЂР°РІРёР»СЊРЅРѕРіРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ
    return sorted(messages, key=lambda x: x.timestamp)

async def create_message(db: AsyncSession, sender_id: int, recipient_id: int, content: str = None, attachments: list = None, reply_to_id: int = None):
    db_message = DirectMessage(
        client_nonce=client_nonce,
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content,
        reply_to_id=reply_to_id
    )
    
    # Р”РѕР±Р°РІР»СЏРµРј РІР»РѕР¶РµРЅРёСЏ РµСЃР»Рё РѕРЅРё РµСЃС‚СЊ
    if attachments:
        for url in attachments:
            attachment = Attachment(file_url=url)
            db_message.attachments.append(attachment)
    
    db.add(db_message)
    for pending in pending_uploads or []:
        db.add(Attachment(
            direct_message_id=db_message.id,
            file_url=pending.file_url,
            original_filename=pending.original_filename,
            content_type=pending.content_type,
            size_bytes=pending.size_bytes,
            storage_key=pending.storage_key,
        ))
        await db.delete(pending)

    await db.commit()
    await db.refresh(db_message)
    
    # Р—Р°РіСЂСѓР¶Р°РµРј СЃ attachments, reactions, Рё reply_to
    result = await db.execute(
        select(DirectMessage)
        .where(DirectMessage.id == db_message.id)
        .options(
            selectinload(DirectMessage.attachments),
            selectinload(DirectMessage.reactions),
            selectinload(DirectMessage.reply_to)
        )
    )
    return result.scalar_one()


async def get_conversations(db: AsyncSession, user_id: int):
    """РЈРЅРёРєР°Р»СЊРЅС‹Рµ СЃРѕР±РµСЃРµРґРЅРёРєРё СЃ РІСЂРµРјРµРЅРµРј РїРѕСЃР»РµРґРЅРµРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ."""
    peer_id_expr = case(
        (DirectMessage.sender_id == user_id, DirectMessage.recipient_id),
        else_=DirectMessage.sender_id,
    )

    conversations_subq = (
        select(
            peer_id_expr.label("peer_id"),
            func.max(DirectMessage.timestamp).label("last_message_at"),
        )
        .where(
            or_(
                DirectMessage.sender_id == user_id,
                DirectMessage.recipient_id == user_id,
            )
        )
        .group_by(peer_id_expr)
        .subquery()
    )

    result = await db.execute(
        select(User, conversations_subq.c.last_message_at)
        .join(conversations_subq, User.id == conversations_subq.c.peer_id)
        .order_by(conversations_subq.c.last_message_at.desc())
    )

    conversations = []
    for user, last_message_at in result.all():
        conversations.append(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "is_active": user.is_active,
                "is_online": user.is_online,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "last_message_at": last_message_at,
            }
        )

    return conversations

