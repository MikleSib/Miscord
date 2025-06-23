from __future__ import annotations
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship, Mapped
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .channel import TextChannel
    from .attachment import Attachment
    from .reaction import Reaction

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    content: Mapped[Optional[str]] = Column(String(5000))
    timestamp: Mapped[datetime] = Column(DateTime, default=datetime.utcnow)
    author_id: Mapped[int] = Column(Integer, ForeignKey("users.id"))
    text_channel_id: Mapped[int] = Column(Integer, ForeignKey("text_channels.id"))
    is_edited: Mapped[bool] = Column(Boolean, default=False)
    is_deleted: Mapped[bool] = Column(Boolean, default=False)
    reply_to_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("messages.id"), nullable=True)
    
    author: Mapped["User"] = relationship("User")
    text_channel: Mapped["TextChannel"] = relationship("TextChannel")
    attachments: Mapped[List["Attachment"]] = relationship("Attachment", back_populates="message", cascade="all, delete-orphan")
    reactions: Mapped[List["Reaction"]] = relationship("Reaction", back_populates="message", cascade="all, delete-orphan")
    
    # Самосвязь для ответов
    reply_to: Mapped[Optional["Message"]] = relationship("Message", remote_side=[id], backref="replies")

    def __repr__(self):
        return f"<Message(id={self.id}, author_id={self.author_id}, channel_id={self.text_channel_id})>"