from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship, Mapped
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .channel import TextChannel
    from .attachment import Attachment

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    content: Mapped[Optional[str]] = Column(String(5000))
    timestamp: Mapped[datetime] = Column(DateTime, default=datetime.utcnow)
    author_id: Mapped[int] = Column(Integer, ForeignKey("users.id"))
    text_channel_id: Mapped[int] = Column(Integer, ForeignKey("text_channels.id"))
    is_edited: Mapped[bool] = Column(Boolean, default=False)
    
    author: Mapped["User"] = relationship("User")
    text_channel: Mapped["TextChannel"] = relationship("TextChannel")
    attachments: Mapped[List["Attachment"]] = relationship("Attachment", back_populates="message", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Message(id={self.id}, author_id={self.author_id}, channel_id={self.text_channel_id})>"