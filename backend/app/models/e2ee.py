from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint, text
from sqlalchemy.sql import func

from app.db.database import Base


class UserE2eeDevice(Base):
    __tablename__ = "user_e2ee_devices"

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    credential_id = Column(String(192), nullable=False)
    key_package = Column(LargeBinary, nullable=False)
    key_package_id = Column(String(36), nullable=False)
    key_package_claimed_at = Column(DateTime(timezone=True), nullable=True)
    signature_public_key = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_user_e2ee_device"),
        Index(
            "uq_user_e2ee_active_device", "user_id", unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )


class SecretDmSession(Base):
    __tablename__ = "secret_dm_sessions"

    id = Column(String(36), primary_key=True)
    user_low_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_high_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    founder_device_id = Column(String(36), ForeignKey("user_e2ee_devices.id"), nullable=False)
    recipient_device_id = Column(String(36), ForeignKey("user_e2ee_devices.id"), nullable=False)
    welcome = Column(LargeBinary, nullable=False)
    ratchet_tree = Column(LargeBinary, nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index(
            "uq_secret_dm_pair_active", "user_low_id", "user_high_id",
            unique=True, postgresql_where=text("active = true"),
        ),
    )
