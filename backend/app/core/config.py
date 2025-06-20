from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    # База данных
    DATABASE_URL: str = "postgresql://miscord_user:miscord_password@localhost:5432/miscord"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    # Безопасность
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 дней
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000"]
    
    # WebRTC
    ICE_SERVERS: List[dict] = [
        {"urls": ["stun:stun.l.google.com:19302"]},
        {"urls": ["stun:stun1.l.google.com:19302"]}
    ]
    
    class Config:
        env_file = ".env"

settings = Settings()