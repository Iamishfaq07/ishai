"""PayPal (Orders v2, https://developer.paypal.com/docs/api/orders/v2/): how buyers outside India pay their dollar
prices. On when ORBIT_PAYPAL_CLIENT_ID and ORBIT_PAYPAL_CLIENT_SECRET are set. PayPal India accounts take payments
from abroad only, which is exactly who is sent here (billing/pricing.py: rupees in India go through Razorpay).

1. The server makes a PayPal order for the price (USD) and keeps it as a Payment ("paypal", awaiting payment); the
   page sends the buyer to PayPal's approval link.
2. PayPal sends them back to /billing?paypal=return&token=<order id>. The server captures the order and credits it
   only when PayPal says that capture COMPLETED for exactly the order's amount and currency: never the browser's
   word.
3. A buyer who approved and closed the tab before coming back: PayPal's webhook (CHECKOUT.ORDER.APPROVED, checked
   with PayPal's verify-webhook-signature) or the reconciler (billing/settle.py) captures it. A capture still
   PENDING at PayPal is credited when PAYMENT.CAPTURE.COMPLETED arrives, or when the reconciler sees it.
"""

import json
import time
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlsplit

import httpx

from orbit_api.config import get_settings

API = {"sandbox": "https://api-m.sandbox.paypal.com", "live": "https://api-m.paypal.com"}
TIMEOUT_S = 15.0
# Tests swap in an httpx.MockTransport: nothing in the suite reaches PayPal.
transport: httpx.AsyncBaseTransport | None = None
# The OAuth token, cached until a minute before PayPal says it expires: (token, expires at, for which client id).
_token: tuple[str, float, str] | None = None
WEBHOOK_HEADERS = {"auth_algo": "paypal-auth-algo", "cert_url": "paypal-cert-url",
                   "transmission_id": "paypal-transmission-id", "transmission_sig": "paypal-transmission-sig",
                   "transmission_time": "paypal-transmission-time"}


class PayPalError(Exception):
    def __init__(self, message: str, issue: str | None = None) -> None:
        super().__init__(message)
        self.issue = issue  # PayPal's reason code, e.g. "ORDER_ALREADY_CAPTURED", "INSTRUMENT_DECLINED"


def configured() -> bool:
    s = get_settings()
    return bool(s.paypal_client_id and s.paypal_client_secret)


def _base() -> str:
    return API[get_settings().paypal_env]


def cents(amount: object) -> int | None:
    """PayPal's {"currency_code": "USD", "value": "53.99"} → 5399; None if it isn't a two-decimal amount."""
    value = amount.get("value") if isinstance(amount, dict) else None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    minor = d * 100
    return int(minor) if minor == minor.to_integral_value() and minor >= 0 else None


def money(minor: int) -> str:
    return f"{minor // 100}.{minor % 100:02d}"


def _list(d: object, key: str) -> list[Any]:
    v = d.get(key) if isinstance(d, dict) else None
    return v if isinstance(v, list) else []


def _dict(d: object, key: str) -> dict[str, Any]:
    v = d.get(key) if isinstance(d, dict) else None
    return v if isinstance(v, dict) else {}


def _why(r: httpx.Response) -> tuple[str, str | None]:
    """PayPal's reason for a refusal, for the log, and its issue code; never holds the credentials."""
    try:
        data = r.json()
    except ValueError:
        return "", None
    if not isinstance(data, dict):
        return "", None
    issue = next((str(d.get("issue")) for d in _list(data, "details") if isinstance(d, dict) and d.get("issue")), None)
    why = str(data.get("message") or data.get("error_description") or data.get("name") or "")[:200]
    if r.status_code == 401:
        why += " (check ORBIT_PAYPAL_CLIENT_ID, ORBIT_PAYPAL_CLIENT_SECRET and ORBIT_PAYPAL_ENV: one app, same mode)"
    return (f": {issue or ''} {why}".rstrip() if why or issue else ""), issue


async def _access_token(http: httpx.AsyncClient) -> str:
    global _token
    s = get_settings()
    if not (s.paypal_client_id and s.paypal_client_secret):
        raise PayPalError("PayPal isn't set up")
    if _token is not None and _token[2] == s.paypal_client_id and _token[1] > time.monotonic():
        return _token[0]
    try:
        r = await http.post(f"{_base()}/v1/oauth2/token", data={"grant_type": "client_credentials"},
                            auth=(s.paypal_client_id, s.paypal_client_secret.get_secret_value()))
    except httpx.HTTPError as e:
        raise PayPalError(f"couldn't reach PayPal: {type(e).__name__}") from e
    if r.status_code != 200:
        why, issue = _why(r)
        raise PayPalError(f"PayPal refused the sign-in ({r.status_code}){why}", issue)
    data = r.json()
    token = data.get("access_token") if isinstance(data, dict) else None
    if not isinstance(token, str) or not token:
        raise PayPalError("PayPal sent no access token")
    life = data.get("expires_in")
    _token = (token, time.monotonic() + max(60.0, float(life if isinstance(life, int | float) else 3600) - 60),
              s.paypal_client_id)
    return token


async def _call(method: str, path: str, *, json_body: Any = None, content: bytes | None = None,
                request_id: str | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport) as http:
        headers = {"Authorization": f"Bearer {await _access_token(http)}", "Content-Type": "application/json"}
        if request_id:
            headers["PayPal-Request-Id"] = request_id  # a retried create or capture does it once
        try:
            r = await http.request(method, f"{_base()}{path}", headers=headers, json=json_body, content=content)
        except httpx.HTTPError as e:
            raise PayPalError(f"couldn't reach PayPal: {type(e).__name__}") from e
    if r.status_code not in (200, 201):
        why, issue = _why(r)
        raise PayPalError(f"PayPal said {r.status_code}{why}", issue)
    data = r.json()
    if not isinstance(data, dict):
        raise PayPalError("PayPal sent nothing usable")
    return data


async def create_order(amount_minor: int, currency: str, reference: str, label: str,
                       request_id: str) -> tuple[str, str]:
    """A PayPal order for `amount_minor` cents; returns (its id, the link that sends the buyer to approve it).
    `reference` is our Payment.reference: PayPal refuses a second order with the same invoice id, so one Orbit order
    can't be paid twice."""
    web = get_settings().web_url.rstrip("/")
    order = await _call("POST", "/v2/checkout/orders", request_id=request_id, json_body={
        "intent": "CAPTURE",
        "purchase_units": [{"reference_id": reference, "custom_id": reference, "invoice_id": reference,
                            "description": label[:127],
                            "amount": {"currency_code": currency, "value": money(amount_minor)}}],
        "payment_source": {"paypal": {"experience_context": {
            "brand_name": "Orbit", "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING",
            "return_url": f"{web}/billing?paypal=return", "cancel_url": f"{web}/billing?paypal=cancel"}}},
    })
    order_id = order.get("id")
    approve = approval_url(order)
    if not isinstance(order_id, str) or not order_id or approve is None:
        raise PayPalError("PayPal sent no order id or approval link")
    return order_id, approve


def _paypal_page(url: str) -> bool:
    """The browser is sent here, so only an https page of PayPal's own (www.paypal.com, www.sandbox.paypal.com)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "paypal.com" or host.endswith(".paypal.com"))


async def capture_order(order_id: str, request_id: str) -> dict[str, Any]:
    """Takes the money for an approved order; returns the order as PayPal has it after (its captures inside)."""
    return await _call("POST", f"/v2/checkout/orders/{_safe(order_id)}/capture", content=b"{}",
                       request_id=request_id)


async def get_order(order_id: str) -> dict[str, Any]:
    """The order as PayPal has it now: status (CREATED, APPROVED, COMPLETED…) and any captures."""
    return await _call("GET", f"/v2/checkout/orders/{_safe(order_id)}")


def _safe(order_id: str) -> str:
    if not (order_id and order_id.isalnum() and len(order_id) <= 40):
        raise PayPalError("not a PayPal order id")
    return order_id


def captures(order: dict[str, Any]) -> list[dict[str, Any]]:
    """Every capture in an order PayPal sent back (one, for ours)."""
    out: list[dict[str, Any]] = []
    for unit in _list(order, "purchase_units"):
        out += [c for c in _list(_dict(unit, "payments"), "captures") if isinstance(c, dict)]
    return out


def capture_order_id(capture: dict[str, Any]) -> str | None:
    """The order a capture belongs to (a webhook's capture names it in supplementary_data)."""
    order_id = _dict(_dict(capture, "supplementary_data"), "related_ids").get("order_id")
    return str(order_id)[:40] if order_id else None


def refund_capture_id(refund: dict[str, Any]) -> str | None:
    """The capture a refund (or reversal) was taken from: its "up" link ends in /captures/<id>."""
    for link in _list(refund, "links"):
        if not isinstance(link, dict):
            continue
        href = str(link.get("href", ""))
        if link.get("rel") == "up" and "/captures/" in href:
            return href.rstrip("/").rsplit("/", 1)[-1][:40] or None
    return None


async def webhook_ok(headers: Any, raw: bytes) -> bool:
    """A webhook really from PayPal for our app: PayPal's verify-webhook-signature says SUCCESS. The event is sent
    back byte for byte as it came (re-encoding it can change what was signed)."""
    webhook_id = get_settings().paypal_webhook_id
    if not (configured() and webhook_id):
        return False
    fields = {name: headers.get(header) for name, header in WEBHOOK_HEADERS.items()}
    if not all(fields.values()):
        return False
    try:
        json.loads(raw)
    except ValueError:
        return False
    head = json.dumps({**fields, "webhook_id": webhook_id})
    body = head[:-1].encode() + b', "webhook_event": ' + raw + b"}"
    try:
        result = await _call("POST", "/v1/notifications/verify-webhook-signature", content=body)
    except PayPalError:
        return False
    return result.get("verification_status") == "SUCCESS"


def approval_url(order: dict[str, Any]) -> str | None:
    return next((str(x.get("href")) for x in _list(order, "links") if isinstance(x, dict)
                    and x.get("rel") in ("payer-action", "approve") and _paypal_page(str(x.get("href", "")))), None)
