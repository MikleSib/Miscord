from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class ServerBan(Base):
    """Бан пользователя на сервере."""

    __tablename__ = "server_bans"
    __table_args__ = (UniqueConstraint("server_id", "user_id", name="uq_server_ban"),)

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    moderator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    moderator = relationship("User", foreign_keys=[moderator_id])
