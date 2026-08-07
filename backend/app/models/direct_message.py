from __future__ import annotations
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship, Mapped
from datetime import datetime
from app.db.database import Base

if TYPE_CHECKING:
    from .user import User
    from .attachment import Attachment
    from .reaction import Reaction

class DirectMessage(Base):
    __tablename__ = "direct_messages"

    client_nonce = Column(String(36), nullable=True)

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    content: Mapped[Optional[str]] = Column(String, nullable=True)  # Nullable для поддержки отправки только фото
    timestamp: Mapped[datetime] = Column(DateTime, default=datetime.utcnow)
    reply_to_id: Mapped[Optional[int]] = Column(Integer, ForeignKey("direct_messages.id"), nullable=True)
    
    sender_id: Mapped[int] = Column(Integer, ForeignKey("users.id"))
    recipient_id: Mapped[int] = Column(Integer, ForeignKey("users.id"))

    sender: Mapped["User"] = relationship("User", foreign_keys=[sender_id])
    recipient: Mapped["User"] = relationship("User", foreign_keys=[recipient_id])
    
    # Связь с вложениями
    attachments: Mapped[List["Attachment"]] = relationship("Attachment", back_populates="dm_message", cascade="all, delete-orphan")
    
    # Связь с реакциями
    reactions: Mapped[List["Reaction"]] = relationship("Reaction", back_populates="dm_message", cascade="all, delete-orphan")
    
    # Самосвязь для ответов
    reply_to: Mapped[Optional["DirectMessage"]] = relationship("DirectMessage", remote_side=[id], backref="replies")
