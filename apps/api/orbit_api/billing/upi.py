"""UPI payments for credit packs (billing/packs.py), with no payment gateway: the payer pays the configured UPI ID
from any UPI app, then gives the UTR (the bank's 12-digit transaction number); the admin checks it against the bank
statement and approves it, which adds the pack's credits (credits.py). Credits never expire.

- An order fixes the pack, amount and a reference (`ORB…`). The reference goes in the UPI note, so the admin can match
  the credit even before the UTR comes in.
- The `upi://pay` link (and the QR the app draws from it) carries the amount, so nobody types it. Some UPI apps
  refuse links to personal UPI IDs; scanning the QR from another phone or paying the UPI ID by hand always works, so
  the page shows all three.
- A UTR can be used once across all payments. A rejected payment can be submitted again with the right UTR.

Nothing is charged automatically and nothing renews: a pack is bought when it's wanted.
"""

import re
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlencode

from orbit_api.config import get_settings
from orbit_api.models import Payment

# Reused instead of making another, so reloading the page doesn't scatter orders (and references) around.
OPEN_ORDER_REUSE = timedelta(hours=24)
_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: it gets read off a phone screen


def new_reference() -> str:
    return "ORB" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(7))


def normalize_utr(raw: str) -> str | None:
    """The 12-digit UPI reference (UTR / RRN / "UPI Ref No."), with any spaces or dashes taken out."""
    # ASCII only: "𝟏23456789012" is a different string to the database but the same UTR to a person, so the
    # unique check would let one transfer be claimed twice.
    utr = "".join(ch for ch in raw if ch.isascii() and ch.isalnum())
    return utr if re.fullmatch(r"[0-9]{12}", utr) else None


def upi_uri(payment: Payment, plan_label: str) -> str:
    """A `upi://pay` link every UPI app understands: payee, amount in rupees, and the reference in the note."""
    s = get_settings()
    assert s.upi_id
    params = {"pa": s.upi_id, "pn": s.upi_name, "am": f"{payment.amount_inr}.00", "cu": "INR",
              "tn": f"Orbit {plan_label} {payment.reference}"}
    return "upi://pay?" + urlencode(params, quote_via=quote)


def aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)
