from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels
from app.websocket import chat, voice
from app.websocket.connection_manager import manager

# Создание таблиц при старте
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Инициализация Redis для WebSocket
    await manager.init_redis()
    
    yield
    # Shutdown
    if manager.redis_client:
        await manager.redis_client.close()

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
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутеров
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(channels.router, prefix="/api/channels", tags=["channels"])

# WebSocket эндпоинты
@app.websocket("/ws/chat/{channel_id}")
async def websocket_chat(websocket: WebSocket, channel_id: int, token: str):
    await chat.websocket_chat_endpoint(websocket, channel_id, token)

@app.websocket("/ws/voice/{voice_channel_id}")
async def websocket_voice(websocket: WebSocket, voice_channel_id: int, token: str):
    await voice.websocket_voice_endpoint(websocket, voice_channel_id, token)

# Корневой эндпоинт
@app.get("/")
async def root():
    return {
        "message": "Welcome to Miscord API",
        "version": "1.0.0",
        "endpoints": {
            "auth": "/api/auth",
            "channels": "/api/channels",
            "websocket_chat": "/ws/chat/{channel_id}",
            "websocket_voice": "/ws/voice/{voice_channel_id}"
        }
    }

# Эндпоинт для проверки здоровья
@app.get("/health")
async def health_check():
    return {"status": "healthy"}