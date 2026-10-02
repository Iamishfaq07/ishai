"""The resume AI's free allowance.

A plan with the `resume_ai` feature (Resume Pro, Pro, Unlimited, and the admin) uses the AI as much as the rate limits
allow. Everyone else, signed in or not, gets one free AI action: one per account for good, and one per IP address per
ORBIT_FREE_RESUME_AI_IP_DAYS (30; 0 = for good), so new accounts or signing out on the same network don't hand out
more. An "AI action" is one request that calls the model (import, a rewrite, tailoring, a cover letter); fixes worked
out without the model (dates, skills the resume already proves) stay free, as do typing, scoring and downloads.
At most ORBIT_FREE_RESUME_AI_DAILY free actions are handed out a rolling day across everyone, so open sign-up has a
bounded cost. Accounts still waiting for sign-up approval get the free action too (the resume maker is where they
buy Resume Pro); live sessions stay locked for them.

The use is claimed just before the model is called and given back if the request fails, so an AI outage doesn't
spend it. Claims are serialized in-process (one API instance, docs/DECISIONS.md D12), and a unique key on the
account backs that up.
"""

import asyncio
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import delete, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.entitlements import buyable, plan_for, plan_named
from orbit_api.models import FreeAiUse, User
from orbit_api.ratelimit import client_ip

UPGRADE_REQUIRED = "upgrade_required"
UPGRADE_PLAN = "resume_pro"
FREE_ACTIONS = 1
# Like the rate limits, skipped in the test environment so the suite can call the AI freely; allowance tests flip it.
ENFORCE_IN_TESTS = False

_claim_lock = asyncio.Lock()


class UpgradeOffer(BaseModel):
    plan: str
    label: str
    price_inr_month: int | None
    buyable: bool


class AllowanceOut(BaseModel):
    unlimited: bool  # the plan includes resume AI
    free_left: int  # free AI actions left (0 or 1); meaningless when unlimited
    free_total: int
    upgrade: UpgradeOffer


def ip_hash(ip: str) -> str:
    """A keyed hash, so the table never holds anyone's address."""
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"free-ai:{ip}".encode(), hashlib.sha256).hexdigest()


def upgrade_offer() -> UpgradeOffer:
    p = plan_named(UPGRADE_PLAN)
    return UpgradeOffer(plan=p.name, label=p.label, price_inr_month=p.price_inr_month, buyable=buyable(p))


def _price(offer: UpgradeOffer) -> str:
    return f" (₹{offer.price_inr_month}/month)" if offer.price_inr_month else ""


class Allowance:
    """One request's view of the free allowance. `claim()` before each model call (repeat calls in the same request
    are free); `release()` when the request ends up giving the person nothing."""

    def __init__(self, db: AsyncSession, user: User | None, ip: str, unlimited: bool) -> None:
        self.db, self.user, self.ip_hash, self.unlimited = db, user, ip_hash(ip), unlimited
        self._claimed: str | None = None  # the FreeAiUse row this request took

    async def _used(self) -> bool:
        days = get_settings().free_resume_ai_ip_days
        by_ip = FreeAiUse.ip_hash == self.ip_hash
        if days:
            by_ip = by_ip & (FreeAiUse.created_at >= datetime.now(UTC) - timedelta(days=days))
        used = await self.db.scalar(select(exists().where(by_ip)))
        if not used and self.user is not None:
            used = await self.db.scalar(select(exists().where(FreeAiUse.user_id == self.user.id)))
        return bool(used)

    async def can_spend(self) -> bool:
        return self.unlimited or self._claimed is not None or not await self._used()

    async def status(self) -> AllowanceOut:
        free_left = 0 if self.unlimited or await self._used() else FREE_ACTIONS
        return AllowanceOut(unlimited=self.unlimited, free_left=free_left, free_total=FREE_ACTIONS,
                            upgrade=upgrade_offer())

    def exhausted(self) -> HTTPException:
        offer = upgrade_offer()
        if self.user is None:
            message = ("You've used the free AI edit. Create a free account and upgrade to "
                       f"{offer.label}{_price(offer)} for unlimited AI edits.")
        else:
            message = f"You've used your free AI edit. Upgrade to {offer.label}{_price(offer)} for unlimited AI edits."
        detail: dict[str, Any] = {"code": UPGRADE_REQUIRED, "message": message, "signed_in": self.user is not None,
                                  **offer.model_dump()}
        return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail=detail)

    async def claim(self) -> None:
        if self.unlimited or self._claimed is not None:
            return
        async with _claim_lock:
            if await self._used():
                raise self.exhausted()
            cap = get_settings().free_resume_ai_daily_limit
            today = await self.db.scalar(select(func.count()).select_from(FreeAiUse).where(
                FreeAiUse.created_at >= datetime.now(UTC) - timedelta(days=1)))
            if (today or 0) >= cap:
                # The use isn't spent: it's still there tomorrow.
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                    "The free AI edit has reached today's limit for everyone. Try again tomorrow, "
                                    "or upgrade for unlimited AI edits.")
            row = FreeAiUse(user_id=self.user.id if self.user else None, ip_hash=self.ip_hash)
            self.db.add(row)
            try:
                await self.db.commit()
            except IntegrityError as e:  # the account's use was taken by a request this lock didn't see
                await self.db.rollback()
                raise self.exhausted() from e
            self._claimed = row.id

    async def release(self) -> None:
        if self._claimed is None:
            return
        await self.db.rollback()  # whatever the failed request left half-done
        await self.db.execute(delete(FreeAiUse).where(FreeAiUse.id == self._claimed))
        await self.db.commit()
        self._claimed = None


async def allowance_for(db: AsyncSession, user: User | None, request: Request) -> Allowance:
    if get_settings().env == "test" and not ENFORCE_IN_TESTS:
        return Allowance(db, user, client_ip(request), unlimited=True)
    unlimited = user is not None and (await plan_for(db, user.id)).has("resume_ai")
    return Allowance(db, user, client_ip(request), unlimited)
