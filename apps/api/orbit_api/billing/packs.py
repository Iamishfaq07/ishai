"""Credit packs sold over UPI (billing/upi.py). A pack adds resume-AI credits and interview minutes that never
expire; nothing renews. Defaults below; `ORBIT_CREDIT_PACKS_JSON` replaces them, for example
`[{"id": "starter", "label": "3 credits", "price_inr": 2599, "resume_credits": 30, "interview_minutes": 180}]`
(optional: "bonus_minutes" of free time on top, a "badge", and "price_usd_cents": a fixed dollar price; without it
the dollar price is the rupee price converted, billing/pricing.py).
Invalid packs stop the API at boot.
"""

import json
import re
from dataclasses import asdict, dataclass
from typing import Any

from orbit_api.config import get_settings


@dataclass(frozen=True)
class CreditPack:
    id: str
    label: str
    price_inr: int
    resume_credits: int
    interview_minutes: int
    # Free interview time on top ("6 credits + 2 free"): added with the rest, shown apart on the card.
    bonus_minutes: int = 0
    badge: str | None = None  # "Most popular", "Best value"
    # The dollar price outside India, in cents ($53.99 = 5399). None: the rupee price converted (pricing.usd_cents).
    price_usd_cents: int | None = None

    @property
    def total_minutes(self) -> int:
        return self.interview_minutes + self.bonus_minutes


# Interview credits the way Parakeet AI sells them (1 credit = 1 hour of interviews; 1, 3, 6 + 2 free, 9 + 6 free),
# with Resume AI credits included. "AI credits" is Resume AI alone, for someone who doesn't need interview time.
# Rupees: about 30% under Parakeet's own rupee prices (₹2,360 / ₹3,690 / ₹7,380 / ₹11,070, checked 2026-10-18:
# docs/DECISIONS.md D60). Dollars: pinned where they were before that cut, so buyers outside India pay what they did.
DEFAULT_PACKS: tuple[CreditPack, ...] = (
    CreditPack("mini", "AI credits", price_inr=499, resume_credits=25, interview_minutes=0, price_usd_cents=799),
    CreditPack("single", "1 credit", price_inr=1649, resume_credits=10, interview_minutes=60, price_usd_cents=3399),
    CreditPack("starter", "3 credits", price_inr=2599, resume_credits=30, interview_minutes=180,
               price_usd_cents=5399),
    CreditPack("plus", "8 credits", price_inr=5199, resume_credits=80, interview_minutes=360, bonus_minutes=120,
               badge="Most popular", price_usd_cents=10699),
    CreditPack("pro", "15 credits", price_inr=7749, resume_credits=150, interview_minutes=540, bonus_minutes=360,
               badge="Best value", price_usd_cents=16199),
)
_INT_FIELDS = ("price_inr", "resume_credits", "interview_minutes")
_OPTIONAL = ("bonus_minutes", "badge", "price_usd_cents")


def usd_cents_ok(v: object) -> bool:
    """A configured `price_usd_cents`: left out (null), or a positive whole number of cents."""
    return v is None or (isinstance(v, int) and not isinstance(v, bool) and v > 0)


def packs() -> dict[str, CreditPack]:
    raw = get_settings().credit_packs_json
    if not raw:
        return {p.id: p for p in DEFAULT_PACKS}
    items = json.loads(raw)
    if not isinstance(items, list) or not items:
        raise ValueError("ORBIT_CREDIT_PACKS_JSON must be a non-empty JSON list of packs")
    out: dict[str, CreditPack] = {}
    for item in items:
        if not isinstance(item, dict) or not {"id", "label", *_INT_FIELDS} <= set(item) <= {
                "id", "label", *_INT_FIELDS, *_OPTIONAL}:
            raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: each pack needs id, label, {', '.join(_INT_FIELDS)} "
                             f"(optional: {', '.join(_OPTIONAL)})")
        if not (isinstance(item["id"], str) and 0 < len(item["id"]) <= 32 and item["id"] not in out):
            raise ValueError("ORBIT_CREDIT_PACKS_JSON: pack ids must be unique short strings")
        for key in (*_INT_FIELDS, "bonus_minutes"):
            v = item.get(key, 0)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: {item['id']}.{key} must be a whole number")
        if item["price_inr"] <= 0 or not (item["resume_credits"] or item["interview_minutes"]):
            raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: {item['id']} needs a price and something in it")
        if not usd_cents_ok(item.get("price_usd_cents")):
            raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: {item['id']}.price_usd_cents must be a positive whole number")
        out[item["id"]] = CreditPack(**item)
    return out


def pack_label(p: CreditPack) -> str:
    """How an order for it reads: "3 credits pack" → "3 interview credits", "AI credits" stays, others "X pack"."""
    if "credit" in p.label.lower():
        return re.sub(r"\bcredit", "interview credit", p.label) if p.interview_minutes else p.label
    return f"{p.label} pack"


def checkout() -> str | None:
    """How packs are bought right now: Razorpay's checkout when it's set up (PayPal abroad is decided per buyer in
    billing/routes.py). Paying the UPI ID by hand is only offered while ORBIT_MANUAL_UPI is on, which it isn't by
    default; UPI orders already open can still be finished and checked by the admin either way."""
    from orbit_api.billing import razorpay

    if razorpay.configured():
        return "razorpay"
    s = get_settings()
    return "upi" if s.manual_upi and s.upi_id else None


def abroad_payable(how: str | None) -> bool:
    """Buyers outside India can pay: PayPal is set up, or Razorpay takes their cards."""
    from orbit_api.billing import paypal

    return paypal.configured() or (how == "razorpay" and get_settings().razorpay_international)


def public_packs() -> list[dict[str, Any]]:
    how = checkout()
    abroad = abroad_payable(how)
    return [{**asdict(p), "total_minutes": p.total_minutes, "buyable": how is not None, "checkout": how,
             "international": abroad} for p in packs().values()]
