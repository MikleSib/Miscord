import uuid

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from app.db.database import Base


class RegistrationChallenge(Base):
    __tablename__ = "registration_challenges"
    __table_args__ = (
        UniqueConstraint("email", name="uq_registration_challenges_email"),
        UniqueConstraint("username", name="uq_registration_challenges_username"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(320), nullable=False, index=True)
    username = Column(String(32), nullable=False, index=True)
    display_name = Column(String(100), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    code_digest = Column(String(64), nullable=False)
    attempts_remaining = Column(Integer, nullable=False, default=5)
    resend_count = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    resend_available_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

