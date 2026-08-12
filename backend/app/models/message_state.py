from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func, text

from app.db.database import Base


class MessageDraft(Base):
    __tablename__ = "message_drafts"
    __table_args__ = (UniqueConstraint("user_id", "channel_id", name="uq_message_draft_user_channel"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(String(5000), nullable=False, default="", server_default="")
    attachment_refs = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ChannelReadState(Base):
    __tablename__ = "channel_read_states"
    __table_args__ = (UniqueConstraint("user_id", "channel_id", name="uq_channel_read_user_channel"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    last_read_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class SavedMessage(Base):
    __tablename__ = "saved_messages"
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_saved_message_user_message"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
