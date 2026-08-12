from fastapi import APIRouter

from app.core.config import settings


router = APIRouter()


def capabilities_payload() -> dict:
    """Public product switches used to keep clients aligned with the server."""
    return {
        "version": 1,
        "threads": settings.THREADS_ENABLED,
        "forums": settings.FORUMS_ENABLED,
        "polls": settings.POLLS_ENABLED,
        "inbox": settings.INBOX_ENABLED,
        "server_templates": settings.SERVER_TEMPLATES_ENABLED,
        "server_imports": settings.SERVER_IMPORTS_ENABLED,
        "webhooks": settings.WEBHOOKS_ENABLED,
        "webhook_files": settings.WEBHOOK_FILES_ENABLED,
        "bot_platform": settings.BOT_PLATFORM_ENABLED,
        "email_verification": settings.EMAIL_VERIFICATION_ENABLED,
        "voice": True,
        "screen_share": True,
    }


@router.get("/capabilities")
async def get_capabilities() -> dict:
    return capabilities_payload()
