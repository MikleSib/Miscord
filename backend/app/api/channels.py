from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import List
from app.db.database import get_db
from app.models import Channel, ChannelMember, TextChannel, VoiceChannel, User, ChannelType, VoiceChannelUser
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema
)
from app.schemas.user import UserResponse
from app.core.dependencies import get_current_active_user, get_current_user
from app.websocket.connection_manager import manager

router = APIRouter()

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
async def get_user_channels(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение каналов пользователя"""
    result = await db.execute(
        select(Channel).join(ChannelMember).where(
            ChannelMember.user_id == current_user.id
        )
    )
    channels = result.scalars().all()
    
    return [
        {
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "owner_id": channel.owner_id,
            "created_at": channel.created_at,
            "updated_at": channel.updated_at,
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
            "members_count": 0
        }
        for channel in channels
    ]

@router.get("/{channel_id}")
async def get_channel_details(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение детальной информации о канале"""
    # Проверяем членство
    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this channel"
        )
    
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
    # Проверка прав (только владелец)
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    
    if not channel or channel.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can create channels"
        )
    
    # Создание текстового канала
    new_text_channel = TextChannel(
        name=channel_data.name,
        channel_id=channel_id,
        position=channel_data.position
    )
    db.add(new_text_channel)
    await db.commit()
    await db.refresh(new_text_channel)
    
    # Отправляем WebSocket уведомление всем участникам сервера
    await manager.send_to_channel(channel_id, {
        "type": "text_channel_created",
        "channel_id": channel_id,
        "text_channel": {
            "id": new_text_channel.id,
            "name": new_text_channel.name,
            "type": "text",
            "position": new_text_channel.position,
            "server_id": channel_id
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
    # Проверка прав (только владелец)
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    
    if not channel or channel.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can create channels"
        )
    
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
    
    # Отправляем WebSocket уведомление всем участникам сервера
    await manager.send_to_channel(channel_id, {
        "type": "voice_channel_created",
        "channel_id": channel_id,
        "voice_channel": {
            "id": new_voice_channel.id,
            "name": new_voice_channel.name,
            "type": "voice",
            "position": new_voice_channel.position,
            "max_users": new_voice_channel.max_users,
            "server_id": channel_id
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
    # Проверяем, что текущий пользователь является участником канала
    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this channel"
        )
    
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
    # Проверяем членство
    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this channel"
        )
    
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
    
    # Проверяем членство в основном канале
    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == voice_channel.channel_id,
                ChannelMember.user_id == current_user.id
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this channel"
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
            "username": user.username,
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