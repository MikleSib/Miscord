from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import logging
import re
import hashlib
import time
from sqlalchemy import delete, text

from app.core.config import settings
from app.db.database import engine, Base
from app.api import auth, channels, channel_permissions, servers, uploads, reactions, friends, direct_messages, embeds, webhooks, attachment_files, bot_apps, bot_platform, bot_client, bot_oauth, miscord_api, miscord_interactions
from app.core.miscord_errors import MiscordAPIError
from app.services.webhook_rate_limit import Bucket, consume, rate_headers
from app.websocket import chat, voice
from app.websocket.connection_manager import manager
from app.websocket.chat import websocket_chat_endpoint, websocket_notifications_endpoint
from app.websocket.voice import websocket_voice_endpoint
from app.websocket.unified import websocket_unified_endpoint
from app.websocket.bot_gateway import websocket_gateway_endpoint
from app.websocket.bot_voice_gateway import websocket_bot_voice_gateway_endpoint
from app.services.user_activity_service import user_activity_service
from app.db.database import AsyncSessionLocal
from app.models import VoiceChannelUser
from app.services.clamav import clamav_health
from app.services.webhook_notifications import dispatcher as webhook_notification_dispatcher
from app.services.pending_upload_cleanup import run_pending_upload_cleanup_loop
from app.schemas.bot_protocol import (
    BotProtocolError,
    GATEWAY_DEFAULT_ENCODING,
    validate_gateway_query,
)


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
    description="Miscord chat and bot platform API",
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


@app.exception_handler(RequestValidationError)
async def protocol_validation_error_handler(request: Request, exc: RequestValidationError):
    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse

    if request.url.path.startswith("/api/v10/"):
        errors = {}
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", ()) if part != "body") or "_errors"
            errors[location] = {"_errors": [{"code": item.get("type", "BASE_TYPE_INVALID"), "message": item.get("msg", "Invalid value")}]}
        return JSONResponse(
            status_code=400,
            content={"message": "Invalid Form Body", "code": 50035, "errors": errors},
        )
    if request.url.path.startswith("/api/oauth2/"):
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_request", "error_description": "The request body is invalid"},
        )
    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": exc.errors()}))


@app.exception_handler(MiscordAPIError)
async def miscord_api_error_handler(_request: Request, exc: MiscordAPIError):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=exc.status_code,
        content=exc.payload(),
        headers=exc.headers,
    )


@app.exception_handler(StarletteHTTPException)
async def oauth_http_error_handler(request: Request, exc: StarletteHTTPException):
    from fastapi.responses import JSONResponse

    if request.url.path.startswith("/api/oauth2/") and isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)


@app.middleware("http")
async def miscord_api_rate_limit_middleware(request: Request, call_next):
    is_miscord_api = request.url.path.startswith("/api/v10/")
    is_oauth_api = request.url.path.startswith("/api/oauth2/")
    if not is_miscord_api and not is_oauth_api:
        return await call_next(request)

    authorization = request.headers.get("authorization", "")
    if authorization:
        identity = hashlib.sha256(authorization.encode("utf-8")).hexdigest()[:24]
    else:
        forwarded = request.headers.get("x-forwarded-for", "")
        identity = (forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else "unknown"))
    route = re.sub(r"(?<=/)\d{1,20}(?=/|$)", ":id", request.url.path)
    route = re.sub(r"(/webhooks/:id/)[^/]+", r"\1:token", route)
    bucket_id = hashlib.sha256(f"{request.method}:{route}".encode("utf-8")).hexdigest()[:16]
    namespace = "miscord" if is_miscord_api else "oauth"
    route_limit = 10 if is_miscord_api else 5
    global_limit = 50 if is_miscord_api else 20
    result = await consume([
        Bucket(key=f"{namespace}:route:{identity}:{bucket_id}", limit=route_limit, window_seconds=1, scope="shared"),
        Bucket(key=f"{namespace}:global:{identity}", limit=global_limit, window_seconds=1, scope="global"),
    ])
    headers = rate_headers(result)
    headers["X-RateLimit-Bucket"] = bucket_id
    headers["X-RateLimit-Reset"] = f"{time.time() + result.retry_after:.3f}"
    if not result.allowed:
        from fastapi.responses import JSONResponse

        headers["Retry-After"] = f"{result.retry_after:.3f}"
        return JSONResponse(
            status_code=429,
            content={"message": "You are being rate limited.", "retry_after": result.retry_after, "global": result.scope == "global"},
            headers=headers,
        )
    response = await call_next(request)
    for name, value in headers.items():
        response.headers[name] = value
    return response

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
app.include_router(bot_client.router, prefix="/api", tags=["bot-client"])
app.include_router(bot_oauth.router, prefix="/api/oauth2", tags=["oauth2"])
app.include_router(miscord_api.router, prefix="/api/v10", tags=["miscord-api-v10"])
app.include_router(miscord_interactions.router, prefix="/api/v10", tags=["miscord-interactions-v10"])

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

@app.websocket("/gateway")
async def websocket_gateway_endpoint_route(websocket: WebSocket):
    await websocket_gateway_endpoint(websocket)

@app.websocket("/ws/voice-gateway")
async def websocket_bot_voice_gateway_endpoint_route(websocket: WebSocket):
    await websocket_bot_voice_gateway_endpoint(websocket)

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
            "websocket_notifications": "/ws/notifications (deprecated)",
            "gateway": "/api/gateway",
            "voice_gateway": "/ws/voice-gateway?v=8",
        }
    }


@app.get("/api/gateway")
async def get_gateway_info(
    request: Request,
    v: int | None = None,
    encoding: str = GATEWAY_DEFAULT_ENCODING,
    compress: str | None = None,
):
    try:
        resolved_version, resolved_encoding = validate_gateway_query(v, encoding, compress)
    except Exception as exc:
        if isinstance(exc, BotProtocolError):
            raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc
        raise

    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.client.host
    forwarded_proto = request.headers.get("x-forwarded-proto")
    request_scheme = forwarded_proto.split(",", 1)[0].strip().lower() if forwarded_proto else request.url.scheme
    if request_scheme == "https":
        ws_scheme = "wss"
    elif request_scheme == "http":
        ws_scheme = "ws"
    else:
        ws_scheme = "ws"
    return {
        "url": f"{ws_scheme}://{host}/gateway",
        "v": resolved_version,
        "encoding": resolved_encoding,
        "shards": 1,
        "session_start_limit": {
            "total": 1000,
            "remaining": 1000,
            "reset_after": 0,
            "max_concurrency": 1,
        },
    }

@app.get("/api/health", include_in_schema=False)
@app.get("/health")
async def health_check():
    from fastapi.responses import JSONResponse

    database = "ok"
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        database = "unavailable"

    redis_status = "degraded"
    if manager.redis_client:
        try:
            await manager.redis_client.ping()
            redis_status = "ok"
        except Exception:
            redis_status = "unavailable"

    try:
        scanner_result = await clamav_health() if settings.WEBHOOK_FILES_ENABLED else None
    except Exception:
        scanner_result = False
    scanner = "disabled" if scanner_result is None else ("ok" if scanner_result else "unavailable")

    components = {"database": database, "redis": redis_status, "clamav": scanner}
    if database != "ok":
        return JSONResponse(status_code=503, content={"status": "unhealthy", "components": components})
    return {
        "status": "healthy" if redis_status == "ok" and scanner in {"ok", "disabled"} else "degraded",
        "components": components,
    }

# Подключаем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
