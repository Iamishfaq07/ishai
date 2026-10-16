"""The resume AI's allowance: resume credits (credits.py).

A plan with the `resume_ai` feature (the admin, Pro or Unlimited granted for a while) uses the AI as much as the rate
limits allow. On the Free plan each AI action spends one resume credit: the welcome credit, then credits from a UPI
pack. An "AI action" is one request that calls the model (import, tailoring, a cover letter, a whole-resume
rewrite). A single fix (one ATS check, one section or line rewritten) costs a fraction: the first one spends a credit
and leaves RESUME_FIXES_PER_CREDIT - 1 fixes paid for (the "resume_fix" ledger), which the next fixes use first.
Fixes worked out without the model (dates, skills the resume already proves) stay free, as do typing, scoring and
downloads.

The credit is claimed just before the model is called and given back if the request fails, so an AI outage doesn't
spend it. Claims lock the account in the database, so concurrent requests cannot both spend the last credit.
"""

from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.billing.packs import packs
from orbit_api.config import get_settings
from orbit_api.entitlements import plan_for
from orbit_api.models import CreditEntry, User
from orbit_api.transactions import lock_account

UPGRADE_REQUIRED = "upgrade_required"
# Like the rate limits, skipped in the test environment so the suite can call the AI freely; allowance tests flip it.
ENFORCE_IN_TESTS = False



class UpgradeOffer(BaseModel):
    """The cheapest credit pack: what the Upgrade button leads to."""
    pack: str
    label: str
    price_inr: int
    resume_credits: int
    interview_minutes: int
    buyable: bool


class AllowanceOut(BaseModel):
    unlimited: bool  # the plan includes resume AI
    credits_left: int  # resume credits left; meaningless when unlimited
    upgrade: UpgradeOffer | None
    # Single AI fixes already paid for (used before another credit is), and how many fixes one credit covers.
    fixes_left: int = 0
    fixes_per_credit: int = 1


def upgrade_offer() -> UpgradeOffer | None:
    available = sorted(packs().values(), key=lambda p: p.price_inr)
    cheapest = next((p for p in available if p.resume_credits), None)
    if cheapest is None:
        return None
    return UpgradeOffer(pack=cheapest.id, label=cheapest.label, price_inr=cheapest.price_inr,
                        resume_credits=cheapest.resume_credits, interview_minutes=cheapest.interview_minutes,
                        buyable=bool(get_settings().upi_id))


class Allowance:
    """One request's view of the user's resume credits. `claim()` before each model call (repeat calls in the same
    request are free); `release()` when the request ends up giving the person nothing."""

    def __init__(self, db: AsyncSession, user: User, unlimited: bool) -> None:
        self.db, self.user, self.unlimited = db, user, unlimited
        self._claimed: list[str] = []  # the credit entries this request wrote
        self._fix = False  # a single fix: costs one fix, not a whole credit

    def as_fix(self) -> "Allowance":
        """This request is one small fix (one ATS check, one section or line): it costs a fraction of a credit."""
        self._fix = True
        return self

    async def can_spend(self) -> bool:
        if self.unlimited or self._claimed:
            return True
        if self._fix and await credits.resume_balance(self.db, self.user.id, "resume_fix") > 0:
            return True
        return await credits.resume_balance(self.db, self.user.id) > 0

    async def status(self) -> AllowanceOut:
        per = get_settings().resume_fixes_per_credit
        if self.unlimited:
            return AllowanceOut(unlimited=True, credits_left=0, upgrade=upgrade_offer(), fixes_per_credit=per)
        return AllowanceOut(unlimited=False, credits_left=await credits.resume_balance(self.db, self.user.id),
                            upgrade=upgrade_offer(), fixes_per_credit=per,
                            fixes_left=await credits.resume_balance(self.db, self.user.id, "resume_fix"))

    def exhausted(self) -> HTTPException:
        offer = upgrade_offer()
        more = (f" Packs start at ₹{offer.price_inr} for {offer.resume_credits} resume credits"
                + (f" and {offer.interview_minutes} interview minutes." if offer.interview_minutes else ".")
                if offer else "")
        detail: dict[str, Any] = {"code": UPGRADE_REQUIRED, "message": f"You're out of resume AI credits.{more}",
                                  "signed_in": True, **(offer.model_dump() if offer else {})}
        return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail=detail)

    async def claim(self) -> None:
        if self.unlimited or self._claimed:
            return
        await lock_account(self.db, self.user.id)
        entries: list[CreditEntry] = []
        if self._fix and await credits.resume_balance(self.db, self.user.id, "resume_fix") > 0:
            entries.append(credits.add(self.db, self.user.id, "resume_fix", -1, "resume_ai"))
        else:
            if await credits.resume_balance(self.db, self.user.id) <= 0:
                raise self.exhausted()
            entries.append(credits.add(self.db, self.user.id, "resume", -1, "resume_ai"))
            if self._fix and (per := get_settings().resume_fixes_per_credit) > 1:
                # The credit pays for this fix and the next few.
                entries.append(credits.add(self.db, self.user.id, "resume_fix", per - 1, "resume_ai"))
        await self.db.commit()
        self._claimed = [e.id for e in entries]

    async def release(self) -> None:
        if not self._claimed:
            return
        await self.db.rollback()  # whatever the failed request left half-done
        await self.db.execute(delete(CreditEntry).where(CreditEntry.id.in_(self._claimed)))
        await self.db.commit()
        self._claimed = []


async def allowance_for(db: AsyncSession, user: User) -> Allowance:
    if get_settings().env == "test" and not ENFORCE_IN_TESTS:
        return Allowance(db, user, unlimited=True)
    return Allowance(db, user, unlimited=(await plan_for(db, user.id)).has("resume_ai"))
