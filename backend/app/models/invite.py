from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Invite(Base):
    """Приглашение-ссылка на сервер."""

    __tablename__ = "server_invites"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    server_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    inviter_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    target_text_channel_id = Column(Integer, ForeignKey("text_channels.id"), nullable=True)
    max_uses = Column(Integer, nullable=True)  # None = без ограничений
    uses = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # None = бессрочно
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    server = relationship("Channel")
    inviter = relationship("User")
