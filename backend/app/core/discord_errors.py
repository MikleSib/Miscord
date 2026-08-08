from __future__ import annotations

from typing import Any


class DiscordAPIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: int,
        message: str,
        *,
        errors: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.errors = errors
        self.headers = headers or {}

    def payload(self) -> dict[str, Any]:
        output: dict[str, Any] = {"message": self.message, "code": self.code}
        if self.errors:
            output["errors"] = self.errors
        return output


def invalid_form(field: str, message: str) -> DiscordAPIError:
    return DiscordAPIError(
        400,
        50035,
        "Invalid Form Body",
        errors={field: {"_errors": [{"code": "BASE_TYPE_BAD_LENGTH", "message": message}]}},
    )


UNKNOWN_CHANNEL = lambda: DiscordAPIError(404, 10003, "Unknown Channel")
UNKNOWN_GUILD = lambda: DiscordAPIError(404, 10004, "Unknown Guild")
UNKNOWN_MESSAGE = lambda: DiscordAPIError(404, 10008, "Unknown Message")
UNKNOWN_INTERACTION = lambda: DiscordAPIError(404, 10062, "Unknown Interaction")
UNKNOWN_COMMAND = lambda: DiscordAPIError(404, 10063, "Unknown application command")
MISSING_ACCESS = lambda: DiscordAPIError(403, 50001, "Missing Access")
MISSING_PERMISSIONS = lambda: DiscordAPIError(403, 50013, "Missing Permissions")
ALREADY_ACKNOWLEDGED = lambda: DiscordAPIError(400, 40060, "Interaction has already been acknowledged.")
