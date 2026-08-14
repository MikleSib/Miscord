from app.models import PendingChatUpload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, case
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload
from app.models.direct_message import DirectMessage, HiddenDmConversation
from app.models.attachment import Attachment
from app.models.user import User
from app.schemas.expressions import GifSelection
from app.services.message_media import attach_message_media, serialize_message_media


class DirectMessageReplyError(ValueError):
    pass


async def require_reply_in_conversation(
    db: AsyncSession,
    reply_to_id: int | None,
    sender_id: int,
    recipient_id: int,
) -> None:
    if reply_to_id is None:
        return
    reply = (await db.execute(select(DirectMessage).where(
        DirectMessage.id == reply_to_id,
        or_(
            (DirectMessage.sender_id == sender_id) & (DirectMessage.recipient_id == recipient_id),
            (DirectMessage.sender_id == recipient_id) & (DirectMessage.recipient_id == sender_id),
        ),
    ))).scalar_one_or_none()
    if reply is None:
        raise DirectMessageReplyError("Reply target does not belong to this conversation")

async def get_messages(db: AsyncSession, user1_id: int, user2_id: int, skip: int = 0, limit: int = 30):
    result = await db.execute(
        select(DirectMessage).filter(
            DirectMessage.encryption_version == 0,
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
    messages = sorted(messages, key=lambda x: x.timestamp)
    media = await serialize_message_media(db, dm_message_ids=[item.id for item in messages])
    for item in messages:
        state = media.get(item.id, {"sticker_items": [], "gif": None})
        item.sticker_items = state["sticker_items"]
        item.gif = state["gif"]
    return messages

async def create_message(
    db: AsyncSession,
    sender_id: int,
    recipient_id: int,
    content: str = None,
    attachments: list = None,
    reply_to_id: int = None,
    client_nonce: str = None,
    pending_uploads: list[PendingChatUpload] = None,
    sticker_ids: list[int] | None = None,
    gif: GifSelection | None = None,
):
    await require_reply_in_conversation(db, reply_to_id, sender_id, recipient_id)
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
    
    for pending in pending_uploads or []:
        db_message.attachments.append(Attachment(
            file_url=pending.file_url,
            original_filename=pending.original_filename,
            content_type=pending.content_type,
            size_bytes=pending.size_bytes,
            storage_key=pending.storage_key,
        ))
        await db.delete(pending)

    db.add(db_message)
    await db.flush()
    await attach_message_media(
        db,
        dm_message_id=db_message.id,
        sticker_ids=sticker_ids,
        gif=gif,
        sender_id=sender_id,
        recipient_id=recipient_id,
    )
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

    hidden_subq = (
        select(HiddenDmConversation.peer_id, HiddenDmConversation.hidden_at)
        .where(HiddenDmConversation.user_id == user_id)
        .subquery()
    )

    result = await db.execute(
        select(User, conversations_subq.c.last_message_at)
        .join(conversations_subq, User.id == conversations_subq.c.peer_id)
        .outerjoin(hidden_subq, hidden_subq.c.peer_id == User.id)
        .where(or_(
            hidden_subq.c.peer_id.is_(None),
            conversations_subq.c.last_message_at > hidden_subq.c.hidden_at,
        ))
        .order_by(conversations_subq.c.last_message_at.desc())
    )

    conversations = []
    for user, last_message_at in result.all():
        conversations.append(
            {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "is_active": user.is_active,
                "is_bot": user.is_bot,
                "is_online": user.is_online,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "last_message_at": last_message_at,
            }
        )

    return conversations


async def hide_conversation(db: AsyncSession, user_id: int, peer_id: int) -> bool:
    if user_id == peer_id:
        return False

    message_id = (await db.execute(
        select(DirectMessage.id)
        .where(or_(
            (DirectMessage.sender_id == user_id) & (DirectMessage.recipient_id == peer_id),
            (DirectMessage.sender_id == peer_id) & (DirectMessage.recipient_id == user_id),
        ))
        .limit(1)
    )).scalar_one_or_none()
    if message_id is None:
        return False

    statement = insert(HiddenDmConversation).values(user_id=user_id, peer_id=peer_id)
    await db.execute(statement.on_conflict_do_update(
        constraint="uq_hidden_dm_conversation_pair",
        set_={"hidden_at": func.now()},
    ))
    await db.commit()
    return True

