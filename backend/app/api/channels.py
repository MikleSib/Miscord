from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.db.database import get_db
from app.models import Channel, ChannelMember, TextChannel, VoiceChannel, User, ChannelType, VoiceChannelUser, Message
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema
)
from app.schemas.user import UserResponse
from app.core.dependencies import get_current_active_user, get_current_user
from app.websocket.connection_manager import manager

router = APIRouter()

@router.get("/full")
async def get_full_server_data(db: AsyncSession = Depends(get_db)):
    """
    Возвращает всю информацию о серверах, каналах, участниках, последних сообщениях и всех пользователях для сайдбара одним запросом.
    """
    # Получаем все серверы с вложенными каналами и участниками
    stmt = (
        select(Channel)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.members).selectinload(ChannelMember.user),
            selectinload(Channel.text_channels).selectinload(TextChannel.messages).selectinload(Message.author),
            selectinload(Channel.text_channels).selectinload(TextChannel.messages).selectinload(Message.attachments),
            selectinload(Channel.voice_channels).selectinload(VoiceChannel.active_users).selectinload(VoiceChannelUser.user)
        )
        .order_by(Channel.created_at)
    )
    result = await db.execute(stmt)
    channels = result.scalars().unique().all()

    # Получаем всех пользователей для сайдбара
    users_result = await db.execute(select(User))
    all_users = users_result.scalars().all()

    servers = []
    for channel in channels:
        # Участники сервера
        members = [
            {
                "id": m.user.id,
                "username": m.user.display_name or m.user.username,
                "email": m.user.email,
                "is_active": m.user.is_active,
                "is_online": m.user.is_online,
                "created_at": m.user.created_at,
                "updated_at": m.user.updated_at
            }
            for m in channel.members
        ]
        # Текстовые каналы с последними сообщениями
        text_channels = []
        for tc in channel.text_channels:
            # Берём последние 50 сообщений
            messages = sorted(tc.messages, key=lambda m: m.timestamp, reverse=True)[:50]
            messages = list(reversed(messages))
            msg_list = []
            for msg in messages:
                # Обрабатываем случай удаленного пользователя
                if msg.author is None:
                    author_data = {
                        "id": -1,  # Специальный ID для удаленных пользователей
                        "username": "УДАЛЕННЫЙ АККАУНТ",
                        "avatar": None
                    }
                else:
                    author_data = {
                        "id": msg.author.id,
                        "username": msg.author.display_name or msg.author.username,
                        "avatar": getattr(msg.author, 'avatar', None)
                    }
                
                msg_list.append({
                    "id": msg.id,
                    "content": msg.content,
                    "channelId": msg.text_channel_id,
                    "timestamp": msg.timestamp.isoformat(),
                    "author": author_data,
                    "attachments": [
                        {
                            "id": att.id,
                            "file_url": att.file_url
                        } for att in msg.attachments
                    ]
                })
            text_channels.append({
                "id": tc.id,
                "name": tc.name,
                "position": tc.position,
                "created_at": tc.created_at,
                "messages": msg_list
            })
        # Голосовые каналы с активными пользователями
        voice_channels = []
        for vc in channel.voice_channels:
            voice_channels.append({
                "id": vc.id,
                "name": vc.name,
                "position": vc.position,
                "max_users": vc.max_users,
                "created_at": vc.created_at,
                "active_users": [
                    {
                        "id": vcu.user.id,
                        "username": vcu.user.display_name or vcu.user.username,
                        "is_muted": vcu.is_muted,
                        "is_deafened": vcu.is_deafened
                    }
                    for vcu in vc.active_users
                ]
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
                "username": channel.owner.username,
                "email": channel.owner.email,
                "is_active": channel.owner.is_active,
                "is_online": channel.owner.is_online,
                "created_at": channel.owner.created_at,
                "updated_at": channel.owner.updated_at
            },
            "members": members,
            "text_channels": text_channels,
            "voice_channels": voice_channels
        })

    # Данные для сайдбара (все пользователи)
    sidebar_users = [
        {
            "id": u.id,
            "username": u.display_name or u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_online": u.is_online,
            "created_at": u.created_at,
            "updated_at": u.updated_at
        }
        for u in all_users
    ]

    return {
        "servers": servers,
        "sidebar_users": sidebar_users
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
    
    # Отправляем WebSocket уведомление всем пользователям о новом сервере
    await manager.broadcast_to_all({
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
async def get_all_channels(db: AsyncSession = Depends(get_db)):
    """Получение всех каналов (серверов) с вложенными текстовыми и голосовыми каналами"""
    stmt = (
        select(Channel)
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
    db: AsyncSession = Depends(get_db)
):
    """Получение детальной информации о канале"""
    # Получаем основной канал
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
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
    
    return {
        "id": channel.id,
        "name": channel.name,
        "description": channel.description,
        "owner_id": channel.owner_id,
        "type": "server",  # Это сервер, содержащий каналы
        "channels": [
            {"id": tc.id, "name": tc.name, "type": "text", "position": tc.position}
            for tc in text_channels
        ] + [
            {"id": vc.id, "name": vc.name, "type": "voice", "position": vc.position, "max_users": vc.max_users}
            for vc in voice_channels
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
    
    # Отправляем WebSocket уведомление приглашенному пользователю
    await manager.send_to_user(target_user.id, {
        "type": "channel_invitation",
        "channel_id": channel_id,
        "channel_name": channel.name,
        "invited_by": current_user.username
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
    
    # Строим запрос для сообщений
    query = select(Message).where(Message.text_channel_id == channel_id)
    
    # Если указан before, загружаем сообщения до этого ID
    if before:
        query = query.where(Message.id < before)
    
    # Сортируем по времени (новые сначала для пагинации, потом развернем)
    query = query.order_by(Message.timestamp.desc()).limit(limit)
    
    # Загружаем связанные данные
    query = query.options(
        selectinload(Message.author),
        selectinload(Message.attachments)
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
                "avatar": None
            }
        else:
                                author_data = {
                        "id": msg.author.id,
                        "username": msg.author.display_name or msg.author.username,
                        "avatar": getattr(msg.author, 'avatar', None)
                    }
        
        message_dict = {
            "id": msg.id,
            "content": msg.content,
            "channelId": msg.text_channel_id,
            "timestamp": msg.timestamp.isoformat(),
            "author": author_data,
            "attachments": [
                {
                    "id": att.id,
                    "file_url": att.file_url,
                    "filename": getattr(att, 'filename', None)
                } for att in msg.attachments
            ]
        }
        message_list.append(message_dict)
    
    return {
        "messages": message_list,
        "has_more": len(messages) == limit  # Есть ли еще сообщения
    }