from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
from sqlalchemy import delete

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels, channel_permissions, servers, uploads, reactions, friends, direct_messages, embeds
from app.websocket import chat, voice
from app.websocket.connection_manager import manager
from app.websocket.chat import websocket_chat_endpoint, websocket_notifications_endpoint
from app.websocket.voice import websocket_voice_endpoint
from app.websocket.unified import websocket_unified_endpoint
from app.services.user_activity_service import user_activity_service
from app.db.database import AsyncSessionLocal
from app.models import VoiceChannelUser

# Создание таблиц при старте
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Voice presence is runtime state; it must not survive a backend restart.
    async with AsyncSessionLocal() as db:
        await db.execute(delete(VoiceChannelUser))
        await db.commit()
    
    # Инициализация Redis для WebSocket
    await manager.init_redis()
    
    # Запуск сервиса активности пользователей
    await user_activity_service.start_cleanup_task(AsyncSessionLocal)
    
    yield
    # Shutdown
    await user_activity_service.stop_cleanup_task()
    if manager.redis_client:
        await manager.redis_client.close()

# Создание приложения
_is_prod = (settings.ENVIRONMENT or "").lower() in {"production", "prod"}
app = FastAPI(
    title="Miscord API",
    description="Discord-like chat application API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
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
app.include_router(channel_permissions.router, prefix="/api/channels", tags=["channel-permissions"])
app.include_router(servers.router, prefix="/api/servers", tags=["server-management"])
app.include_router(uploads.router, prefix="/api", tags=["uploads"])
app.include_router(reactions.router, prefix="/api", tags=["reactions"])
app.include_router(friends.router, prefix="/api/friends", tags=["friends"])
app.include_router(direct_messages.router, prefix="/api/dms", tags=["dms"])
app.include_router(embeds.router, prefix="/api", tags=["embeds"])

# WebSocket эндпоинты

# НОВЫЙ УНИФИЦИРОВАННЫЙ ENDPOINT (рекомендуется использовать)
@app.websocket("/ws/unified")
async def websocket_unified_endpoint_route(websocket: WebSocket, token: str):
    """Единый унифицированный WebSocket endpoint для всех типов соединений"""
    await websocket_unified_endpoint(websocket, token)

# СТАРЫЕ ENDPOINTS (сохранены для обратной совместимости)
@app.websocket("/ws/chat/{text_channel_id}")
async def websocket_chat_endpoint_route(websocket: WebSocket, text_channel_id: int, token: str):
    await websocket_chat_endpoint(websocket, text_channel_id, token)

@app.websocket("/ws/notifications")
async def websocket_notifications_endpoint_route(websocket: WebSocket, token: str):
    await websocket_notifications_endpoint(websocket, token)

@app.websocket("/ws/voice/{channel_id}")
async def websocket_voice_endpoint_route(websocket: WebSocket, channel_id: int, token: str):
    await websocket_voice_endpoint(websocket, channel_id, token)

# Корневой эндпоинт
@app.get("/")
async def root():
    return {
        "message": "Welcome to Miscord API",
        "version": "1.0.0",
        "endpoints": {
            "auth": "/api/auth",
            "channels": "/api/channels",
            "websocket_unified": "/ws/unified (RECOMMENDED)",
            "websocket_chat": "/ws/chat/{text_channel_id} (deprecated)",
            "websocket_voice": "/ws/voice/{channel_id} (deprecated)",
            "websocket_notifications": "/ws/notifications (deprecated)"
        }
    }

# Эндпоинт для проверки здоровья
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Подключаем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
