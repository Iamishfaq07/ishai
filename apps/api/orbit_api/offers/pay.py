"""What a role pays, read from the pay ranges in the job posts Orbit has (job_portal): "₹30L – ₹40L a year",
"$140k – $165k a year", an Ashby summary's "$150K – $200K • Offers Equity". Every figure is a year's pay in one
currency, so posts paid by the hour or month are scaled to a year (2,080 hours, 12 months).

It's the posts' own ranges, not offers people accepted: the page says how many posts it read, and which.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass

CURRENCY_SIGNS = {"₹": "INR", "$": "USD", "€": "EUR", "£": "GBP"}
# The currencies a pay line may name by code (region.CURRENCIES' ones, but not TRY, PHP, PEN or COP: words or a
# language in a post before they're money).
_CODES = ("INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "NZD", "HKD", "AED", "CHF", "SEK", "NOK", "DKK", "PLN",
          "CZK", "RON", "SAR", "QAR", "KWD", "OMR", "BHD", "ILS", "EGP", "MYR", "IDR", "THB", "VND", "JPY", "KRW",
          "CNY", "TWD", "PKR", "BDT", "LKR", "NPR", "ZAR", "NGN", "KES", "GHS", "BRL", "MXN", "ARS", "CLP")
# A bare "$" is the dollar where the post is (anywhere else, the US dollar); "CA$", "A$", "S$" say which outright.
DOLLARS = {"CA": "CAD", "AU": "AUD", "NZ": "NZD", "SG": "SGD", "HK": "HKD"}
_DOLLAR_PREFIX = {"US": "USD", "CA": "CAD", "C": "CAD", "AU": "AUD", "A": "AUD", "NZ": "NZD", "SG": "SGD",
                  "S": "SGD", "HK": "HKD"}
_PREFIXED = re.compile(r"\b(US|CA|C|AU|A|NZ|SG|S|HK)\$")
_UNIT = {"k": 1_000, "l": 100_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000, "lpa": 100_000,
         "cr": 10_000_000, "crore": 10_000_000, "m": 1_000_000, "mn": 1_000_000}
_AMOUNT = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lpa|crore|cr|mn|k|l|m)?(?![a-z])",
                     re.I)


@dataclass(frozen=True)
class Pay:
    currency: str
    low: float  # a year
    high: float


def _dollar(text: str, country: str | None) -> str:
    """Which dollar a "$" is: the one the line names ("CA$90k", "$120k CAD"), else the one where the post is."""
    upper = text.upper()
    if m := _PREFIXED.search(upper):
        return _DOLLAR_PREFIX[m.group(1)]
    for code in ("USD", *DOLLARS.values()):
        if re.search(rf"\b{code}\b", upper):
            return code
    return DOLLARS.get((country or "").upper(), "USD")


def _currency(text: str, country: str | None = None) -> str | None:
    for sign, code in CURRENCY_SIGNS.items():
        if sign in text:
            return _dollar(text, country) if sign == "$" else code
    upper = text.upper()
    for code in _CODES:
        if re.search(rf"\b{code}\b", upper):
            return code
    if re.search(r"\b(?:lpa|lakhs?|lacs?|crore)\b", text, re.I):
        return "INR"
    return None


def _per_year(text: str) -> float:
    t = text.lower()
    if re.search(r"\b(?:an? |per |/ ?)(?:hour|hr)\b|hourly", t):
        return 2_080
    if re.search(r"\b(?:a |per |/ ?)(?:month|mo)\b|monthly", t):
        return 12
    return 1


def parse_pay(text: str | None, country: str | None = None) -> Pay | None:
    """A post's pay line as a year's range, or None when it isn't one (no currency, no figure, an implausible
    figure). `country`: where the post is, when known, for which dollar a "$" means."""
    if not text:
        return None
    currency = _currency(text, country)
    if currency is None:
        return None
    found: list[tuple[float, str]] = []
    for m in _AMOUNT.finditer(text):
        digits, unit = m.group(1), (m.group(2) or "").lower()
        try:
            found.append((float(digits.replace(",", "")), unit))
        except ValueError:
            continue
        if len(found) == 2:
            break
    # "18-24 LPA", "$120-150k": the unit written once is the range's.
    shared = next((u for _, u in reversed(found) if u), "")
    values = [v * _UNIT.get(u or shared, 1) for v, u in found]
    if not values:
        return None
    scale = _per_year(text)
    low, high = min(values) * scale, max(values) * scale
    floor = 50_000 if currency == "INR" else 5_000  # "3 days a week", "401k": not pay
    if low < floor or high > low * 4:
        return None
    return Pay(currency, low, high)


@dataclass(frozen=True)
class Sample:
    listing_id: str
    title: str
    company: str
    salary: str
    city: str


@dataclass(frozen=True)
class Market:
    currency: str
    count: int
    p25: float
    median: float
    p75: float
    low: float
    high: float
    samples: list[Sample]
    scope: str  # what was read: "Backend Engineer in Bengaluru", "Backend Engineer in India"


def market(rows: list[tuple[Sample, Pay]], currency: str, scope: str, min_posts: int = 3) -> Market | None:
    """The middle of the posts' ranges (each post counts once, at its range's midpoint), in the one currency."""
    mine = [(s, p) for s, p in rows if p.currency == currency]
    if len(mine) < min_posts:
        return None
    mids = sorted((p.low + p.high) / 2 for _, p in mine)
    q = statistics.quantiles(mids, n=4, method="inclusive") if len(mids) >= 2 else [mids[0]] * 3
    return Market(currency=currency, count=len(mine), p25=q[0], median=q[1], p75=q[2],
                  low=min(p.low for _, p in mine), high=max(p.high for _, p in mine),
                  samples=[s for s, _ in sorted(mine, key=lambda sp: -(sp[1].low + sp[1].high))][:6], scope=scope)
