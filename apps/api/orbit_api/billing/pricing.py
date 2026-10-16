"""Prices by where the buyer is: rupees in India, US dollars everywhere else.

The country comes from the request: the web app's edge (Cloudflare) knows it and states it on the proxied request
(`X-Orbit-Client-Country`), which the API believes only with the proxy secret, like the client IP (ratelimit.py).
Without that header (the desktop app, a direct caller) it falls back to the account's own country, then to India.

A dollar price is the rupee price at ORBIT_USD_INR rupees to the dollar, plus ORBIT_INTL_MARKUP (30%), rounded up
to the next whole dollar less a cent ($135.99). Rupee prices stay exactly as configured (packs.py, monthly.py).
"""

import math
from dataclasses import dataclass

from starlette.requests import HTTPConnection

from orbit_api import region
from orbit_api.config import get_settings
from orbit_api.models import Payment, User
from orbit_api.ratelimit import proxy_signed

CLIENT_COUNTRY_HEADER = "x-orbit-client-country"
INR, USD = "INR", "USD"
SYMBOL = {INR: "₹", USD: "$"}


def request_country(request: HTTPConnection) -> str | None:
    """The country the edge saw the request come from, when it can be believed."""
    if get_settings().proxy_secret is not None and not proxy_signed(request):
        return None
    return region.country_code(request.headers.get(CLIENT_COUNTRY_HEADER))


def currency_for(request: HTTPConnection, user: User | None = None) -> str:
    country = request_country(request) or (user.country if user is not None else None) or region.INDIA
    return INR if region.is_india(country) else USD


def usd_cents(price_inr: int) -> int:
    s = get_settings()
    dollars = math.ceil(price_inr / s.usd_inr_rate * s.intl_markup - 1e-9)
    return max(dollars, 1) * 100 - 1


@dataclass(frozen=True)
class Price:
    currency: str
    minor: int  # paise or cents
    inr: int  # the rupee price (an INR equivalent for a dollar sale: what reports add up)

    @property
    def major(self) -> float:
        return self.minor / 100

    def text(self) -> str:
        return money(self.currency, self.minor)


def price(price_inr: int, currency: str) -> Price:
    if currency == USD:
        cents = usd_cents(price_inr)
        return Price(USD, cents, round(cents / 100 * get_settings().usd_inr_rate))
    return Price(INR, price_inr * 100, price_inr)


def money(currency: str, minor: int) -> str:
    if currency == INR:
        return f"₹{minor // 100:,}"
    return f"{SYMBOL.get(currency, currency + ' ')}{minor / 100:,.2f}"


def payment_minor(p: Payment) -> int:
    """What the payment was for, in its currency's minor unit (older rows: rupees)."""
    return p.amount_minor if p.amount_minor is not None and (p.currency or INR) != INR else p.amount_inr * 100


def payment_currency(p: Payment) -> str:
    return p.currency or INR


def payment_text(p: Payment) -> str:
    return money(payment_currency(p), payment_minor(p))
