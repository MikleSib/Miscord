from __future__ import annotations
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import relationship, Mapped
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .message import Message
    from .direct_message import DirectMessage

class Reaction(Base):
    __tablename__ = "reactions"
    
    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    emoji: Mapped[str] = Column(String(10), nullable=False)
    user_id: Mapped[int] = Column(Integer, ForeignKey("users.id"), nullable=False)
    message_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("messages.id"), nullable=True)
    dm_message_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("direct_messages.id"), nullable=True)
    
    # Связи
    user: Mapped["User"] = relationship("User")
    message: Mapped[Optional["Message"]] = relationship("Message", back_populates="reactions")
    dm_message: Mapped[Optional["DirectMessage"]] = relationship("DirectMessage", back_populates="reactions")
    
    # Ограничения
    __table_args__ = (
        # Должно быть либо message_id, либо dm_message_id
        CheckConstraint(
            '(message_id IS NOT NULL AND dm_message_id IS NULL) OR (message_id IS NULL AND dm_message_id IS NOT NULL)',
            name='check_message_or_dm'
        ),
        # Уникальность для обычных сообщений
        UniqueConstraint('user_id', 'message_id', 'emoji', name='unique_user_message_emoji'),
        # Уникальность для DM
        UniqueConstraint('user_id', 'dm_message_id', 'emoji', name='unique_user_dm_message_emoji'),
    )
    
    def __repr__(self):
        return f"<Reaction(id={self.id}, emoji={self.emoji}, user_id={self.user_id}, message_id={self.message_id}, dm_message_id={self.dm_message_id})>" 