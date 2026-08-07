from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from app.db.database import Base


class PendingChatUpload(Base):
    __tablename__ = "pending_chat_uploads"

    id = Column(String(36), primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_key = Column(String(512), nullable=False, unique=True)
    file_url = Column(String(2048), nullable=False)
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(255), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
