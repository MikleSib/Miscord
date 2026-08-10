"""Bounded facade for the bot_platform API."""

from fastapi import APIRouter

from . import bot_platform_installs
from . import bot_platform_commands
from . import bot_platform_interactions
from .bot_platform_shared import *  # noqa: F401,F403
from .bot_platform_installs import *  # noqa: F401,F403
from .bot_platform_commands import *  # noqa: F401,F403
from .bot_platform_interactions import *  # noqa: F401,F403

router = APIRouter()
router.include_router(bot_platform_installs.router)
router.include_router(bot_platform_commands.router)
router.include_router(bot_platform_interactions.router)
