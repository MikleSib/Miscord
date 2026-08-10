"""Bounded facade for the channels API."""

from fastapi import APIRouter

from . import channels_servers
from . import channels_children
from . import channels_messages
from . import channels_voice_moderation
from .channels_shared import *  # noqa: F401,F403
from .channels_servers import *  # noqa: F401,F403
from .channels_children import *  # noqa: F401,F403
from .channels_messages import *  # noqa: F401,F403

router = APIRouter()
router.include_router(channels_servers.router)
router.include_router(channels_children.router)
router.include_router(channels_messages.router)
router.include_router(channels_voice_moderation.router)
