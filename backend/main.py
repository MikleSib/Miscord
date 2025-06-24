from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels, uploads, reactions
from app.websocket import chat, voice
from app.websocket.connection_manager import manager
from app.websocket.chat import websocket_chat_endpoint, websocket_notifications_endpoint
from app.websocket.voice import websocket_voice_endpoint
from app.websocket.main_websocket import websocket_main_endpoint
from app.websocket.enhanced_voice import websocket_voice_endpoint as enhanced_voice_endpoint
from app.websocket.enhanced_connection_manager import enhanced_manager
from app.websocket.enhanced_voice import enhanced_voice_manager
from app.services.user_activity_service import user_activity_service
from app.db.database import AsyncSessionLocal

# Создание таблиц при старте
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Инициализация Redis для WebSocket
    await manager.init_redis()
    
    # Запуск сервиса активности пользователей
    await user_activity_service.start_cleanup_task(AsyncSessionLocal)
    
    yield
    # Shutdown
    await user_activity_service.stop_cleanup_task()
    if manager.redis_client:
        await manager.redis_client.close()
    
    # Shutdown enhanced managers
    await enhanced_manager.shutdown()
    await enhanced_voice_manager.shutdown()

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
app.include_router(uploads.router, prefix="/api", tags=["uploads"])
app.include_router(reactions.router, prefix="/api", tags=["reactions"])

# 🚀 Enhanced WebSocket эндпоинты (Enterprise-level)
@app.websocket("/ws/main")
async def websocket_main_endpoint_route(websocket: WebSocket, token: str):
    """
    🎯 Основной WebSocket для чата и уведомлений
    Поддерживает 1000+ пользователей с батчингом и оптимизациями
    """
    await websocket_main_endpoint(websocket, token)

@app.websocket("/ws/voice/{voice_channel_id}")
async def websocket_enhanced_voice_endpoint_route(websocket: WebSocket, voice_channel_id: int, token: str):
    """
    🎙️ Enhanced голосовой WebSocket с WebRTC оптимизациями
    Низкая латентность, адаптивное качество, поддержка 1000+ пользователей
    """
    await enhanced_voice_endpoint(websocket, voice_channel_id, token)

# 📞 Legacy WebSocket эндпоинты (для обратной совместимости)
@app.websocket("/ws/legacy/chat/{text_channel_id}")
async def websocket_chat_endpoint_route(websocket: WebSocket, text_channel_id: int, token: str):
    await websocket_chat_endpoint(websocket, text_channel_id, token)

@app.websocket("/ws/legacy/notifications")
async def websocket_notifications_endpoint_route(websocket: WebSocket, token: str):
    await websocket_notifications_endpoint(websocket, token)

@app.websocket("/ws/legacy/voice/{channel_id}")
async def websocket_voice_endpoint_route(websocket: WebSocket, channel_id: int, token: str):
    await websocket_voice_endpoint(websocket, channel_id, token)

# Корневой эндпоинт
@app.get("/")
async def root():
    return {
        "message": "Welcome to Miscord API - Enhanced Edition",
        "version": "2.0.0",
        "description": "Enterprise-level chat application optimized for 1000+ users",
        "features": [
            "🚀 High-performance WebSocket with batching",
            "🎙️ Enhanced voice communication with WebRTC",
            "📊 Real-time performance monitoring", 
            "🔄 Automatic reconnection and failover",
            "⚡ Circuit breaker pattern for reliability",
            "📦 Message queuing for offline support"
        ],
        "endpoints": {
            "auth": "/api/auth",
            "channels": "/api/channels",
            "uploads": "/api/uploads",
            "reactions": "/api/reactions",
            "enhanced_main_websocket": "/ws/main?token={token}",
            "enhanced_voice_websocket": "/ws/voice/{voice_channel_id}?token={token}",
            "legacy_chat_websocket": "/ws/legacy/chat/{text_channel_id}?token={token}",
            "legacy_voice_websocket": "/ws/legacy/voice/{channel_id}?token={token}",
            "legacy_notifications_websocket": "/ws/legacy/notifications?token={token}"
        },
        "performance": {
            "max_concurrent_connections": 1000,
            "message_batching": "50ms intervals",
            "heartbeat_interval": "15s",
            "auto_reconnection": "exponential backoff",
            "circuit_breaker": "10 failures/60s window"
        }
    }

# Эндпоинт для проверки здоровья
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# 📊 Эндпоинт для метрик производительности
@app.get("/metrics")
async def get_performance_metrics():
    """
    📈 Получение метрик производительности WebSocket соединений
    """
    main_metrics = enhanced_manager.get_metrics()
    voice_metrics = enhanced_voice_manager.get_metrics()
    
    return {
        "timestamp": asyncio.get_event_loop().time(),
        "main_websocket": {
            "total_connections": main_metrics.total_connections,
            "active_channels": main_metrics.active_channels,
            "messages_sent": main_metrics.messages_sent,
            "messages_received": main_metrics.messages_received,
            "bytes_sent": main_metrics.bytes_sent,
            "bytes_received": main_metrics.bytes_received,
            "average_latency": main_metrics.avg_latency,
            "peak_connections": main_metrics.peak_connections,
            "connection_errors": main_metrics.connection_errors,
            "last_updated": main_metrics.last_updated
        },
        "voice_websocket": voice_metrics,
        "system": {
            "version": "2.0.0",
            "uptime": asyncio.get_event_loop().time()
        }
    }

# Подключаем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)