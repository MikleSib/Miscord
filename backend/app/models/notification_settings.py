from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class ServerNotificationSettings(Base):
    """Персональные настройки уведомлений пользователя на сервере."""

    __tablename__ = "server_notification_settings"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_notification_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    muted = Column(Boolean, default=False, nullable=False)
    # all | mentions | nothing
    notification_level = Column(String(16), default="all", nullable=False)
    suppress_everyone = Column(Boolean, default=False, nullable=False)
    suppress_roles = Column(Boolean, default=False, nullable=False)
    suppress_highlights = Column(Boolean, default=False, nullable=False)
    mute_events = Column(Boolean, default=False, nullable=False)
    mobile_push = Column(Boolean, default=True, nullable=False)

    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    server = relationship("Channel")
    user = relationship("User")


class ChannelNotificationOverride(Base):
    """Переопределение уведомлений для конкретного текстового канала."""

    __tablename__ = "channel_notification_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "text_channel_id", name="uq_channel_notification_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    text_channel_id = Column(
        Integer, ForeignKey("text_channels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # all | mentions | nothing | muted
    level = Column(String(16), nullable=False)

    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    server = relationship("Channel")
    user = relationship("User")
    text_channel = relationship("TextChannel")
