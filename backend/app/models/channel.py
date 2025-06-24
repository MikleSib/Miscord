from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base
import enum

class ChannelType(str, enum.Enum):
    TEXT = "text"
    VOICE = "voice"

class Channel(Base):
    __tablename__ = "channels"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    icon = Column(String, nullable=True)  # URL иконки сервера
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Отношения
    owner = relationship("User", back_populates="owned_channels")
    text_channels = relationship("TextChannel", back_populates="channel", cascade="all, delete-orphan")
    voice_channels = relationship("VoiceChannel", back_populates="channel", cascade="all, delete-orphan")
    members = relationship("ChannelMember", back_populates="channel", cascade="all, delete-orphan")

class TextChannel(Base):
    __tablename__ = "text_channels"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Отношения
    channel = relationship("Channel", back_populates="text_channels")
    messages = relationship("Message", back_populates="text_channel", cascade="all, delete-orphan")

class VoiceChannel(Base):
    __tablename__ = "voice_channels"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    position = Column(Integer, default=0)
    max_users = Column(Integer, default=10)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Отношения
    channel = relationship("Channel", back_populates="voice_channels")
    active_users = relationship("VoiceChannelUser", back_populates="voice_channel", cascade="all, delete-orphan")

class ChannelMember(Base):
    __tablename__ = "channel_members"
    
    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Отношения
    channel = relationship("Channel", back_populates="members")
    user = relationship("User", back_populates="channel_memberships")

class VoiceChannelUser(Base):
    __tablename__ = "voice_channel_users"
    
    id = Column(Integer, primary_key=True, index=True)
    voice_channel_id = Column(Integer, ForeignKey("voice_channels.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    is_muted = Column(Boolean, default=False)
    is_deafened = Column(Boolean, default=False)
    
    # Отношения
    voice_channel = relationship("VoiceChannel", back_populates="active_users")
    user = relationship("User")