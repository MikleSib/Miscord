"""Bounded facade for the webhooks API."""

from fastapi import APIRouter

from . import webhooks_management
from . import webhooks_execution
from .webhooks_shared import *  # noqa: F401,F403
from .webhooks_management import *  # noqa: F401,F403
from .webhooks_execution import *  # noqa: F401,F403

router = APIRouter()
router.include_router(webhooks_management.router)
router.include_router(webhooks_execution.router)
