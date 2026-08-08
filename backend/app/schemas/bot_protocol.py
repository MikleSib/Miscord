from __future__ import annotations

from enum import IntEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class GatewayOpCode(IntEnum):
    DISPATCH = 0
    HEARTBEAT = 1
    IDENTIFY = 2
    RESUME = 6
    RECONNECT = 7
    INVALID_SESSION = 9
    HELLO = 10
    HEARTBEAT_ACK = 11


GATEWAY_API_VERSION = 10
GATEWAY_DEFAULT_ENCODING = "json"


class BotProtocolError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after

    def as_detail(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.retry_after is not None:
            payload["retry_after"] = self.retry_after
        return payload


def validate_gateway_query(
    version: int | None,
    encoding: str | None,
    compress: str | None = None,
) -> tuple[int, str]:
    resolved_version = GATEWAY_API_VERSION if version is None else int(version)
    if resolved_version != GATEWAY_API_VERSION:
        raise BotProtocolError(
            "invalid_gateway_version",
            f"Only gateway version {GATEWAY_API_VERSION} is supported",
        )

    resolved_encoding = (encoding or GATEWAY_DEFAULT_ENCODING).strip().lower()
    if not resolved_encoding:
        resolved_encoding = GATEWAY_DEFAULT_ENCODING
    if resolved_encoding != GATEWAY_DEFAULT_ENCODING:
        raise BotProtocolError(
            "invalid_gateway_encoding",
            "Only json encoding is supported",
        )

    if compress is not None and compress.strip().lower() not in {"", GATEWAY_DEFAULT_ENCODING}:
        # Compression is not enabled in this implementation.
        raise BotProtocolError(
            "invalid_gateway_compress",
            "Gateway compression is not supported",
            status_code=400,
        )

    return resolved_version, resolved_encoding


class BotGatewayHelloPayload(BaseModel):
    v: Literal[GATEWAY_API_VERSION] = GATEWAY_API_VERSION
    heartbeat_interval: int = Field(gt=0)
    trace: list[str] = Field(default_factory=list, alias="_trace", validation_alias="_trace")

    model_config = ConfigDict(populate_by_name=True)


class BotGatewayHello(BaseModel):
    op: Literal[GatewayOpCode.HELLO.value] = GatewayOpCode.HELLO.value
    d: BotGatewayHelloPayload


class BotGatewayIdentifyData(BaseModel):
    token: str
    intents: int = Field(ge=0)
    compress: bool | None = None
    properties: dict[str, Any] | None = None
    shard: list[int] | None = None


class BotGatewayIdentify(BaseModel):
    op: Literal[GatewayOpCode.IDENTIFY.value] = GatewayOpCode.IDENTIFY.value
    d: BotGatewayIdentifyData


class BotGatewayResumeData(BaseModel):
    token: str
    session_id: str
    seq: int = Field(ge=0)


class BotGatewayResume(BaseModel):
    op: Literal[GatewayOpCode.RESUME.value] = GatewayOpCode.RESUME.value
    d: BotGatewayResumeData


class BotGatewayHeartbeat(BaseModel):
    op: Literal[GatewayOpCode.HEARTBEAT.value] = GatewayOpCode.HEARTBEAT.value
    d: int | None = None


class BotGatewayInvalidSession(BaseModel):
    op: Literal[GatewayOpCode.INVALID_SESSION.value] = GatewayOpCode.INVALID_SESSION.value
    d: dict[str, Any]


class BotGatewayReadyData(BaseModel):
    v: Literal[GATEWAY_API_VERSION] = GATEWAY_API_VERSION
    session_id: str
    resume_gateway_url: str = "/gateway"


class BotGatewayReady(BaseModel):
    op: Literal[GatewayOpCode.DISPATCH.value] = GatewayOpCode.DISPATCH.value
    t: Literal["READY"]
    s: int | None = None
    d: BotGatewayReadyData


class BotGatewayResumed(BaseModel):
    op: Literal[GatewayOpCode.DISPATCH.value] = GatewayOpCode.DISPATCH.value
    t: Literal["RESUMED"]
    s: int | None = None
    d: dict[str, Any] = Field(default_factory=dict)
