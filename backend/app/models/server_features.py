from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func, text

from app.db.database import Base


class ServerOnboarding(Base):
    __tablename__ = "server_onboarding"
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    welcome_text = Column(String(1000), nullable=True)
    rules = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    prompts = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    default_channel_ids = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    updated_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ServerOnboardingMember(Base):
    __tablename__ = "server_onboarding_members"
    __table_args__ = (UniqueConstraint("server_id", "user_id", name="uq_server_onboarding_member"),)
    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    selected_channel_ids = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    answers = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    accepted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ScheduledEvent(Base):
    __tablename__ = "scheduled_events"
    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    entity_type = Column(String(16), nullable=False, default="voice", server_default="voice")
    channel_id = Column(Integer, ForeignKey("voice_channels.id", ondelete="SET NULL"), nullable=True)
    location = Column(String(200), nullable=True)
    scheduled_start_at = Column(DateTime(timezone=True), nullable=False, index=True)
    scheduled_end_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(16), nullable=False, default="scheduled", server_default="scheduled", index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())


class ScheduledEventInterest(Base):
    __tablename__ = "scheduled_event_interests"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_scheduled_event_interest"),)
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("scheduled_events.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
