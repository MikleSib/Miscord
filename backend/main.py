from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import logging

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels
from app.websocket import chat, voice
from app.websocket.connection_manager import manager
from app.websocket.chat import websocket_chat_endpoint, websocket_notifications_endpoint
from app.websocket.voice import websocket_voice_endpoint

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Задача для автоматической очистки соединений
async def cleanup_task():
    """Периодическая очистка устаревших WebSocket соединений"""
    while True:
        try:
            await asyncio.sleep(300)  # Каждые 5 минут
            await manager.cleanup_stale_connections()
        except Exception as e:
            logger.error(f"❌ Ошибка в задаче очистки соединений: {e}")

# Создание таблиц при старте
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Инициализация Redis для WebSocket
    await manager.init_redis()
    
    # Запуск задачи очистки соединений
    cleanup_task_handle = asyncio.create_task(cleanup_task())
    logger.info("🧹 Запущена задача автоматической очистки WebSocket соединений")
    
    yield
    
    # Shutdown
    cleanup_task_handle.cancel()
    if manager.redis_client:
        await manager.redis_client.close()
    logger.info("🔴 Приложение остановлено")

# Создание приложения
app = FastAPI(
    title="Miscord API",
    description="Discord-like chat application API",
    version="1.0.0",
    lifespan=lifespan
)

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутеров
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(channels.router, prefix="/api/channels", tags=["channels"])

# WebSocket эндпоинты
@app.websocket("/ws/chat/{channel_id}")
async def websocket_chat_endpoint_route(websocket: WebSocket, channel_id: int, token: str):
    await websocket_chat_endpoint(websocket, channel_id, token)

@app.websocket("/ws/notifications")
async def websocket_notifications_endpoint_route(websocket: WebSocket, token: str):
    await websocket_notifications_endpoint(websocket, token)

@app.websocket("/ws/voice/{channel_id}")
async def websocket_voice_endpoint_route(websocket: WebSocket, channel_id: int, token: str):
    await websocket_voice_endpoint(websocket, channel_id, token)

# API эндпоинты для мониторинга и отладки
@app.get("/api/debug/websocket-stats")
async def get_websocket_stats():
    """Получение статистики WebSocket соединений"""
    return manager.get_connection_stats()

@app.post("/api/debug/cleanup-connections")
async def force_cleanup_connections():
    """Принудительная очистка устаревших соединений"""
    await manager.cleanup_stale_connections()
    return {"message": "Очистка соединений выполнена"}

@app.get("/api/debug/health")
async def debug_health_check():
    """Расширенная проверка здоровья системы"""
    stats = manager.get_connection_stats()
    
    return {
        "status": "healthy",
        "websocket_manager": {
            "total_users": stats['total_users'],
            "total_connections": stats['total_connections'],
            "active_channels": stats['active_channels'],
            "redis_connected": stats['redis_connected']
        },
        "services": {
            "database": "connected",  # TODO: добавить проверку БД
            "redis": "connected" if stats['redis_connected'] else "disconnected"
        }
    }

# Корневой эндпоинт
@app.get("/")
async def root():
    stats = manager.get_connection_stats()
    return {
        "message": "Welcome to Miscord API",
        "version": "1.0.0",
        "websocket_stats": {
            "active_users": stats['total_users'],
            "active_connections": stats['total_connections'],
            "active_channels": stats['active_channels']
        },
        "endpoints": {
            "auth": "/api/auth",
            "channels": "/api/channels",
            "websocket_chat": "/ws/chat/{channel_id}",
            "websocket_voice": "/ws/voice/{channel_id}",
            "websocket_notifications": "/ws/notifications",
            "debug": {
                "websocket_stats": "/api/debug/websocket-stats",
                "cleanup_connections": "/api/debug/cleanup-connections",
                "health": "/api/debug/health"
            }
        }
    }

# Эндпоинт для проверки здоровья
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)