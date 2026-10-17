"""Monthly plans: a plan (entitlements.py) for 30 days, paid once through the same checkout as the credit packs
(Razorpay, else UPI with a UTR). Nothing renews or is charged automatically: buying again adds another 30 days, and
when the time runs out the account is back on Free with whatever credits it still has.

Defaults below; `ORBIT_MONTHLY_PLANS_JSON` replaces them, for example
`[{"id": "pro_monthly", "label": "Pro", "price_inr": 3999, "plan": "pro", "days": 30}]` (an empty list `[]` sells
none; optional "price_usd_cents" fixes the dollar price, else it's the rupee price converted, billing/pricing.py).
Invalid plans stop the API at boot.

A paid month is a time-limited plan on the account (`User.grant_plan` until `User.grant_until`, the same as the
admin's grants), and its allowance is metered in 30-day windows from when it was bought (entitlements.
allowance_window), not per calendar month, so a month bought on the 28th isn't two allowances and use from before it
never counts. Every window, a week's included, has the plan's whole allowance. Buying while another plan runs never
cuts either short (D57).
"""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from orbit_api.config import get_settings
from orbit_api.models import Payment, User

if TYPE_CHECKING:
    from orbit_api.entitlements import Grant

PERIOD_DAYS = 30


@dataclass(frozen=True)
class MonthlyPlan:
    id: str
    label: str
    price_inr: int
    plan: str  # the entitlements plan it gives (entitlements.GRANT_PLANS)
    days: int = PERIOD_DAYS
    badge: str | None = None  # "Most popular", "Best value": shown on the pricing card
    # The dollar price outside India, in cents. None: the rupee price converted (pricing.usd_cents).
    price_usd_cents: int | None = None


# Unlimited the way Parakeet AI sells it (a week, a month, a year). Rupees: about 30% under Parakeet's own rupee prices
# (₹4,980 / ₹9,470 / ₹37,900, checked 2026-10-18: docs/DECISIONS.md D60). Dollars: pinned where they were before that
# cut. All three give the same plan; only the length and price differ.
DEFAULT_MONTHLY: tuple[MonthlyPlan, ...] = (
    MonthlyPlan("premium_weekly", "Weekly", price_inr=3499, plan="premium", days=7, price_usd_cents=7099),
    MonthlyPlan("premium_monthly", "Monthly", price_inr=6599, plan="premium", days=30, badge="Most popular",
                price_usd_cents=13599),
    MonthlyPlan("premium_yearly", "Yearly", price_inr=26499, plan="premium", days=365, badge="Best value",
                price_usd_cents=53199),
)
_KEYS = {"id", "label", "price_inr", "plan", "days", "badge", "price_usd_cents"}


def monthly_plans() -> dict[str, MonthlyPlan]:
    from orbit_api.billing.packs import packs, usd_cents_ok
    from orbit_api.entitlements import GRANT_PLANS

    raw = get_settings().monthly_plans_json
    if raw is None:
        items = [m.__dict__ for m in DEFAULT_MONTHLY]
    else:
        items = json.loads(raw)
        if not isinstance(items, list):
            raise ValueError("ORBIT_MONTHLY_PLANS_JSON must be a JSON list of plans")
    out: dict[str, MonthlyPlan] = {}
    taken = set(packs())
    for item in items:
        if not isinstance(item, dict) or not {"id", "label", "price_inr", "plan"} <= set(item) <= _KEYS:
            raise ValueError("ORBIT_MONTHLY_PLANS_JSON: each plan needs id, label, price_inr, plan (optional: days, "
                             "badge, price_usd_cents)")
        pid = item["id"]
        if not (isinstance(pid, str) and 0 < len(pid) <= 32 and pid not in out and pid not in taken):
            raise ValueError("ORBIT_MONTHLY_PLANS_JSON: ids must be unique short strings, not a credit pack's id")
        if item["plan"] not in GRANT_PLANS:
            raise ValueError(f"ORBIT_MONTHLY_PLANS_JSON: {pid}.plan must be one of {list(GRANT_PLANS)}")
        for key in ("price_inr", "days"):
            v = item.get(key, PERIOD_DAYS)
            if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
                raise ValueError(f"ORBIT_MONTHLY_PLANS_JSON: {pid}.{key} must be a positive whole number")
        if not usd_cents_ok(item.get("price_usd_cents")):
            raise ValueError(f"ORBIT_MONTHLY_PLANS_JSON: {pid}.price_usd_cents must be a positive whole number")
        out[pid] = MonthlyPlan(**item)
    return out


def public_monthly() -> list[dict[str, Any]]:
    """For the pricing pages: each plan with what its month includes."""
    from orbit_api.billing.packs import abroad_payable, checkout
    from orbit_api.entitlements import plan_named

    how = checkout()
    abroad = abroad_payable(how)
    out = []
    for m in monthly_plans().values():
        p = plan_named(m.plan)
        out.append({"id": m.id, "label": m.label, "price_inr": m.price_inr, "price_usd_cents": m.price_usd_cents,
                    "days": m.days, "plan": m.plan, "badge": m.badge,
                    "per_month_inr": round(m.price_inr * PERIOD_DAYS / m.days),
                    "live_minutes": p.live_minutes, "mock_minutes": p.mock_minutes, "screenshots": p.screenshots,
                    "documents": p.documents, "max_session_minutes": p.max_session_minutes,
                    "resume_ai": p.has("resume_ai"), "buyable": how is not None, "checkout": how,
                    "international": abroad})
    return out


def plan_of(p: Payment, fallback: str | None = None) -> str:
    """The plan (entitlements.GRANT_PLANS) a paid month gives; an order for one no longer sold, `fallback`."""
    m = monthly_plans().get(p.plan)
    return m.plan if m else str(fallback or "pro")


def apply(user: User, p: Payment, now: datetime | None = None) -> "Grant":
    """A paid month lands, and nothing already given or paid for is cut short (entitlements.add_grant, D57): the same
    plan running is extended by its days; a higher plan starts now and the rest of the running one waits behind it;
    a lower plan waits until the running one ends. Returns the bought plan's grant. The caller commits."""
    from orbit_api.entitlements import add_grant

    user.approved = True
    return add_grant(user, plan_of(p, user.grant_plan), timedelta(days=p.days), paid=True, now=now)


def what(p: Payment) -> str:
    m = monthly_plans().get(p.plan)
    return f"the {m.label if m else p.plan} plan ({p.days} days)"
