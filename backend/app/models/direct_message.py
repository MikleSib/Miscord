from __future__ import annotations
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, LargeBinary, UniqueConstraint
from sqlalchemy.orm import relationship, Mapped
from datetime import datetime
from app.db.database import Base
from sqlalchemy.sql import func

if TYPE_CHECKING:
    from .user import User
    from .attachment import Attachment
    from .reaction import Reaction

class DirectMessage(Base):
    __tablename__ = "direct_messages"

    client_nonce = Column(String(36), nullable=True)

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    content: Mapped[Optional[str]] = Column(String, nullable=True)  # Nullable для поддержки отправки только фото
    encryption_version = Column(Integer, nullable=False, default=0, server_default="0")
    ciphertext = Column(LargeBinary, nullable=True)
    secret_session_id = Column(String(36), ForeignKey("secret_dm_sessions.id", ondelete="SET NULL"), nullable=True)
    sender_device_id = Column(String(36), nullable=True)
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


class HiddenDmConversation(Base):
    __tablename__ = "hidden_dm_conversations"
    __table_args__ = (
        UniqueConstraint("user_id", "peer_id", name="uq_hidden_dm_conversation_pair"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    peer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    hidden_at = Column(DateTime, nullable=False, server_default=func.now())
