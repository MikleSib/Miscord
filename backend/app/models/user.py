from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_bot = Column(Boolean, default=False, nullable=False, server_default="false")
    is_online = Column(Boolean, default=False)
    last_activity = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    email_verified_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    # Отношения
    owned_channels = relationship("Channel", back_populates="owner", cascade="all, delete-orphan")
    channel_memberships = relationship("ChannelMember", back_populates="user", cascade="all, delete-orphan")
    messages = relationship(
        "Message",
        foreign_keys="[Message.author_id]",
        back_populates="author",
        cascade="all, delete-orphan",
    )

    # Отношения для дружбы
    friendships_a = relationship("Friendship", foreign_keys="[Friendship.user_a_id]", back_populates="user_a", cascade="all, delete-orphan")
    friendships_b = relationship("Friendship", foreign_keys="[Friendship.user_b_id]", back_populates="user_b", cascade="all, delete-orphan")
