"""Bounded facade for the bot_client API."""

from fastapi import APIRouter

from . import bot_client_commands
from . import bot_client_interactions
from .bot_client_shared import *  # noqa: F401,F403
from .bot_client_commands import *  # noqa: F401,F403
from .bot_client_interactions import *  # noqa: F401,F403

router = APIRouter()
router.include_router(bot_client_commands.router)
router.include_router(bot_client_interactions.router)
