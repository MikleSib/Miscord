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
from sqlalchemy import delete, text, update

from app.core.config import settings
from app.db.database import engine
from app.api import auth, channels, channel_categories, channel_permissions, community_forums, community_notifications, community_polls, community_templates, community_threads, message_pins, message_search, servers, uploads, reactions, friends, direct_messages, embeds, webhooks, attachment_files, bot_apps, bot_platform, bot_client, bot_oauth, miscord_api, miscord_gateway, miscord_interactions
from app.core.miscord_errors import MiscordAPIError
from app.services.webhook_rate_limit import Bucket, consume, rate_headers
from app.websocket.connection_manager import manager
from app.websocket.unified import websocket_unified_endpoint
from app.websocket.bot_gateway import websocket_gateway_endpoint
from app.services.user_activity_service import user_activity_service
from app.db.database import AsyncSessionLocal
from app.models import BotSession, User, VoiceChannelUser
from app.services.clamav import clamav_health
from app.services.webhook_notifications import dispatcher as webhook_notification_dispatcher
from app.services.pending_upload_cleanup import run_pending_upload_cleanup_loop
from app.services.outbox_publisher import outbox_publisher
from app.services.notifications import notification_retention
from app.services.community_jobs import community_jobs


_SENSITIVE_QUERY_VALUE = re.compile(
    r"(?i)([?&](?:token|access_token|refresh_token|authorization|api_key)=)[^&\s\"]+"
)
_SENSITIVE_WEBHOOK_PATH = re.compile(r"(/api/v1/webhooks/\d+/)[A-Za-z0-9_-]{43}")


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
    # Alembic owns schema changes. Runtime startup intentionally performs no DDL.
    # Voice presence is runtime state; it must not survive a backend restart.
    async with AsyncSessionLocal() as db:
        await db.execute(delete(VoiceChannelUser))
        # Gateway and voice presence are runtime state. A process crash cannot
        # be allowed to leave bots or persisted sessions looking connected.
        await db.execute(update(User).where(User.is_bot == True).values(is_online=False))
        await db.execute(update(BotSession).values(is_active=False))
        await db.commit()

    # Инициализация Redis для WebSocket
    await manager.init_redis()

    # Запуск сервиса активности пользователей
    await user_activity_service.start_cleanup_task(AsyncSessionLocal)
    await webhook_notification_dispatcher.start()
    await outbox_publisher.start()
    await notification_retention.start()
    await community_jobs.start()
    pending_upload_cleanup_task = asyncio.create_task(run_pending_upload_cleanup_loop())

    yield
    # Shutdown
    pending_upload_cleanup_task.cancel()
    try:
        await pending_upload_cleanup_task
    except asyncio.CancelledError:
        pass
    await user_activity_service.stop_cleanup_task()
    await outbox_publisher.stop()
    await notification_retention.stop()
    await community_jobs.stop()
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

    if request.url.path.startswith("/api/v1/"):
        errors = {}
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", ()) if part != "body") or "_errors"
            errors[location] = {"_errors": [{"code": item.get("type", "BASE_TYPE_INVALID"), "message": item.get("msg", "Invalid value")}]}
        return JSONResponse(
            status_code=400,
            content={"message": "Invalid Form Body", "code": 50035, "errors": errors},
        )
    if request.url.path.startswith("/api/v1/oauth2/"):
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

    if request.url.path.startswith("/api/v1/oauth2/") and isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)


@app.middleware("http")
async def miscord_api_rate_limit_middleware(request: Request, call_next):
    is_miscord_api = request.url.path.startswith("/api/v1/")
    is_oauth_api = request.url.path.startswith("/api/v1/oauth2/")
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
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(channels.router, prefix="/api/v1/channels", tags=["channels"])
app.include_router(community_threads.router, prefix="/api/v1/channels", tags=["threads"])
app.include_router(community_forums.router, prefix="/api/v1/channels", tags=["forums"])
app.include_router(community_polls.router, prefix="/api/v1", tags=["polls"])
app.include_router(community_notifications.router, prefix="/api/v1", tags=["notifications"])
app.include_router(community_templates.router, prefix="/api/v1", tags=["server-templates"])
app.include_router(channel_permissions.router, prefix="/api/v1/channels", tags=["channel-permissions"])
app.include_router(message_pins.router, prefix="/api/v1/channels", tags=["message-pins"])
app.include_router(message_search.router, prefix="/api/v1/channels", tags=["message-search"])
app.include_router(channel_categories.router, prefix="/api/v1/channels", tags=["channel-categories"])
app.include_router(servers.router, prefix="/api/v1/servers", tags=["server-management"])
app.include_router(uploads.router, prefix="/api/v1", tags=["uploads"])
app.include_router(reactions.router, prefix="/api/v1", tags=["reactions"])
app.include_router(friends.router, prefix="/api/v1/friends", tags=["friends"])
app.include_router(direct_messages.router, prefix="/api/v1/dms", tags=["dms"])
app.include_router(embeds.router, prefix="/api/v1", tags=["embeds"])
app.include_router(webhooks.router, prefix="/api/v1", tags=["webhooks"])
app.include_router(attachment_files.router, prefix="/api/v1", tags=["attachments"])
app.include_router(bot_apps.router, prefix="/api/v1", tags=["bot-platform"])
app.include_router(bot_platform.router, prefix="/api/v1", tags=["bot-platform"])
app.include_router(bot_client.router, prefix="/api/v1", tags=["bot-client"])
app.include_router(bot_oauth.router, prefix="/api/v1/oauth2", tags=["oauth2"])
app.include_router(miscord_gateway.router, prefix="/api/v1", tags=["miscord-gateway-v1"])
app.include_router(miscord_api.router, prefix="/api/v1", tags=["miscord-api-v1"])
app.include_router(miscord_interactions.router, prefix="/api/v1", tags=["miscord-interactions-v1"])

# WebSocket эндпоинты

# НОВЫЙ УНИФИЦИРОВАННЫЙ ENDPOINT (рекомендуется использовать)
@app.websocket("/ws/unified")
async def websocket_unified_endpoint_route(websocket: WebSocket, token: str):
    """Единый унифицированный WebSocket endpoint для всех типов соединений"""
    await websocket_unified_endpoint(websocket, token)

@app.websocket("/gateway")
async def websocket_gateway_endpoint_route(websocket: WebSocket):
    await websocket_gateway_endpoint(websocket)

# Корневой эндпоинт
@app.get("/")
async def root():
    return {
        "message": "Welcome to Miscord API",
        "version": "1.0.0",
        "endpoints": {
            "auth": "/api/v1/auth",
            "channels": "/api/v1/channels",
            "websocket_unified": "/ws/unified",
            "gateway": "/api/v1/gateway",
            "voice_gateway": "/ws/voice-gateway?v=1",
        }
    }


@app.get("/api/v1/health", include_in_schema=False)
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
