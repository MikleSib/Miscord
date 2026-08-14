from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.sql import func

from app.db.database import Base


class StageInstance(Base):
    __tablename__ = "stage_instances"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'ended')", name="ck_stage_instances_status"),
        Index(
            "uq_active_stage_channel", "channel_id", unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id = Column(Integer, primary_key=True)
    channel_id = Column(Integer, ForeignKey("voice_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    topic = Column(String(120), nullable=False)
    status = Column(String(16), nullable=False, default="active", server_default="active", index=True)
    request_to_speak_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    empty_since = Column(DateTime(timezone=True), nullable=True, index=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)


class StageSpeakerGrant(Base):
    __tablename__ = "stage_speaker_grants"
    __table_args__ = (
        UniqueConstraint("stage_instance_id", "user_id", name="uq_stage_speaker_grant"),
        CheckConstraint("role IN ('speaker', 'moderator')", name="ck_stage_speaker_grant_role"),
    )

    id = Column(Integer, primary_key=True)
    stage_instance_id = Column(Integer, ForeignKey("stage_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    granted_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(16), nullable=False, default="speaker", server_default="speaker")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StageSpeakerRequest(Base):
    __tablename__ = "stage_speaker_requests"
    __table_args__ = (
        UniqueConstraint("stage_instance_id", "user_id", name="uq_stage_speaker_request"),
        CheckConstraint("status IN ('pending', 'accepted', 'declined', 'cancelled')", name="ck_stage_request_status"),
    )

    id = Column(Integer, primary_key=True)
    stage_instance_id = Column(Integer, ForeignKey("stage_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    requested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
