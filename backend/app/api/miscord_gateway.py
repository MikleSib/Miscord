from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.miscord_api import get_miscord_bot
from app.schemas.bot_protocol import (
    BotProtocolError,
    GATEWAY_DEFAULT_ENCODING,
    validate_gateway_query,
)
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.bot_security import BotPrincipal


router = APIRouter()


def _gateway_payload(request: Request, version: int, encoding: str) -> dict[str, str | int]:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.client.host
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",", 1)[0].strip()
    scheme = "wss" if proto == "https" else "ws"
    return {
        "url": f"{scheme}://{host}/gateway?v=1&encoding=json",
        "v": version,
        "encoding": encoding,
    }


@router.get("/gateway")
async def get_gateway(
    request: Request,
    v: int | None = None,
    encoding: str = GATEWAY_DEFAULT_ENCODING,
    compress: str | None = None,
):
    try:
        version, resolved_encoding = validate_gateway_query(v, encoding, compress)
    except BotProtocolError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc
    return _gateway_payload(request, version, resolved_encoding)


@router.get("/gateway/bot")
async def get_gateway_bot(request: Request, principal: BotPrincipal = Depends(get_miscord_bot)):
    payload = _gateway_payload(request, 1, GATEWAY_DEFAULT_ENCODING)
    payload.update({
        "shards": 1,
        "session_start_limit": {
            "total": 1000,
            "remaining": await bot_event_dispatcher.identify_remaining(principal.application.id),
            "reset_after": 60_000,
            "max_concurrency": 1,
        },
    })
    return payload
