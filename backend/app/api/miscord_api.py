"""Bounded facade for the miscord_api API."""

from fastapi import APIRouter

from . import miscord_api_identity
from . import miscord_api_webhooks
from . import miscord_api_guilds
from . import miscord_api_messages
from . import miscord_api_commands
from .miscord_api_shared import *  # noqa: F401,F403
from .miscord_api_identity import *  # noqa: F401,F403
from .miscord_api_webhooks import *  # noqa: F401,F403
from .miscord_api_guilds import *  # noqa: F401,F403
from .miscord_api_messages import *  # noqa: F401,F403
from .miscord_api_commands import *  # noqa: F401,F403

router = APIRouter()
router.include_router(miscord_api_identity.router)
router.include_router(miscord_api_webhooks.router)
router.include_router(miscord_api_guilds.router)
router.include_router(miscord_api_messages.router)
router.include_router(miscord_api_commands.router)
