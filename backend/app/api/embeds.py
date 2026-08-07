from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.dependencies import get_current_active_user
from app.models.user import User
from app.services.link_preview import fetch_link_preview
from app.services.rate_limit import rate_limit_user

router = APIRouter()


@router.get("/embeds/preview")
async def get_link_embed_preview(
    request: Request,
    url: str = Query(..., min_length=8, max_length=2048),
    current_user: User = Depends(get_current_active_user),
):
    """Превью ссылки для чата (Open Graph / картинка)."""
    rate_limit_user(current_user.id, "embeds", limit=20, window=60, request=request)
    try:
        return await fetch_link_preview(url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
