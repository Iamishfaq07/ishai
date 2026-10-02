"""Credit packs sold over UPI (billing/upi.py). A pack adds resume-AI credits and interview minutes that never
expire; nothing renews. Defaults below; `ORBIT_CREDIT_PACKS_JSON` replaces them, for example
`[{"id": "starter", "label": "Starter", "price_inr": 1499, "resume_credits": 15, "interview_minutes": 60}]`.
Invalid packs stop the API at boot.
"""

import json
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


DEFAULT_PACKS: tuple[CreditPack, ...] = (
    CreditPack("starter", "Starter", price_inr=1499, resume_credits=15, interview_minutes=60),
    CreditPack("plus", "Plus", price_inr=2999, resume_credits=40, interview_minutes=150),
    CreditPack("pro", "Pro", price_inr=5999, resume_credits=100, interview_minutes=360),
)
_INT_FIELDS = ("price_inr", "resume_credits", "interview_minutes")


def packs() -> dict[str, CreditPack]:
    raw = get_settings().credit_packs_json
    if not raw:
        return {p.id: p for p in DEFAULT_PACKS}
    items = json.loads(raw)
    if not isinstance(items, list) or not items:
        raise ValueError("ORBIT_CREDIT_PACKS_JSON must be a non-empty JSON list of packs")
    out: dict[str, CreditPack] = {}
    for item in items:
        if not isinstance(item, dict) or set(item) != {"id", "label", *_INT_FIELDS}:
            raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: each pack needs exactly id, label, {', '.join(_INT_FIELDS)}")
        if not (isinstance(item["id"], str) and 0 < len(item["id"]) <= 32 and item["id"] not in out):
            raise ValueError("ORBIT_CREDIT_PACKS_JSON: pack ids must be unique short strings")
        for key in _INT_FIELDS:
            v = item[key]
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: {item['id']}.{key} must be a whole number")
        if item["price_inr"] <= 0 or not (item["resume_credits"] or item["interview_minutes"]):
            raise ValueError(f"ORBIT_CREDIT_PACKS_JSON: {item['id']} needs a price and something in it")
        out[item["id"]] = CreditPack(**item)
    return out


def public_packs() -> list[dict[str, Any]]:
    buyable = bool(get_settings().upi_id)
    return [{**asdict(p), "buyable": buyable} for p in packs().values()]
