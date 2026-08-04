from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class AuditLog(Base):
    """Запись журнала аудита сервера."""

    __tablename__ = "server_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False, index=True)
    target_type = Column(String, nullable=True)  # server / channel / member / role / invite
    target_id = Column(Integer, nullable=True)
    target_name = Column(String, nullable=True)
    changes = Column(JSON, nullable=True)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    actor = relationship("User")
