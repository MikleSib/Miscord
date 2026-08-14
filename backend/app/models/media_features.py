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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db.database import Base


class ServerExpression(Base):
    __tablename__ = "server_expressions"
    __table_args__ = (
        CheckConstraint("kind IN ('emoji', 'sticker', 'sound')", name="ck_server_expressions_kind"),
        Index(
            "uq_available_server_expression_name",
            "server_id", "kind", "name",
            unique=True,
            postgresql_where=text("available = true"),
        ),
    )

    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(16), nullable=False, index=True)
    name = Column(String(64), nullable=False)
    description = Column(String(160), nullable=True)
    storage_key = Column(String(512), nullable=False, unique=True)
    file_url = Column(String(2048), nullable=False)
    content_type = Column(String(128), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    animated = Column(Boolean, nullable=False, default=False, server_default="false")
    available = Column(Boolean, nullable=False, default=True, server_default="true", index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class MessageMedia(Base):
    __tablename__ = "message_media"
    __table_args__ = (
        CheckConstraint("media_type IN ('sticker', 'gif')", name="ck_message_media_type"),
        CheckConstraint(
            "(message_id IS NOT NULL AND dm_message_id IS NULL) OR "
            "(message_id IS NULL AND dm_message_id IS NOT NULL)",
            name="ck_message_media_one_target",
        ),
    )

    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=True, index=True)
    dm_message_id = Column(Integer, ForeignKey("direct_messages.id", ondelete="CASCADE"), nullable=True, index=True)
    expression_id = Column(Integer, ForeignKey("server_expressions.id", ondelete="SET NULL"), nullable=True)
    media_type = Column(String(16), nullable=False)
    position = Column(Integer, nullable=False, default=0, server_default="0")
    provider = Column(String(24), nullable=True)
    provider_id = Column(String(128), nullable=True)
    metadata_json = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
