from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings

# Создаем асинхронный движок для PostgreSQL с увеличенным пулом соединений
engine = create_async_engine(
    settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
    echo=True,
    pool_size=20,              # Увеличиваем основной пул до 20
    max_overflow=30,           # Позволяем до 30 дополнительных соединений
    pool_timeout=30,           # Таймаут ожидания соединения 30 сек
    pool_recycle=1800,         # Переиспользуем соединения каждые 30 мин
    pool_pre_ping=True,        # Проверяем соединения перед использованием
)

# Создаем асинхронную сессию
AsyncSessionLocal = async_sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

# Базовый класс для моделей
Base = declarative_base()

# Dependency для получения сессии БД
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()