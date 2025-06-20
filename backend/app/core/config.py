from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # База данных
    DATABASE_URL: str = "postgresql://miscord_user:miscord_password@localhost:5432/miscord"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    # Безопасность
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 дней
    
    # CORS - разрешаем все домены
    CORS_ORIGINS: str = "*"
    
    # WebRTC
    ICE_SERVERS: List[dict] = [
        {"urls": ["stun:stun.l.google.com:19302"]},
        {"urls": ["stun:stun1.l.google.com:19302"]}
    ]
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Преобразует строку CORS_ORIGINS в список"""
        if self.CORS_ORIGINS == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    class Config:
        env_file = ".env"

settings = Settings()