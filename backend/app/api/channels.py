from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.db.database import get_db
from app.models import Channel, ChannelMember, TextChannel, VoiceChannel, User, ChannelType, VoiceChannelUser, Message, Reaction
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema
)
from app.schemas.user import UserResponse
from app.core.dependencies import get_current_active_user, get_current_user
from app.websocket.connection_manager import manager
from datetime import timezone, datetime, timedelta
from app.schemas.message import MessageUpdate
from app.services.user_activity_service import user_activity_service

router = APIRouter()

@router.get("/full")
async def get_full_server_data(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Возвращает информацию о серверах, где пользователь является участником.
    """
    # Получаем только серверы, где пользователь является участником
    stmt = (
        select(Channel)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(ChannelMember.user_id == current_user.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
        .order_by(Channel.created_at)
    )
    result = await db.execute(stmt)
    channels = result.scalars().unique().all()

    servers = []
    for channel in channels:
        # Текстовые каналы без сообщений
        text_channels = []
        for tc in channel.text_channels:
            text_channels.append({
                "id": tc.id,
                "name": tc.name,
                "position": tc.position,
                "created_at": tc.created_at
            })
        
        # Голосовые каналы без активных пользователей
        voice_channels = []
        for vc in channel.voice_channels:
            voice_channels.append({
                "id": vc.id,
                "name": vc.name,
                "position": vc.position,
                "max_users": vc.max_users,
                "created_at": vc.created_at
            })
            
        servers.append({
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "owner_id": channel.owner_id,
            "created_at": channel.created_at,
            "updated_at": channel.updated_at,
            "owner": {
                "id": channel.owner.id,
                "username": channel.owner.display_name or channel.owner.username,
                "email": channel.owner.email,
                "is_active": channel.owner.is_active,
                "is_online": channel.owner.is_online,
                "avatar_url": channel.owner.avatar_url,
                "created_at": channel.owner.created_at,
                "updated_at": channel.owner.updated_at
            } if channel.owner else None,
            "text_channels": text_channels,
            "voice_channels": voice_channels
        })

    return {
        "servers": servers
    }

@router.post("/", response_model=ChannelSchema)
async def create_channel(
    channel_data: ChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание нового канала (сервера)"""
    # Создаем основной канал
    db_channel = Channel(
        name=channel_data.name,
        description=channel_data.description,
        owner_id=current_user.id
    )
    db.add(db_channel)
    await db.commit()
    await db.refresh(db_channel)
    
    # Автоматически добавляем создателя как участника
    member = ChannelMember(
        channel_id=db_channel.id,
        user_id=current_user.id
    )
    db.add(member)
    
    # Создаем дефолтный текстовый канал "general"
    default_text = TextChannel(
        name="general",
        channel_id=db_channel.id,
        position=0
    )
    db.add(default_text)
    
    # Создаем дефолтный голосовой канал "General"
    default_voice = VoiceChannel(
        name="General",
        channel_id=db_channel.id,
        position=0,
        max_users=10
    )
    db.add(default_voice)
    
    await db.commit()
    
    # Отправляем WebSocket уведомление только создателю (участнику) о новом сервере
    await manager.send_to_user(current_user.id, {
        "type": "server_created",
        "server": {
            "id": db_channel.id,
            "name": db_channel.name,
            "description": db_channel.description,
            "owner_id": db_channel.owner_id,
            "created_at": db_channel.created_at.isoformat(),
            "updated_at": db_channel.updated_at.isoformat() if db_channel.updated_at else None,
            "owner": {
                "id": current_user.id,
                "username": current_user.username,
                "email": current_user.email,
                "is_active": current_user.is_active,
                "is_online": current_user.is_online,
                "created_at": current_user.created_at.isoformat(),
                "updated_at": current_user.updated_at.isoformat() if current_user.updated_at else None
            },
            "text_channels": [],
            "voice_channels": [],
            "members_count": 1
        },
        "created_by": {
            "id": current_user.id,
            "username": current_user.username
        }
    })
    
    return {
        "id": db_channel.id,
        "name": db_channel.name,
        "description": db_channel.description,
        "owner_id": db_channel.owner_id,
        "created_at": db_channel.created_at,
        "updated_at": db_channel.updated_at,
        "owner": {
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "is_active": current_user.is_active,
            "is_online": current_user.is_online,
            "created_at": current_user.created_at,
            "updated_at": current_user.updated_at
        },
        "text_channels": [],
        "voice_channels": [],
        "members_count": 1
    }

@router.get("/", response_model=List[ChannelSchema])
async def get_all_channels(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение каналов (серверов) где пользователь является участником"""
    stmt = (
        select(Channel)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(ChannelMember.user_id == current_user.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.members),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
        .order_by(Channel.created_at)
    )
    result = await db.execute(stmt)
    channels = result.scalars().unique().all()
    
    response_channels = []
    for channel in channels:
        if not channel.owner:
            continue
            
        # Преобразуем модели SQLAlchemy в Pydantic схемы
        text_channels_schema = [TextChannelSchema.from_orm(tc) for tc in channel.text_channels]
        voice_channels_schema = [VoiceChannelSchema.from_orm(vc) for vc in channel.voice_channels]

        response_channels.append({
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "owner_id": channel.owner_id,
            "created_at": channel.created_at,
            "updated_at": channel.updated_at,
            "owner": {
                "id": channel.owner.id,
                "username": channel.owner.username,
                "email": channel.owner.email,
                "is_active": channel.owner.is_active,
                "is_online": channel.owner.is_online,
                "created_at": channel.owner.created_at,
                "updated_at": channel.owner.updated_at
            },
            "text_channels": text_channels_schema,
            "voice_channels": voice_channels_schema,
            "members_count": len(channel.members)
        })

    return response_channels

@router.get("/{channel_id}")
async def get_channel_details(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение детальной информации о канале и участниках сервера"""
    # Получаем основной канал
    channel_result = await db.execute(
        select(Channel)
        .options(selectinload(Channel.owner))
        .where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )
    
    # Получаем текстовые каналы
    text_result = await db.execute(
        select(TextChannel).where(TextChannel.channel_id == channel_id).order_by(TextChannel.position)
    )
    text_channels = text_result.scalars().all()
    
    # Получаем голосовые каналы
    voice_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.channel_id == channel_id).order_by(VoiceChannel.position)
    )
    voice_channels = voice_result.scalars().all()
    
    # Получаем участников сервера
    members_result = await db.execute(
        select(User)
        .join(ChannelMember, User.id == ChannelMember.user_id)
        .where(ChannelMember.channel_id == channel_id)
    )
    members = members_result.scalars().all()
    
    return {
        "id": channel.id,
        "name": channel.name,
        "description": channel.description,
        "owner_id": channel.owner_id,
        "type": "server",  # Это сервер, содержащий каналы
        "owner": {
            "id": channel.owner.id,
            "username": channel.owner.display_name or channel.owner.username,
            "email": channel.owner.email,
            "is_active": channel.owner.is_active,
            "is_online": channel.owner.is_online,
            "avatar_url": channel.owner.avatar_url,
            "created_at": channel.owner.created_at,
            "updated_at": channel.owner.updated_at
        } if channel.owner else None,
        "channels": [
            {"id": tc.id, "name": tc.name, "type": "text", "position": tc.position}
            for tc in text_channels
        ] + [
            {"id": vc.id, "name": vc.name, "type": "voice", "position": vc.position, "max_users": vc.max_users}
            for vc in voice_channels
        ],
        "members": [
            {
                "id": member.id,
                "username": member.display_name or member.username,
                "email": member.email,
                "is_active": member.is_active,
                "is_online": member.is_online,
                "avatar_url": member.avatar_url,
                "created_at": member.created_at,
                "updated_at": member.updated_at
            }
            for member in members
        ]
    }

@router.post("/{channel_id}/join")
async def join_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Присоединение к каналу"""
    # Проверка существования канала
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    if not channel_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )
    
    # Проверка, не является ли уже участником
    member_result = await db.execute(
        select(ChannelMember)
        .where(
            (ChannelMember.channel_id == channel_id) &
            (ChannelMember.user_id == current_user.id)
        )
    )
    if member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this channel"
        )
    
    # Добавление участника
    new_member = ChannelMember(
        channel_id=channel_id,
        user_id=current_user.id
    )
    db.add(new_member)
    await db.commit()
    
    return {"detail": "Successfully joined the channel"}

@router.post("/{channel_id}/text-channels", response_model=TextChannelSchema)
async def create_text_channel(
    channel_id: int,
    channel_data: TextChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание текстового канала"""
    # Создание текстового канала
    new_text_channel = TextChannel(
        name=channel_data.name,
        channel_id=channel_id,
        position=channel_data.position
    )
    db.add(new_text_channel)
    await db.commit()
    await db.refresh(new_text_channel)
    
    # Отправляем WebSocket уведомление всем пользователям
    await manager.broadcast_to_all({
        "type": "text_channel_created",
        "channel_id": channel_id,
        "text_channel": {
            "id": new_text_channel.id,
            "name": new_text_channel.name,
            "type": "text",
            "position": new_text_channel.position,
            "serverId": channel_id,
        },
        "created_by": {
            "id": current_user.id,
            "username": current_user.username
        }
    })
    
    return new_text_channel

@router.post("/{channel_id}/voice-channels", response_model=VoiceChannelSchema)
async def create_voice_channel(
    channel_id: int,
    channel_data: VoiceChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание голосового канала"""
    # Создание голосового канала
    new_voice_channel = VoiceChannel(
        name=channel_data.name,
        channel_id=channel_id,
        position=channel_data.position,
        max_users=channel_data.max_users
    )
    db.add(new_voice_channel)
    await db.commit()
    await db.refresh(new_voice_channel)
    
    # Отправляем WebSocket уведомление всем пользователям
    await manager.broadcast_to_all({
        "type": "voice_channel_created",
        "channel_id": channel_id,
        "voice_channel": {
            "id": new_voice_channel.id,
            "name": new_voice_channel.name,
            "type": "voice",
            "position": new_voice_channel.position,
            "max_users": new_voice_channel.max_users,
            "serverId": channel_id,
        },
        "created_by": {
            "id": current_user.id,
            "username": current_user.username
        }
    })
    
    return new_voice_channel

# Новые эндпоинты для приглашений
@router.post("/{channel_id}/invite")
async def invite_user_to_channel(
    channel_id: int,
    username: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Приглашение пользователя в канал (сервер)"""
    # Находим пользователя по username
    user_result = await db.execute(
        select(User).where(User.username == username)
    )
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Проверяем, не является ли пользователь уже участником
    existing_member = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == target_user.id
            )
        )
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this channel"
        )
    
    # Добавляем пользователя как участника
    new_member = ChannelMember(
        channel_id=channel_id,
        user_id=target_user.id
    )
    db.add(new_member)
    await db.commit()
    
    # Получаем информацию о канале для уведомления
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one()
    
    # Получаем полную информацию о сервере для приглашенного пользователя
    channel_with_details = await db.execute(
        select(Channel)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
        .where(Channel.id == channel_id)
    )
    server_details = channel_with_details.scalar_one()
    
    # Отправляем WebSocket уведомление приглашенному пользователю о новом сервере
    await manager.send_to_user(target_user.id, {
        "type": "server_created",
        "server": {
            "id": server_details.id,
            "name": server_details.name,
            "description": server_details.description,
            "owner_id": server_details.owner_id,
            "created_at": server_details.created_at.isoformat(),
            "updated_at": server_details.updated_at.isoformat() if server_details.updated_at else None,
            "owner": {
                "id": server_details.owner.id,
                "username": server_details.owner.display_name or server_details.owner.username,
                "email": server_details.owner.email,
                "is_active": server_details.owner.is_active,
                "is_online": server_details.owner.is_online,
                "avatar_url": server_details.owner.avatar_url,
                "created_at": server_details.owner.created_at.isoformat(),
                "updated_at": server_details.owner.updated_at.isoformat() if server_details.owner.updated_at else None
            },
            "text_channels": [
                {
                    "id": tc.id,
                    "name": tc.name,
                    "position": tc.position,
                    "created_at": tc.created_at.isoformat()
                } for tc in server_details.text_channels
            ],
            "voice_channels": [
                {
                    "id": vc.id,
                    "name": vc.name,
                    "position": vc.position,
                    "max_users": vc.max_users,
                    "created_at": vc.created_at.isoformat()
                } for vc in server_details.voice_channels
            ],
            "members_count": len(server_details.members)
        },
        "invited_by": current_user.display_name or current_user.username
    })
    
    # Уведомляем всех участников канала о новом участнике
    await manager.send_to_channel(channel_id, {
        "type": "user_joined_channel",
        "user_id": target_user.id,
        "username": target_user.username,
        "channel_id": channel_id
    })
    
    return {
        "message": f"User {username} successfully invited to channel",
        "user_id": target_user.id,
        "username": target_user.username
    }

@router.get("/{channel_id}/members", response_model=List[UserResponse])
async def get_channel_members(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка участников канала"""
    # Получаем всех участников
    result = await db.execute(
        select(User).join(ChannelMember).where(
            ChannelMember.channel_id == channel_id
        )
    )
    members = result.scalars().all()
    
    return [
        UserResponse(
            id=member.id,
            username=member.username,
            email=member.email
        )
        for member in members
    ]

@router.get("/voice/{voice_channel_id}/members")
async def get_voice_channel_members(
    voice_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка участников голосового канала"""
    # Проверяем существование голосового канала
    voice_channel_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
    )
    voice_channel = voice_channel_result.scalar_one_or_none()
    if not voice_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice channel not found"
        )
    
    # Получаем всех участников голосового канала с информацией о пользователях
    result = await db.execute(
        select(VoiceChannelUser, User).join(User, VoiceChannelUser.user_id == User.id).where(
            VoiceChannelUser.voice_channel_id == voice_channel_id
        )
    )
    voice_members = result.all()
    
    return [
        {
            "id": user.id,
            "username": user.display_name or user.username,
            "email": user.email,
            "is_active": user.is_active,
            "is_online": user.is_online,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "is_muted": voice_user.is_muted,
            "is_deafened": voice_user.is_deafened
        }
        for voice_user, user in voice_members
    ]

@router.get("/text/{channel_id}/messages")
async def get_channel_messages(
    channel_id: int,
    limit: int = 50,
    before: Optional[int] = None,  # ID сообщения, до которого загружать
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение сообщений текстового канала"""
    # Проверяем существование канала
    channel_result = await db.execute(
        select(TextChannel).where(TextChannel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Текстовый канал не найден")
    
    # Согласно памяти - все пользователи имеют доступ к любым каналам
    # Убираем проверку членства
    
    # Строим запрос для сообщений (показываем только не удаленные)
    query = select(Message).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted == False
    )
    
    # Если указан before, загружаем сообщения до этого ID
    if before:
        query = query.where(Message.id < before)
    
    # Сортируем по времени (новые сначала для пагинации, потом развернем)
    query = query.order_by(Message.timestamp.desc()).limit(limit)
    
    # Загружаем связанные данные
    query = query.options(
        selectinload(Message.author),
        selectinload(Message.attachments),
        selectinload(Message.reactions).selectinload(Reaction.user),
        selectinload(Message.reply_to).selectinload(Message.author)
    )
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Разворачиваем порядок (старые сообщения сначала)
    messages = list(reversed(messages))
    
    # Преобразуем в формат для фронтенда
    message_list = []
    for msg in messages:
        # Обрабатываем случай удаленного пользователя
        if msg.author is None:
            author_data = {
                "id": -1,  # Специальный ID для удаленных пользователей
                "username": "УДАЛЕННЫЙ АККАУНТ",
                "email": "",
                "display_name": "УДАЛЕННЫЙ АККАУНТ",
                "avatar_url": None
            }
        else:
            author_data = {
                "id": msg.author.id,
                "username": msg.author.display_name or msg.author.username,
                "email": msg.author.email,
                "display_name": msg.author.display_name,
                "avatar_url": getattr(msg.author, 'avatar_url', None)
            }
        
        # Формируем реакции
        reactions_dict = {}
        for reaction in msg.reactions:
            emoji = reaction.emoji
            if emoji not in reactions_dict:
                reactions_dict[emoji] = {
                    "id": reaction.id,
                    "emoji": emoji,
                    "count": 0,
                    "users": [],
                    "current_user_reacted": False
                }
            reactions_dict[emoji]["count"] += 1
            reactions_dict[emoji]["users"].append({
                "id": reaction.user.id,
                "username": reaction.user.display_name or reaction.user.username,
                "email": reaction.user.email,
                "display_name": reaction.user.display_name,
                "avatar_url": getattr(reaction.user, 'avatar_url', None)
            })
            if reaction.user_id == current_user.id:
                reactions_dict[emoji]["current_user_reacted"] = True
        
        message_dict = {
            "id": msg.id,
            "content": msg.content,
            "channelId": msg.text_channel_id,
            "timestamp": msg.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "is_edited": msg.is_edited,
            "author": author_data,
            "attachments": [
                {
                    "id": att.id,
                    "file_url": att.file_url,
                    "filename": getattr(att, 'filename', None)
                } for att in msg.attachments
            ],
            "reactions": list(reactions_dict.values()),
            "reply_to": None if not msg.reply_to else {
                "id": msg.reply_to.id,
                "content": "Сообщение удалено" if msg.reply_to.is_deleted else msg.reply_to.content,
                "channelId": msg.reply_to.text_channel_id,
                "timestamp": msg.reply_to.timestamp.replace(tzinfo=timezone.utc).isoformat(),
                "is_deleted": msg.reply_to.is_deleted,
                "author": {
                    "id": msg.reply_to.author.id,
                    "username": msg.reply_to.author.display_name or msg.reply_to.author.username,
                    "email": msg.reply_to.author.email,
                    "display_name": msg.reply_to.author.display_name,
                    "avatar_url": getattr(msg.reply_to.author, 'avatar_url', None)
                } if msg.reply_to.author else {
                    "id": -1,
                    "username": "УДАЛЕННЫЙ АККАУНТ",
                    "email": "",
                    "display_name": "УДАЛЕННЫЙ АККАУНТ",
                    "avatar_url": None
                },
                "attachments": [],
                "reactions": []
            }
        }
        message_list.append(message_dict)
    
    return {
        "messages": message_list,
        "has_more": len(messages) == limit  # Есть ли еще сообщения
    }

@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Удаление сообщения (только автор, в течение 2 часов)"""
    # Получаем сообщение
    message_result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = message_result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    
    # Проверяем авторство
    if message.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете удалять только свои сообщения")
    
    # Проверяем временное ограничение (2 часа)
    time_limit = timedelta(hours=2)
    time_since_creation = datetime.utcnow() - message.timestamp
    
    if time_since_creation > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно удалить только в течение 2 часов после отправки")
    
    # Помечаем сообщение как удаленное (не удаляем физически из-за ссылок)
    message.is_deleted = True
    message.content = None  # Очищаем контент
    
    # Удаляем реакции и вложения
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))
    
    await db.commit()
    
    # Отправляем WebSocket уведомление о удалении
    await manager.send_to_channel(message.text_channel_id, {
        "type": "message_deleted",
        "data": {
            "message_id": message_id,
            "text_channel_id": message.text_channel_id
        }
    })
    
    return {"message": "Сообщение удалено"}

@router.put("/messages/{message_id}")
async def edit_message(
    message_id: int,
    message_data: MessageUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Редактирование сообщения (только автор, в течение 2 часов)"""
    # Получаем сообщение с полными данными
    message_result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(Reaction.user),
            selectinload(Message.reply_to).selectinload(Message.author)
        )
    )
    message = message_result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    
    # Проверяем авторство
    if message.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете редактировать только свои сообщения")
    
    # Проверяем временное ограничение (2 часа)
    time_limit = timedelta(hours=2)
    time_since_creation = datetime.utcnow() - message.timestamp
    
    if time_since_creation > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно редактировать только в течение 2 часов после отправки")
    
    # Обновляем контент и помечаем как отредактированное
    message.content = message_data.content.strip()
    message.is_edited = True
    
    await db.commit()
    await db.refresh(message)
    
    # Формируем реакции
    reactions_dict = {}
    for reaction in message.reactions:
        emoji = reaction.emoji
        if emoji not in reactions_dict:
            reactions_dict[emoji] = {
                "id": reaction.id,
                "emoji": emoji,
                "count": 0,
                "users": [],
                "current_user_reacted": False
            }
        reactions_dict[emoji]["count"] += 1
        reactions_dict[emoji]["users"].append({
            "id": reaction.user.id,
            "username": reaction.user.display_name or reaction.user.username,
            "email": reaction.user.email,
            "display_name": reaction.user.display_name,
            "avatar_url": getattr(reaction.user, 'avatar_url', None)
        })
        if reaction.user_id == current_user.id:
            reactions_dict[emoji]["current_user_reacted"] = True
    
    # Формируем обновленное сообщение
    updated_message = {
        "id": message.id,
        "content": message.content,
        "channelId": message.text_channel_id,
        "timestamp": message.timestamp.replace(tzinfo=timezone.utc).isoformat(),
        "is_edited": message.is_edited,
        "is_deleted": message.is_deleted,
        "author": {
            "id": message.author.id,
            "username": message.author.display_name or message.author.username,
            "email": message.author.email,
            "display_name": message.author.display_name,
            "avatar_url": getattr(message.author, 'avatar_url', None)
        },
        "attachments": [
            {
                "id": att.id,
                "file_url": att.file_url,
                "filename": getattr(att, 'filename', None)
            } for att in message.attachments
        ],
        "reactions": list(reactions_dict.values()),
        "reply_to": None if not message.reply_to else {
            "id": message.reply_to.id,
            "content": "Сообщение удалено" if message.reply_to.is_deleted else message.reply_to.content,
            "channelId": message.reply_to.text_channel_id,
            "timestamp": message.reply_to.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "is_deleted": message.reply_to.is_deleted,
            "author": {
                "id": message.reply_to.author.id,
                "username": message.reply_to.author.display_name or message.reply_to.author.username,
                "email": message.reply_to.author.email,
                "display_name": message.reply_to.author.display_name,
                "avatar_url": getattr(message.reply_to.author, 'avatar_url', None)
            } if message.reply_to.author else {
                "id": -1,
                "username": "УДАЛЕННЫЙ АККАУНТ",
                "email": "",
                "display_name": "УДАЛЕННЫЙ АККАУНТ",
                "avatar_url": None
            },
            "attachments": [],
            "reactions": []
        }
    }
    
    # Отправляем WebSocket уведомление об изменении
    await manager.send_to_channel(message.text_channel_id, {
        "type": "message_edited", 
        "data": updated_message
    })
    
    return updated_message


@router.get("/online-users")
async def get_online_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка онлайн пользователей"""
    online_users = await user_activity_service.get_online_users(db)
    
    return {
        "online_users": [
            {
                "id": user.id,
                "username": user.display_name or user.username,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "is_online": user.is_online,
                "last_activity": user.last_activity.isoformat() if user.last_activity else None
            }
            for user in online_users
        ],
        "count": len(online_users)
    }