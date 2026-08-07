import enum

from sqlalchemy import BigInteger, Column, Enum, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.database import Base


class ChannelKind(str, enum.Enum):
    TEXT = "text"
    VOICE = "voice"


class OverwriteTargetType(str, enum.Enum):
    ROLE = "role"
    MEMBER = "member"


class ChannelPermissionOverwrite(Base):
    """Переопределение прав для конкретного текстового или голосового канала."""

    __tablename__ = "channel_permission_overwrites"
    __table_args__ = (
        UniqueConstraint(
            "channel_kind",
            "channel_id",
            "target_type",
            "target_id",
            name="uq_channel_permission_overwrite_target",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_kind = Column(Enum(ChannelKind, name="channel_kind"), nullable=False)
    channel_id = Column(Integer, nullable=False, index=True)
    target_type = Column(Enum(OverwriteTargetType, name="overwrite_target_type"), nullable=False)
    target_id = Column(Integer, nullable=False)
    allow = Column(BigInteger, default=0, nullable=False)
    deny = Column(BigInteger, default=0, nullable=False)

    server = relationship("Channel")
