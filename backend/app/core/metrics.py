"""Low-cardinality Prometheus metrics for the Miscord backend."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from prometheus_client import Counter, Gauge, Histogram
from sqlalchemy import func, select


HTTP_REQUESTS = Counter(
    "miscord_http_requests_total",
    "HTTP requests handled by the backend.",
    ("method", "route", "status"),
)
HTTP_DURATION = Histogram(
    "miscord_http_request_duration_seconds",
    "HTTP request duration.",
    ("method", "route"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
WEBSOCKET_ACTIVE = Gauge(
    "miscord_websocket_connections_active",
    "WebSocket connections active in this backend process.",
)
WEBSOCKET_CONNECTIONS = Counter(
    "miscord_websocket_connections_total",
    "WebSocket connections accepted by this backend process.",
)
WEBSOCKET_DISCONNECTS = Counter(
    "miscord_websocket_disconnects_total",
    "WebSocket connections removed by this backend process.",
)
WEBSOCKET_RECONNECTS = Counter(
    "miscord_websocket_reconnects_total",
    "Connections made shortly after the same user disconnected.",
)
VOICE_JOINS = Counter(
    "miscord_voice_joins_total",
    "Voice join attempts.",
    ("status",),
)
VOICE_JOIN_DURATION = Histogram(
    "miscord_voice_join_duration_seconds",
    "Time from voice join request to response.",
    ("status",),
    buckets=(0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
OUTBOX_PENDING = Gauge(
    "miscord_outbox_pending_events",
    "Unpublished outbox events.",
)
OUTBOX_OLDEST_AGE = Gauge(
    "miscord_outbox_oldest_event_age_seconds",
    "Age of the oldest unpublished outbox event.",
)
OUTBOX_DELIVERIES = Counter(
    "miscord_outbox_deliveries_total",
    "Outbox delivery results.",
    ("status", "topic"),
)
DELIVERY_RESULTS = Counter(
    "miscord_external_delivery_total",
    "Webhook and interaction delivery results.",
    ("kind", "status"),
)
BACKGROUND_JOBS = Counter(
    "miscord_background_jobs_total",
    "Background job run results.",
    ("job", "status"),
)
BACKGROUND_JOB_DURATION = Histogram(
    "miscord_background_job_duration_seconds",
    "Background job run duration.",
    ("job",),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60),
)
NOTIFICATION_QUEUE = Gauge(
    "miscord_notification_queue_size",
    "Webhook notification jobs waiting in this backend process.",
)
REDIS_AVAILABLE = Gauge(
    "miscord_redis_available",
    "Whether the backend Redis connection responds to ping.",
)
DATABASE_POOL = Gauge(
    "miscord_database_pool_connections",
    "SQLAlchemy database pool state.",
    ("state",),
)
METRIC_REFRESH_FAILURES = Counter(
    "miscord_metric_refresh_failures_total",
    "Failures while refreshing scrape-time gauges.",
    ("component",),
)

_NUMERIC_SEGMENT = re.compile(r"(?<=/)\d{1,20}(?=/|$)")
_WEBHOOK_TOKEN = re.compile(r"(/webhooks/:id/)[^/]+")


def route_label(request) -> str:
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    if template:
        return str(template)
    value = _NUMERIC_SEGMENT.sub(":id", request.url.path)
    return _WEBHOOK_TOKEN.sub(r"\1:token", value)


def record_http(method: str, route: str, status: int, duration: float) -> None:
    HTTP_REQUESTS.labels(method=method, route=route, status=str(status)).inc()
    HTTP_DURATION.labels(method=method, route=route).observe(duration)


def record_websocket_connected(*, active: int, reconnect: bool) -> None:
    WEBSOCKET_CONNECTIONS.inc()
    if reconnect:
        WEBSOCKET_RECONNECTS.inc()
    WEBSOCKET_ACTIVE.set(active)


def record_websocket_disconnected(*, active: int) -> None:
    WEBSOCKET_DISCONNECTS.inc()
    WEBSOCKET_ACTIVE.set(active)


def record_voice_join(status: str, duration: float) -> None:
    VOICE_JOINS.labels(status=status).inc()
    VOICE_JOIN_DURATION.labels(status=status).observe(duration)


def record_delivery(kind: str, status: str) -> None:
    DELIVERY_RESULTS.labels(kind=kind, status=status).inc()


def record_background_job(job: str, status: str, duration: float) -> None:
    BACKGROUND_JOBS.labels(job=job, status=status).inc()
    BACKGROUND_JOB_DURATION.labels(job=job).observe(duration)


async def refresh_runtime_gauges() -> None:
    """Refresh state that is inexpensive and useful at scrape time."""
    from app.db.database import AsyncSessionLocal, engine
    from app.models import OutboxEvent
    from app.services.webhook_notifications import dispatcher
    from app.websocket.connection_manager import manager

    NOTIFICATION_QUEUE.set(dispatcher.queue.qsize())

    pool = engine.sync_engine.pool
    for state, reader in (
        ("size", pool.size),
        ("checked_out", pool.checkedout),
        ("overflow", pool.overflow),
    ):
        try:
            DATABASE_POOL.labels(state=state).set(reader())
        except Exception:
            METRIC_REFRESH_FAILURES.labels(component="database_pool").inc()

    try:
        async with AsyncSessionLocal() as db:
            pending, oldest = (
                await db.execute(
                    select(func.count(OutboxEvent.id), func.min(OutboxEvent.created_at)).where(
                        OutboxEvent.published_at.is_(None)
                    )
                )
            ).one()
        OUTBOX_PENDING.set(int(pending or 0))
        if oldest is None:
            OUTBOX_OLDEST_AGE.set(0)
        else:
            if oldest.tzinfo is None:
                oldest = oldest.replace(tzinfo=timezone.utc)
            OUTBOX_OLDEST_AGE.set(max(0, (datetime.now(timezone.utc) - oldest).total_seconds()))
    except Exception:
        METRIC_REFRESH_FAILURES.labels(component="outbox").inc()

    try:
        if manager.redis_client:
            await manager.redis_client.ping()
            REDIS_AVAILABLE.set(1)
        else:
            REDIS_AVAILABLE.set(0)
    except Exception:
        REDIS_AVAILABLE.set(0)
        METRIC_REFRESH_FAILURES.labels(component="redis").inc()
