from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func, text

from app.db.database import Base


class UserPrivacySettings(Base):
    __tablename__ = "user_privacy_settings"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    direct_messages = Column(String(32), nullable=False, default="friends_and_servers")
    friend_requests = Column(String(32), nullable=False, default="everyone")
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class SafetyReport(Base):
    __tablename__ = "safety_reports"

    id = Column(Integer, primary_key=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True, index=True)
    channel_id = Column(Integer, nullable=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    dm_message_id = Column(Integer, ForeignKey("direct_messages.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(32), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(24), nullable=False, default="open", server_default="open", index=True)
    resolution = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class MemberTimeout(Base):
    __tablename__ = "member_timeouts"

    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    moderator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason = Column(String(512), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_member_timeouts_server_user"),
        Index("ix_member_timeouts_active", "server_id", "user_id", "expires_at"),
    )


class AutoModRule(Base):
    __tablename__ = "automod_rules"

    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    trigger_type = Column(String(32), nullable=False)
    config = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    actions = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())
