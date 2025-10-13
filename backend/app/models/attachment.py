from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from app.db.database import Base

class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=True)  # Nullable для DM
    dm_message_id = Column(Integer, ForeignKey("direct_messages.id"), nullable=True)  # Для DM
    file_url = Column(String, nullable=False)
    
    message = relationship("Message", back_populates="attachments")
    dm_message = relationship("DirectMessage", back_populates="attachments") 