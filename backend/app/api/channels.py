from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import List
from app.db.database import get_db
from app.models import Channel, ChannelMember, TextChannel, VoiceChannel, User
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema
)
from app.core.dependencies import get_current_active_user

router = APIRouter()

@router.post("/", response_model=ChannelSchema)
async def create_channel(
    channel_data: ChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание нового канала (сервера)"""
    # Создание канала
    new_channel = Channel(
        name=channel_data.name,
        description=channel_data.description,
        owner_id=current_user.id
    )
    db.add(new_channel)
    await db.flush()
    
    # Добавление владельца как участника
    member = ChannelMember(
        channel_id=new_channel.id,
        user_id=current_user.id
    )
    db.add(member)
    
    # Создание стандартных каналов
    general_text = TextChannel(
        name="general",
        channel_id=new_channel.id,
        position=0
    )
    general_voice = VoiceChannel(
        name="General",
        channel_id=new_channel.id,
        position=0
    )
    db.add(general_text)
    db.add(general_voice)
    
    await db.commit()
    await db.refresh(new_channel)
    
    # Загрузка связанных данных
    result = await db.execute(
        select(Channel)
        .where(Channel.id == new_channel.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
    )
    return result.scalar_one()

@router.get("/", response_model=List[ChannelSchema])
async def get_user_channels(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка каналов пользователя"""
    result = await db.execute(
        select(Channel)
        .join(ChannelMember)
        .where(ChannelMember.user_id == current_user.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
    )
    channels = result.scalars().all()
    
    # Подсчет участников для каждого канала
    for channel in channels:
        count_result = await db.execute(
            select(func.count(ChannelMember.id))
            .where(ChannelMember.channel_id == channel.id)
        )
        channel.members_count = count_result.scalar()
    
    return channels

@router.get("/{channel_id}", response_model=ChannelSchema)
async def get_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение информации о канале"""
    # Проверка членства
    member_result = await db.execute(
        select(ChannelMember)
        .where(
            (ChannelMember.channel_id == channel_id) &
            (ChannelMember.user_id == current_user.id)
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this channel"
        )
    
    # Получение канала
    result = await db.execute(
        select(Channel)
        .where(Channel.id == channel_id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )
    
    # Подсчет участников
    count_result = await db.execute(
        select(func.count(ChannelMember.id))
        .where(ChannelMember.channel_id == channel_id)
    )
    channel.members_count = count_result.scalar()
    
    return channel

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
    
    return new_voice_channel