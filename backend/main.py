from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import logging
import re
from sqlalchemy import delete, text

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels, channel_permissions, servers, uploads, reactions, friends, direct_messages, embeds, webhooks, attachment_files, bot_apps, bot_platform
from app.websocket import chat, voice
from app.websocket.connection_manager import manager
from app.websocket.chat import websocket_chat_endpoint, websocket_notifications_endpoint
from app.websocket.voice import websocket_voice_endpoint
from app.websocket.unified import websocket_unified_endpoint
from app.services.user_activity_service import user_activity_service
from app.db.database import AsyncSessionLocal
from app.models import VoiceChannelUser
from app.services.clamav import clamav_health
from app.services.webhook_notifications import dispatcher as webhook_notification_dispatcher
from app.services.pending_upload_cleanup import run_pending_upload_cleanup_loop


_SENSITIVE_QUERY_VALUE = re.compile(
    r"(?i)([?&](?:token|access_token|refresh_token|authorization|api_key)=)[^&\s\"]+"
)
_SENSITIVE_WEBHOOK_PATH = re.compile(r"(/api/webhooks/\d+/)[A-Za-z0-9_-]{43}")


def _redact_sensitive_query_values(value):
    if isinstance(value, str):
        value = _SENSITIVE_QUERY_VALUE.sub(r"\1[REDACTED]", value)
        return _SENSITIVE_WEBHOOK_PATH.sub(r"\1[REDACTED]", value)
    if isinstance(value, tuple):
        return tuple(_redact_sensitive_query_values(item) for item in value)
    if isinstance(value, list):
        return [_redact_sensitive_query_values(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _redact_sensitive_query_values(item)
            for key, item in value.items()
        }
    return value


class SensitiveQueryLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact_sensitive_query_values(record.msg)
        record.args = _redact_sensitive_query_values(record.args)
        return True


def configure_sensitive_log_redaction() -> None:
    for logger_name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(logger_name)
        if not any(isinstance(item, SensitiveQueryLogFilter) for item in logger.filters):
            logger.addFilter(SensitiveQueryLogFilter())
    # Nginx remains the request log source. Uvicorn access records are disabled
    # defensively so secret path parameters can never be emitted by a formatter.
    logging.getLogger("uvicorn.access").disabled = True


configure_sensitive_log_redaction()

# Создание таблиц при старте
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_nonce VARCHAR(36)"))
        await conn.execute(text("ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS client_nonce VARCHAR(36)"))
        await conn.execute(text("ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS command_type INTEGER NOT NULL DEFAULT 1"))
        await conn.execute(text("ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS dm_permission BOOLEAN NOT NULL DEFAULT true"))
        await conn.execute(text("ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS default_member_permissions BIGINT"))
        await conn.execute(text("ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS allowed_user_ids JSON NOT NULL DEFAULT '[]'::json"))
        await conn.execute(text("ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS allowed_role_ids JSON NOT NULL DEFAULT '[]'::json"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_author_client_nonce ON messages(author_id, client_nonce) WHERE client_nonce IS NOT NULL"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_messages_sender_client_nonce ON direct_messages(sender_id, client_nonce) WHERE client_nonce IS NOT NULL"))
        # Execution URLs are intentionally one-time. Existing encrypted copies
        # are irreversibly scrubbed; only high-entropy token hashes remain.
        await conn.execute(text("UPDATE webhooks SET token_ciphertext = '' WHERE token_ciphertext <> ''"))
    # Voice presence is runtime state; it must not survive a backend restart.
    async with AsyncSessionLocal() as db:
        await db.execute(delete(VoiceChannelUser))
        await db.commit()
    
    # Инициализация Redis для WebSocket
    await manager.init_redis()
    
    # Запуск сервиса активности пользователей
    await user_activity_service.start_cleanup_task(AsyncSessionLocal)
    await webhook_notification_dispatcher.start()
    pending_upload_cleanup_task = asyncio.create_task(run_pending_upload_cleanup_loop())
    
    yield
    # Shutdown
    pending_upload_cleanup_task.cancel()
    try:
        await pending_upload_cleanup_task
    except asyncio.CancelledError:
        pass
    await user_activity_service.stop_cleanup_task()
    await webhook_notification_dispatcher.stop()
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
app.include_router(webhooks.router, prefix="/api", tags=["webhooks"])
app.include_router(attachment_files.router, prefix="/api", tags=["attachments"])
app.include_router(bot_apps.router, prefix="/api", tags=["bot-platform"])
app.include_router(bot_platform.router, prefix="/api", tags=["bot-platform"])

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
    scanner = await clamav_health() if settings.WEBHOOK_FILES_ENABLED else None
    return {
        "status": "healthy" if scanner is not False else "degraded",
        "components": {"database": "ok", "redis": "ok" if manager.redis_client else "degraded", "clamav": scanner},
    }

# Подключаем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
