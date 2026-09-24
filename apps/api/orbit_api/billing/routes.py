"""Plans and entitlements over HTTP. Payments (Stripe) plug in here; limits and features never come from clients."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import entitlements
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import User

router = APIRouter(prefix="/v1", tags=["billing"])


@router.get("/plans")
async def list_plans() -> list[dict[str, Any]]:
    """Public: what each plan includes (the pricing page renders this, not a hard-coded copy)."""
    return entitlements.public_plans()


@router.get("/entitlements")
async def my_entitlements(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """The signed-in user's plan, its limits, this month's usage, and which features are on."""
    return await entitlements.for_user(db, user)
