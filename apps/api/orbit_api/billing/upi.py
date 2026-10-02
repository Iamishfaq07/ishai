"""UPI payments for plans, with no payment gateway: the payer pays the configured UPI ID from any UPI app, then gives
the UTR (the bank's 12-digit transaction number); the admin checks it against the bank statement and approves it,
which grants the plan for 30 days (added on to a running grant of the same plan).

- An order fixes the plan, amount and a reference (`ORB…`). The reference goes in the UPI note, so the admin can match
  the credit even before the UTR comes in.
- The `upi://pay` link (and the QR the app draws from it) carries the amount, so nobody types it. Some UPI apps
  refuse links to personal UPI IDs; scanning the QR from another phone or paying the UPI ID by hand always works, so
  the page shows all three.
- A UTR can be used once across all payments. A rejected payment can be submitted again with the right UTR.

Nothing is charged automatically and nothing is renewed: when the 30 days run out, the account is back on Free and
can buy another month.
"""

import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlencode

from orbit_api.config import get_settings
from orbit_api.models import Payment

PLAN_DAYS = 30
# Reused instead of making another, so reloading the page doesn't scatter orders (and references) around.
OPEN_ORDER_REUSE = timedelta(hours=24)
_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: it gets read off a phone screen


def new_reference() -> str:
    return "ORB" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(7))


def normalize_utr(raw: str) -> str | None:
    """The 12-digit UPI reference (UTR / RRN / "UPI Ref No."), with any spaces or dashes taken out."""
    utr = "".join(ch for ch in raw if ch.isalnum())
    return utr if len(utr) == 12 and utr.isdigit() else None


def upi_uri(payment: Payment, plan_label: str) -> str:
    """A `upi://pay` link every UPI app understands: payee, amount in rupees, and the reference in the note."""
    s = get_settings()
    assert s.upi_id
    params = {"pa": s.upi_id, "pn": s.upi_name, "am": f"{payment.amount_inr}.00", "cu": "INR",
              "tn": f"Orbit {plan_label} {payment.reference}"}
    return "upi://pay?" + urlencode(params, quote_via=quote)


def grant_window(now: datetime, running_until: datetime | None, days: int) -> datetime:
    """When the plan runs out after this payment: added on to a running grant of the same plan, else from now."""
    start = running_until if running_until and running_until > now else now
    return start + timedelta(days=days)


def aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)
