from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


BOT_DEFAULT_INTENTS = (1 << 0) | (1 << 9)


class BotApplication(Base):
    __tablename__ = "bot_applications"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    client_id = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(80), nullable=False)
    description = Column(String(400), nullable=True)
    avatar_url = Column(String(2048), nullable=True)
    banner_url = Column(String(2048), nullable=True)
    public_key = Column(String(64), nullable=False)
    bot_public = Column(Boolean, nullable=False, default=True, server_default="true")
    bot_require_code_grant = Column(Boolean, nullable=False, default=False, server_default="false")
    terms_of_service_url = Column(String(2048), nullable=True)
    privacy_policy_url = Column(String(2048), nullable=True)
    redirect_uris = Column(JSON, nullable=False, default=list)
    interactions_endpoint_url = Column(String(2048), nullable=True)
    event_webhooks_url = Column(String(2048), nullable=True)
    event_webhooks_status = Column(Integer, nullable=False, default=1, server_default="1")
    event_webhooks_types = Column(JSON, nullable=False, default=list)
    tags = Column(JSON, nullable=False, default=list)
    install_params = Column(JSON, nullable=True)
    integration_types_config = Column(JSON, nullable=False, default=dict)
    custom_install_url = Column(String(2048), nullable=True)
    flags = Column(BigInteger, nullable=False, default=0, server_default="0")
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
    client_secret_hash = Column(String(64), nullable=False)
    client_secret_hint = Column(String(12), nullable=False)
    client_secret_rotation_id = Column(Integer, nullable=False, default=1, server_default="1")
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
    legacy_permissions = Column("permissions", BigInteger, nullable=False, default=0, server_default="0")
    permissions = Column("permissions_v10", BigInteger, nullable=False, default=0, server_default="0")
    status = Column(String(20), nullable=False, default="active", server_default="active", index=True)
    intents = Column(BigInteger, nullable=False, default=BOT_DEFAULT_INTENTS, server_default=str(BOT_DEFAULT_INTENTS))
    installed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication", back_populates="installs")
    server = relationship("Channel")
    installed_by = relationship("User")


class BotSession(Base):
    __tablename__ = "bot_sessions"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(64), nullable=False, unique=True, index=True)
    intents = Column(BigInteger, nullable=False, default=BOT_DEFAULT_INTENTS, server_default=str(BOT_DEFAULT_INTENTS))
    sequence = Column(BigInteger, nullable=False, default=0, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    is_resumable = Column(Boolean, nullable=False, default=True, server_default="true")
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication")


class BotCommand(Base):
    __tablename__ = "bot_commands"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    server_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(32), nullable=False)
    description = Column(String(100), nullable=False)
    command_type = Column(Integer, nullable=False, default=1, server_default="1")
    dm_permission = Column(Boolean, nullable=False, default=True, server_default="true")
    legacy_default_member_permissions = Column("default_member_permissions", BigInteger, nullable=True)
    default_member_permissions = Column("default_member_permissions_v10", BigInteger, nullable=True)
    name_localizations = Column(JSON, nullable=True)
    description_localizations = Column(JSON, nullable=True)
    contexts = Column(JSON, nullable=True)
    integration_types = Column(JSON, nullable=True)
    nsfw = Column(Boolean, nullable=False, default=False, server_default="false")
    definition = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    is_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    allowed_user_ids = Column(JSON, nullable=False, default=list)
    allowed_role_ids = Column(JSON, nullable=False, default=list)
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


class BotInteraction(Base):
    __tablename__ = "bot_interactions"
    __table_args__ = (UniqueConstraint("interaction_id", "interaction_token", name="uq_bot_interaction_id_token"),)

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    interaction_id = Column(String(64), nullable=False)
    interaction_token = Column(String(255), nullable=False)
    interaction_type = Column(Integer, nullable=False, default=2, server_default="2")
    request_payload = Column(JSON, nullable=False, default=dict)
    guild_id = Column(BigInteger, nullable=True)
    channel_id = Column(BigInteger, nullable=True)
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    command_id = Column(Integer, ForeignKey("bot_commands.id", ondelete="SET NULL"), nullable=True)
    response_type = Column(Integer, nullable=True)
    response_payload = Column(JSON, nullable=True)
    responded = Column(Boolean, nullable=False, default=False, server_default="false")
    deferred = Column(Boolean, nullable=False, default=False, server_default="false")
    ephemeral = Column(Boolean, nullable=False, default=False, server_default="false")
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    original_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    application = relationship("BotApplication")


class BotInteractionMessage(Base):
    __tablename__ = "bot_interaction_messages"
    __table_args__ = (UniqueConstraint("interaction_id", "message_id", name="uq_bot_interaction_message"),)

    id = Column(Integer, primary_key=True)
    interaction_id = Column(Integer, ForeignKey("bot_interactions.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    is_original = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    interaction = relationship("BotInteraction")
    message = relationship("Message")


class BotOAuthAuthorizationCode(Base):
    __tablename__ = "bot_oauth_authorization_codes"

    id = Column(Integer, primary_key=True)
    code_hash = Column(String(64), nullable=False, unique=True, index=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    redirect_uri = Column(String(2048), nullable=False)
    scopes = Column(JSON, nullable=False, default=list)
    guild_id = Column(BigInteger, nullable=True)
    permissions = Column(BigInteger, nullable=False, default=0, server_default="0")
    code_challenge = Column(String(128), nullable=True)
    code_challenge_method = Column(String(10), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    application = relationship("BotApplication")
    user = relationship("User")


class BotOAuthToken(Base):
    __tablename__ = "bot_oauth_tokens"

    id = Column(Integer, primary_key=True)
    access_token_hash = Column(String(64), nullable=False, unique=True, index=True)
    refresh_token_hash = Column(String(64), nullable=True, unique=True, index=True)
    application_id = Column(Integer, ForeignKey("bot_applications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    scopes = Column(JSON, nullable=False, default=list)
    grant_type = Column(String(32), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    application = relationship("BotApplication")
    user = relationship("User")
