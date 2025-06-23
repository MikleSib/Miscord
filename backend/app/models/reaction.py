from __future__ import annotations
from typing import TYPE_CHECKING

from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship, Mapped
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .message import Message

class Reaction(Base):
    __tablename__ = "reactions"
    
    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    emoji: Mapped[str] = Column(String(10), nullable=False)
    user_id: Mapped[int] = Column(Integer, ForeignKey("users.id"), nullable=False)
    message_id: Mapped[int] = Column(Integer, ForeignKey("messages.id"), nullable=False)
    
    # Связи
    user: Mapped["User"] = relationship("User")
    message: Mapped["Message"] = relationship("Message", back_populates="reactions")
    
    # Уникальность: один пользователь может поставить только одну реакцию определенного типа на сообщение
    __table_args__ = (UniqueConstraint('user_id', 'message_id', 'emoji', name='unique_user_message_emoji'),)
    
    def __repr__(self):
        return f"<Reaction(id={self.id}, emoji={self.emoji}, user_id={self.user_id}, message_id={self.message_id})>" 