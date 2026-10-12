"""Razorpay (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/): credit packs bought with
cards (international ones once Razorpay enables them for the account), UPI, netbanking or wallets, confirmed
automatically. On when ORBIT_RAZORPAY_KEY_ID and ORBIT_RAZORPAY_KEY_SECRET are set.

1. The server makes an order at Razorpay for the pack's price (in rupees, as packs are priced; a card from abroad
   is charged in rupees and its bank converts), and keeps it as a Payment ("razorpay", awaiting payment).
2. The page opens Razorpay's checkout for that order. When it's paid, the checkout hands back the payment id and a
   signature, HMAC-SHA256(order_id|payment_id) with the key secret, which only Razorpay can make; the server checks
   it and adds the pack's credits.
3. If the page was closed before that, Razorpay's webhook (`payment.captured` / `order.paid`, signed with the
   webhook secret) does the same. Whichever comes first credits it; the other finds it done.
"""

import hashlib
import hmac

import httpx

from orbit_api.config import get_settings

API = "https://api.razorpay.com/v1"
TIMEOUT_S = 15.0
# Tests swap in an httpx.MockTransport: nothing in the suite reaches Razorpay.
transport: httpx.AsyncBaseTransport | None = None


class RazorpayError(Exception):
    pass


def configured() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


async def create_order(amount_inr: int, receipt: str, notes: dict[str, str]) -> str:
    """A Razorpay order for `amount_inr` rupees; returns its id ("order_…")."""
    s = get_settings()
    if not (s.razorpay_key_id and s.razorpay_key_secret):
        raise RazorpayError("Razorpay isn't set up")
    async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport) as http:
        try:
            r = await http.post(f"{API}/orders", auth=(s.razorpay_key_id, s.razorpay_key_secret.get_secret_value()),
                                json={"amount": amount_inr * 100, "currency": "INR", "receipt": receipt[:40],
                                      "notes": notes})
        except httpx.HTTPError as e:
            raise RazorpayError(f"couldn't reach Razorpay: {type(e).__name__}") from e
    if r.status_code != 200:
        raise RazorpayError(f"Razorpay said {r.status_code}")
    data = r.json()
    order_id = data.get("id") if isinstance(data, dict) else None
    if not isinstance(order_id, str) or not order_id.startswith("order_"):
        raise RazorpayError("Razorpay sent no order id")
    return order_id


def _hmac(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def checkout_signature_ok(order_id: str, payment_id: str, signature: str) -> bool:
    """The checkout's proof that this order was paid with this payment."""
    secret = get_settings().razorpay_key_secret
    if secret is None or not (order_id and payment_id and signature):
        return False
    expected = _hmac(secret.get_secret_value(), f"{order_id}|{payment_id}".encode())
    return hmac.compare_digest(expected, signature)


def webhook_signature_ok(body: bytes, signature: str | None) -> bool:
    """A webhook really from Razorpay: X-Razorpay-Signature is HMAC-SHA256 of the raw body with the webhook secret."""
    secret = get_settings().razorpay_webhook_secret
    if secret is None or not signature:
        return False
    return hmac.compare_digest(_hmac(secret.get_secret_value(), body), signature)
