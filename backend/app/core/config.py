from pydantic_settings import BaseSettings
from typing import List
import json
import logging
import os

logger = logging.getLogger(__name__)

_INSECURE_SECRET_DEFAULTS = {
    "your-secret-key-here-change-in-production",
    "miscord-prod-secret-change-me-please-9f3a2c",
    "secret",
    "changeme",
}

class Settings(BaseSettings):
    # База данных
    DATABASE_URL: str = "postgresql://miscord_user:miscord_password@localhost:5432/miscord"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Miscord Voice v1 media plane
    VOICE_MEDIA_JWT_SECRET: str = ""
    VOICE_MEDIA_WS_URL: str = ""
    VOICE_MEDIA_AUDIENCE: str = "miscord-voice-media"
    VOICE_MEDIA_TICKET_TTL_SECONDS: int = 60
    VOICE_SESSION_TTL_SECONDS: int = 120

    # Community phase one feature switches. They are intentionally disabled by
    # default so migrations can be deployed before each product surface opens.
    THREADS_ENABLED: bool = False
    FORUMS_ENABLED: bool = False
    POLLS_ENABLED: bool = False
    INBOX_ENABLED: bool = False
    SERVER_TEMPLATES_ENABLED: bool = False
    SERVER_IMPORTS_ENABLED: bool = True
    OUTBOX_POLL_INTERVAL_SECONDS: float = 0.25
    OUTBOX_BATCH_SIZE: int = 100

    # External server import. Public template imports work without OAuth.
    # ID-based imports require a dedicated provider application and bot.
    SOURCE_IMPORT_CLIENT_ID: str = ""
    SOURCE_IMPORT_CLIENT_SECRET: str = ""
    SOURCE_IMPORT_BOT_TOKEN: str = ""
    EXTERNAL_IMPORT_ENCRYPTION_KEY: str = ""
    EXTERNAL_IMPORT_TTL_HOURS: int = 24

    # Incoming webhooks
    WEBHOOKS_ENABLED: bool = True
    WEBHOOK_FILES_ENABLED: bool = True
    WEBHOOK_TOKEN_ENCRYPTION_KEY: str = ""
    BOT_PLATFORM_ENABLED: bool = False
    BOT_SECRET_ENCRYPTION_KEY: str = ""
    ATTACHMENT_SIGNING_KEY: str = ""
    ATTACHMENT_STORAGE_DIR: str = "/app/data/attachments"
    ATTACHMENT_QUARANTINE_DIR: str = "/app/data/quarantine"
    ATTACHMENT_X_ACCEL_ENABLED: bool = False
    ATTACHMENT_URL_TTL_SECONDS: int = 86400
    ATTACHMENT_DISK_RESERVE_BYTES: int = 1073741824
    S3_ENABLED: bool = False
    S3_ENDPOINT_URL: str = "https://s3.twcstorage.ru"
    S3_REGION: str = "ru-1"
    S3_BUCKET: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_KEY_PREFIX: str = "miscord"
    S3_CDN_BASE_URL: str = ""
    S3_CDN_SECURE_TOKEN: str = ""
    S3_DELIVERY_URL_TTL_SECONDS: int = 86400
    CLAMAV_HOST: str = "clamav"
    CLAMAV_PORT: int = 3310
    CLAMAV_SCAN_CONCURRENCY: int = 2
    CLAMAV_SCAN_TIMEOUT_SECONDS: int = 30

    # Безопасность
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 2  # 2 дня
    ENVIRONMENT: str = "development"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://miscord.ru",
        "https://www.miscord.ru",
        "https://stream-cash.ru",
        "https://www.stream-cash.ru",
    ]

    # Сервер
    SERVER_HOST: str = "https://miscord.ru"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Обработка CORS_ORIGINS из переменной окружения
        cors_origins_env = os.getenv("CORS_ORIGINS")
        if cors_origins_env:
            try:
                self.CORS_ORIGINS = json.loads(cors_origins_env)
            except json.JSONDecodeError:
                # Если не JSON, то разделяем по запятой
                self.CORS_ORIGINS = [origin.strip() for origin in cors_origins_env.split(",")]

        env = (self.ENVIRONMENT or os.getenv("ENVIRONMENT") or "development").lower()
        if self.SECRET_KEY in _INSECURE_SECRET_DEFAULTS or len(self.SECRET_KEY) < 32:
            msg = (
                "SECRET_KEY слабый или дефолтный. Задайте длинный случайный SECRET_KEY в env."
            )
            if env in {"production", "prod"}:
                raise RuntimeError(msg)
            logger.warning(msg)
        if self.WEBHOOKS_ENABLED and env in {"production", "prod"} and not self.WEBHOOK_TOKEN_ENCRYPTION_KEY:
            raise RuntimeError("WEBHOOK_TOKEN_ENCRYPTION_KEY is required when webhooks are enabled in production.")
        if self.BOT_PLATFORM_ENABLED and env in {"production", "prod"} and not self.BOT_SECRET_ENCRYPTION_KEY:
            raise RuntimeError("BOT_SECRET_ENCRYPTION_KEY is required when the bot platform is enabled in production.")
        import_oauth_values = (
            self.SOURCE_IMPORT_CLIENT_ID,
            self.SOURCE_IMPORT_CLIENT_SECRET,
            self.SOURCE_IMPORT_BOT_TOKEN,
        )
        if any(import_oauth_values) and not all(import_oauth_values):
            raise RuntimeError("All SOURCE_IMPORT_* OAuth settings must be configured together.")
        if all(import_oauth_values) and env in {"production", "prod"} and not self.EXTERNAL_IMPORT_ENCRYPTION_KEY:
            raise RuntimeError("EXTERNAL_IMPORT_ENCRYPTION_KEY is required for ID-based imports in production.")
        if env in {"production", "prod"} and not self.VOICE_MEDIA_JWT_SECRET:
            raise RuntimeError("VOICE_MEDIA_JWT_SECRET is required for Miscord Voice v1 in production.")
        if self.S3_ENABLED:
            required = {
                "S3_BUCKET": self.S3_BUCKET,
                "S3_ACCESS_KEY_ID": self.S3_ACCESS_KEY_ID,
                "S3_SECRET_ACCESS_KEY": self.S3_SECRET_ACCESS_KEY,
            }
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise RuntimeError(f"Missing required S3 settings: {', '.join(missing)}")
            if env in {"production", "prod"} and self.S3_CDN_BASE_URL and not self.S3_CDN_SECURE_TOKEN:
                logger.warning("S3 CDN is configured without Secure token; object URLs will be public.")

    # WebRTC. TURN обязателен для абонентов за разными или строгими NAT.
    # Production передаёт полный список через JSON-переменную ICE_SERVERS.
    ICE_SERVERS: List[dict] = [
        {"urls": ["stun:stun.l.google.com:19302"]},
        {"urls": ["stun:stun1.l.google.com:19302"]},
    ]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
