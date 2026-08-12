from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func, text

from app.db.database import Base


class AccountChallenge(Base):
    __tablename__ = "account_challenges"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    email = Column(String(320), nullable=False, index=True)
    type = Column(String(32), nullable=False, index=True)
    code_digest = Column(String(64), nullable=False)
    payload = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    attempts_remaining = Column(Integer, nullable=False, default=5, server_default="5")
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UserTwoFactor(Base):
    __tablename__ = "user_two_factor"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    secret_ciphertext = Column(Text, nullable=False)
    backup_code_hashes = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    enabled_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())
