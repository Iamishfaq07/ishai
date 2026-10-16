"""Monthly plans: a plan (entitlements.py) for 30 days, paid once through the same checkout as the credit packs
(Razorpay, else UPI with a UTR). Nothing renews or is charged automatically: buying again adds another 30 days, and
when the time runs out the account is back on Free with whatever credits it still has.

Defaults below; `ORBIT_MONTHLY_PLANS_JSON` replaces them, for example
`[{"id": "pro_monthly", "label": "Pro", "price_inr": 3999, "plan": "pro", "days": 30}]` (an empty list `[]` sells
none). Invalid plans stop the API at boot.

A paid month is a time-limited plan on the account (`User.grant_plan` until `User.grant_until`, the same as the
admin's grants), and its allowance is metered per 30-day period of it (entitlements.period_start), not per calendar
month, so a month bought on the 28th isn't two allowances.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from orbit_api.config import get_settings
from orbit_api.models import Payment, User

PERIOD_DAYS = 30


@dataclass(frozen=True)
class MonthlyPlan:
    id: str
    label: str
    price_inr: int
    plan: str  # the entitlements plan it gives (entitlements.GRANT_PLANS)
    days: int = PERIOD_DAYS


DEFAULT_MONTHLY: tuple[MonthlyPlan, ...] = (
    MonthlyPlan("basic_monthly", "Basic", price_inr=1499, plan="basic"),
    MonthlyPlan("pro_monthly", "Pro", price_inr=3999, plan="pro"),
)


def monthly_plans() -> dict[str, MonthlyPlan]:
    from orbit_api.billing.packs import packs
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
        if not isinstance(item, dict) or not {"id", "label", "price_inr", "plan"} <= set(item) or not set(item) <= {
                "id", "label", "price_inr", "plan", "days"}:
            raise ValueError("ORBIT_MONTHLY_PLANS_JSON: each plan needs id, label, price_inr, plan (and optional days)")
        pid = item["id"]
        if not (isinstance(pid, str) and 0 < len(pid) <= 32 and pid not in out and pid not in taken):
            raise ValueError("ORBIT_MONTHLY_PLANS_JSON: ids must be unique short strings, not a credit pack's id")
        if item["plan"] not in GRANT_PLANS:
            raise ValueError(f"ORBIT_MONTHLY_PLANS_JSON: {pid}.plan must be one of {list(GRANT_PLANS)}")
        for key in ("price_inr", "days"):
            v = item.get(key, PERIOD_DAYS)
            if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
                raise ValueError(f"ORBIT_MONTHLY_PLANS_JSON: {pid}.{key} must be a positive whole number")
        out[pid] = MonthlyPlan(**item)
    return out


def public_monthly() -> list[dict[str, Any]]:
    """For the pricing pages: each plan with what its month includes."""
    from orbit_api.billing.packs import checkout
    from orbit_api.entitlements import plan_named

    how = checkout()
    abroad = how == "razorpay" and get_settings().razorpay_international
    out = []
    for m in monthly_plans().values():
        p = plan_named(m.plan)
        out.append({"id": m.id, "label": m.label, "price_inr": m.price_inr, "days": m.days, "plan": m.plan,
                    "live_minutes": p.live_minutes, "mock_minutes": p.mock_minutes, "screenshots": p.screenshots,
                    "documents": p.documents, "max_session_minutes": p.max_session_minutes,
                    "resume_ai": p.has("resume_ai"), "buyable": how is not None, "checkout": how,
                    "international": abroad})
    return out


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def apply(user: User, p: Payment, now: datetime | None = None) -> datetime:
    """A paid month lands: the same plan still running is extended by its days; otherwise the plan starts now (it
    replaces a different plan that was running). Returns the new end. The caller commits."""
    now = now or datetime.now(UTC)
    m = monthly_plans().get(p.plan)
    plan = m.plan if m else str(user.grant_plan or "pro")
    running = user.grant_until is not None and _aware(user.grant_until) > now and user.grant_plan == plan
    start = _aware(user.grant_until) if running and user.grant_until is not None else now
    user.grant_plan, user.grant_until = plan, start + timedelta(days=p.days)
    user.approved = True
    return user.grant_until


def what(p: Payment) -> str:
    m = monthly_plans().get(p.plan)
    return f"the {m.label if m else p.plan} plan for {p.days} days"
