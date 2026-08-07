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