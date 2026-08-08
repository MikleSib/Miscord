from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class BotApplication(Base):
    __tablename__ = "bot_applications"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    client_id = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(80), nullable=False)
    description = Column(String(400), nullable=True)
    avatar_url = Column(String(2048), nullable=True)
    public_key = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="active", server_default="active", index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[owner_id])
    bot_user = relationship("User", foreign_keys=[bot_user_id])
    secret = relationship("BotApplicationSecret", back_populates="application", uselist=False, cascade="all, delete-orphan")
    tokens = relationship("BotToken", back_populates="application", cascade="all, delete-orphan")
    installs = relationship("BotInstall", back_populates="application", cascade="all, delete-orphan")
    commands = relationship("BotCommand", back_populates="application", cascade="all, delete-orphan")


class BotApplicationSecret(Base):
    __tablename__ = "bot_application_secrets"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, unique=True)
    signing_private_key_ciphertext = Column(Text, nullable=False)
    token_rotation_id = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication", back_populates="secret")


class BotToken(Base):
    __tablename__ = "bot_tokens"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    token_hint = Column(String(12), nullable=False)
    rotation_id = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)

    application = relationship("BotApplication", back_populates="tokens")


class BotInstall(Base):
    __tablename__ = "bot_installs"
    __table_args__ = (UniqueConstraint("application_id", "server_id", name="uq_bot_install_application_server"),)

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    installed_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("server_roles.id", ondelete="SET NULL"), nullable=True, index=True)
    scopes = Column(JSON, nullable=False, default=list)
    permissions = Column(BigInteger, nullable=False, default=0, server_default="0")
    status = Column(String(20), nullable=False, default="active", server_default="active", index=True)
    installed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication", back_populates="installs")
    server = relationship("Channel")
    installed_by = relationship("User")


class BotCommand(Base):
    __tablename__ = "bot_commands"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(32), nullable=False)
    description = Column(String(100), nullable=False)
    definition = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    is_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication", back_populates="commands")
    server = relationship("Channel")


class BotAuditLog(Base):
    __tablename__ = "bot_audit_logs"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(48), nullable=False, index=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    application = relationship("BotApplication")
    actor = relationship("User")
