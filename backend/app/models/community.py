from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db.database import Base


class ThreadMember(Base):
    __tablename__ = "thread_members"

    id = Column(Integer, primary_key=True)
    thread_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    notification_level = Column(String(16), nullable=False, server_default="all")
    last_read_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        UniqueConstraint("thread_id", "user_id", name="uq_thread_members_thread_user"),
        CheckConstraint(
            "notification_level IN ('all', 'mentions', 'none')",
            name="ck_thread_members_notification_level",
        ),
    )


class ForumSettings(Base):
    __tablename__ = "forum_settings"

    channel_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), primary_key=True)
    guidelines = Column(Text, nullable=True)
    default_layout = Column(String(16), nullable=False, server_default="list")
    default_sort = Column(String(24), nullable=False, server_default="latest_activity")
    require_tag = Column(Boolean, nullable=False, server_default="false")
    auto_archive_minutes = Column(Integer, nullable=False, server_default="10080")

    __table_args__ = (
        CheckConstraint("default_layout IN ('list', 'gallery')", name="ck_forum_layout"),
        CheckConstraint(
            "default_sort IN ('latest_activity', 'created_at')",
            name="ck_forum_sort",
        ),
    )


class ForumTag(Base):
    __tablename__ = "forum_tags"

    id = Column(Integer, primary_key=True)
    channel_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(32), nullable=False)
    emoji = Column(String(128), nullable=True)
    moderated = Column(Boolean, nullable=False, server_default="false")
    position = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint("channel_id", "name", name="uq_forum_tags_channel_name"),
    )


class ForumPostTag(Base):
    __tablename__ = "forum_post_tags"

    post_id = Column(Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("forum_tags.id", ondelete="CASCADE"), primary_key=True)


class Poll(Base):
    __tablename__ = "polls"

    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    question = Column(String(300), nullable=False)
    allow_multiselect = Column(Boolean, nullable=False, server_default="false")
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    closed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PollAnswer(Base):
    __tablename__ = "poll_answers"

    id = Column(Integer, primary_key=True)
    poll_id = Column(Integer, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    text = Column(String(200), nullable=False)
    emoji = Column(String(128), nullable=True)
    position = Column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("poll_id", "position", name="uq_poll_answers_position"),
    )


class PollVote(Base):
    __tablename__ = "poll_votes"

    id = Column(BigInteger, primary_key=True)
    poll_id = Column(Integer, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    answer_id = Column(Integer, ForeignKey("poll_answers.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("poll_id", "answer_id", "user_id", name="uq_poll_votes_poll_answer_user"),
        Index("ix_poll_votes_poll_user", "poll_id", "user_id"),
    )


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(32), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    channel_id = Column(Integer, ForeignKey("text_channels.id", ondelete="SET NULL"), nullable=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    dedupe_key = Column(String(160), nullable=True)
    payload = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    read_at = Column(DateTime(timezone=True), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_user_notifications_dedupe"),
        Index("ix_user_notifications_inbox", "user_id", "read_at", "created_at"),
    )


class ServerTemplate(Base):
    __tablename__ = "server_templates"

    id = Column(Integer, primary_key=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_server_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    icon = Column(String(32), nullable=True)
    schema_version = Column(Integer, nullable=False, server_default="1")
    definition = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ExternalServerImport(Base):
    __tablename__ = "external_server_imports"

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(24), nullable=False, server_default="community_source")
    source_kind = Column(String(16), nullable=False)
    external_server_id = Column(String(32), nullable=True, index=True)
    status = Column(String(24), nullable=False, server_default="pending")
    display_name = Column(String(100), nullable=True)
    definition = Column(JSONB, nullable=True)
    warnings = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    oauth_state_hash = Column(String(64), nullable=True, unique=True)
    oauth_access_token = Column(Text, nullable=True)
    oauth_refresh_token = Column(Text, nullable=True)
    oauth_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_server_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        CheckConstraint("provider IN ('community_source')", name="ck_external_import_provider"),
        CheckConstraint("source_kind IN ('template', 'oauth')", name="ck_external_import_source_kind"),
        CheckConstraint(
            "status IN ('pending', 'awaiting_oauth', 'awaiting_bot', 'scanning', 'ready', 'creating', 'completed', 'failed', 'cancelled')",
            name="ck_external_import_status",
        ),
        Index("ix_external_import_owner_status", "user_id", "status", "created_at"),
    )


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id = Column(String(36), primary_key=True)
    event_type = Column(String(64), nullable=False, index=True)
    topic = Column(String(16), nullable=False)
    target_id = Column(Integer, nullable=True, index=True)
    payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    available_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)
    attempts = Column(Integer, nullable=False, server_default="0")
    last_error = Column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint("topic IN ('user', 'channel', 'server', 'broadcast')", name="ck_outbox_topic"),
        Index("ix_outbox_pending", "published_at", "available_at", "created_at"),
    )
