"""Facade for bounded server/channel route groups."""

from fastapi import APIRouter

from . import channels_overview
from . import channels_membership

router = APIRouter()
router.include_router(channels_overview.router)
router.include_router(channels_membership.router)
