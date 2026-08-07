from __future__ import annotations
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship, Mapped
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .channel import TextChannel
    from .attachment import Attachment
    from .reaction import Reaction

class Message(Base):
    __tablename__ = "messages"

    client_nonce = Column(String(36), nullable=True)

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    content: Mapped[Optional[str]] = Column(String(5000))
    timestamp: Mapped[datetime] = Column(DateTime, default=datetime.utcnow)
    author_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("users.id"), nullable=True)
    webhook_id: Mapped[Optional[int]] = Column(Integer, nullable=True, index=True)
    webhook_name: Mapped[Optional[str]] = Column(String(80), nullable=True)
    webhook_avatar_url: Mapped[Optional[str]] = Column(String(2048), nullable=True)
    embeds = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    flags: Mapped[int] = Column(Integer, nullable=False, default=0, server_default="0")
    text_channel_id: Mapped[int] = Column(Integer, ForeignKey("text_channels.id"))
    is_edited: Mapped[bool] = Column(Boolean, default=False)
    is_deleted: Mapped[bool] = Column(Boolean, default=False)
    reply_to_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("messages.id"), nullable=True)
    
    author: Mapped[Optional["User"]] = relationship("User")
    text_channel: Mapped["TextChannel"] = relationship("TextChannel")
    attachments: Mapped[List["Attachment"]] = relationship("Attachment", back_populates="message", cascade="all, delete-orphan")
    reactions: Mapped[List["Reaction"]] = relationship("Reaction", back_populates="message", cascade="all, delete-orphan")
    
    # Самосвязь для ответов
    reply_to: Mapped[Optional["Message"]] = relationship("Message", remote_side=[id], backref="replies")

    __table_args__ = (
        CheckConstraint(
            "(author_id IS NOT NULL AND webhook_id IS NULL) OR "
            "(author_id IS NULL AND webhook_id IS NOT NULL)",
            name="ck_messages_exactly_one_author",
        ),
    )

    def __repr__(self):
        return f"<Message(id={self.id}, author_id={self.author_id}, channel_id={self.text_channel_id})>"
