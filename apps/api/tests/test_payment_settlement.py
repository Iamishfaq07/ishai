"""Razorpay settlement (V3-07, V3-08, V3-09, billing/settle.py): webhook events recorded once, refunds as their own
rows (also when they arrive before the capture), and the reconciler crediting a captured payment whose webhook and
checkout answer were both lost. A pack's credits are added once, whichever way the news comes, however often."""

import asyncio
import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from orbit_api.billing import razorpay
from orbit_api.config import get_settings
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401  (the fixture)

KEY_SECRET = "rzp_test_secret"
HOOK_SECRET = "rzp_hook_secret"
MINI = 49_900  # paise
MINI_CREDITS = 25  # the "AI credits" pack (id "mini")


class Gateway:
    """A stand-in for Razorpay's API: orders made, and the payments each order has (set by the test)."""

    def __init__(self) -> None:
        self.orders: dict[str, int] = {}
        self.payments: dict[str, dict[str, Any]] = {}
        self.down = False
        self.calls: list[str] = []

    def pay(self, order_id: str, status: str = "captured", amount: int | None = None,
            currency: str = "INR") -> str:
        pay_id = f"pay_{uuid.uuid4().hex[:14]}"
        self.payments[pay_id] = {"id": pay_id, "order_id": order_id, "status": status, "currency": currency,
                                 "amount": self.orders[order_id] if amount is None else amount}
        return pay_id

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(f"{request.method} {request.url.path}")
        if self.down:
            raise httpx.ConnectTimeout("gateway timeout")
        path = request.url.path
        if request.method == "POST" and path.endswith("/orders"):
            amount = int(json.loads(request.content)["amount"])
            order_id = f"order_{uuid.uuid4().hex[:14]}"
            self.orders[order_id] = amount
            return httpx.Response(200, json={"id": order_id, "amount": amount, "currency": "INR"})
        if path.startswith("/v1/orders/") and path.endswith("/payments"):
            order_id = path.split("/")[3]
            return httpx.Response(200, json={"items": [p for p in self.payments.values()
                                                       if p["order_id"] == order_id]})
        if path.startswith("/v1/payments/"):
            found = self.payments.get(path.rsplit("/", 1)[-1])
            return httpx.Response(200, json=found) if found else httpx.Response(404, json={})
        return httpx.Response(404, json={})


@pytest.fixture
def gw(enforce: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[Gateway]:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "razorpay_key_id", "rzp_test_key")
    monkeypatch.setattr(s, "razorpay_key_secret", SecretStr(KEY_SECRET))
    monkeypatch.setattr(s, "razorpay_webhook_secret", SecretStr(HOOK_SECRET))
    g = Gateway()
    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(g.handle))
    yield g


def _sign(order_id: str, payment_id: str) -> str:
    return hmac.new(KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _body(event: str, entity: dict[str, Any], kind: str = "payment") -> bytes:
    return json.dumps({"event": event, "payload": {kind: {"entity": entity}}}).encode()


def _post(client: TestClient, body: bytes, event_id: str | None = None, secret: str = HOOK_SECRET) -> httpx.Response:
    headers = {"X-Razorpay-Signature": hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(),
               "Content-Type": "application/json"}
    if event_id:
        headers["X-Razorpay-Event-Id"] = event_id
    return client.post("/v1/billing/webhook", content=body, headers=headers)


def _captured(gw: Gateway, order_id: str, pay_id: str) -> bytes:
    return _body("payment.captured", gw.payments[pay_id])


def _refund(refund_id: str, pay_id: str, amount: int, status: str = "processed") -> bytes:
    return _body(f"refund.{status}", {"id": refund_id, "payment_id": pay_id, "amount": amount, "currency": "INR",
                                      "status": status}, kind="refund")


def _order(client: TestClient, h: dict[str, str], pack: str = "mini") -> str:
    r = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": pack})
    assert r.status_code == 201, r.text
    return str(r.json()["order_id"])


def _db(client: TestClient, fn: Any) -> Any:
    from orbit_api.db import sessionmaker

    async def go() -> Any:
        async with sessionmaker()() as db:
            return await fn(db)

    return client.portal.call(go)  # type: ignore[union-attr]


def _payment(client: TestClient, order_id: str) -> Any:
    from orbit_api.models import Payment

    return _db(client, lambda db: db.scalar(select(Payment).where(Payment.gateway_order_id == order_id)))


def _reconcile(client: TestClient, later: timedelta = timedelta(minutes=5)) -> dict[str, int]:
    from orbit_api.billing.settle import reconcile

    return _db(client, lambda db: reconcile(db, now=datetime.now(UTC) + later))  # type: ignore[no-any-return]


def _purchases(client: TestClient, user_id: str) -> int:
    from sqlalchemy import func

    from orbit_api.models import CreditEntry

    # One pack is one "resume" grant (and one for its minutes): count the packs by their resume grants.
    return _db(client, lambda db: db.scalar(select(func.count()).select_from(CreditEntry).where(  # type: ignore[no-any-return]
        CreditEntry.user_id == user_id, CreditEntry.reason == "purchase", CreditEntry.kind == "resume")))


def _me(client: TestClient, h: dict[str, str]) -> str:
    return str(client.get("/v1/auth/me", headers=h).json()["id"])


# ---- webhook events ----------------------------------------------------------------------------------------------


def test_a_redelivered_event_is_applied_once(client: TestClient, gw: Gateway) -> None:
    from orbit_api.models import PaymentEvent

    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    body = _captured(gw, order, pay)
    for _ in range(3):
        assert _post(client, body, event_id="evt_same_1").status_code == 200
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS
    rows = _db(client, lambda db: db.scalars(select(PaymentEvent).where(PaymentEvent.event_id == "evt_same_1")))
    events = list(rows.all())
    assert len(events) == 1 and events[0].status == "processed" and events[0].attempts == 1
    # Only ids, amounts and statuses are kept.
    assert set(events[0].data["payment"]) <= {"id", "order_id", "payment_id", "amount", "currency", "status"}


def test_concurrent_deliveries_credit_once(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    user_id = _me(client, h)
    order = _order(client, h)
    pay = gw.pay(order)
    bodies = [(_captured(gw, order, pay), f"evt_c{i}") for i in range(3)] + \
             [(_body("order.paid", gw.payments[pay]), f"evt_o{i}") for i in range(3)]

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            replies = await asyncio.gather(*[
                http.post("/v1/billing/webhook", content=b, headers={
                    "X-Razorpay-Signature": hmac.new(HOOK_SECRET.encode(), b, hashlib.sha256).hexdigest(),
                    "X-Razorpay-Event-Id": eid, "Content-Type": "application/json"})
                for b, eid in bodies])
        return [r.status_code for r in replies]

    codes = client.portal.call(burst)  # type: ignore[union-attr]
    assert all(c == 200 for c in codes), codes
    assert _purchases(client, user_id) == 1  # one pack: its resume credits (and its minutes) once


def test_a_forged_or_mismatched_event_changes_nothing(client: TestClient, gw: Gateway) -> None:
    from orbit_api.models import PaymentEvent

    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    assert _post(client, _captured(gw, order, pay), "evt_forged", secret="forged").status_code == 400
    assert _db(client, lambda db: db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == "evt_forged"))) \
        is None
    wrong_amount = {**gw.payments[pay], "amount": 100}
    wrong_currency = {**gw.payments[pay], "currency": "USD"}
    assert _post(client, _body("payment.captured", wrong_amount), "evt_amt").status_code == 200
    assert _post(client, _body("payment.captured", wrong_currency), "evt_cur").status_code == 200
    assert _wallet(client, h)["resume"] == before
    assert _payment(client, order).status == "awaiting_payment"


def test_an_event_that_fails_is_retried_on_redelivery(client: TestClient, gw: Gateway,
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.billing import settle
    from orbit_api.models import PaymentEvent

    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    real = settle.credit

    async def broken(*a: Any, **k: Any) -> Any:
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(settle, "credit", broken)
    assert _post(client, _captured(gw, order, pay), "evt_retry").status_code == 500  # Razorpay will send it again
    row = _db(client, lambda db: db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == "evt_retry")))
    assert row.status == "error" and "database hiccup" in row.error
    monkeypatch.setattr(settle, "credit", real)
    assert _post(client, _captured(gw, order, pay), "evt_retry").status_code == 200
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS


# ---- refunds -----------------------------------------------------------------------------------------------------


def test_partial_then_full_refund_is_recorded_once_each(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    assert _post(client, _captured(gw, order, pay), "evt_cap").status_code == 200
    for _ in range(2):  # each refund delivered twice
        assert _post(client, _refund("rfnd_P1", pay, 20_000), "evt_r1").status_code == 200
    p = _payment(client, order)
    assert p.refunded_paise == 20_000 and "₹200 of ₹499" in p.note
    for _ in range(2):
        assert _post(client, _refund("rfnd_P2", pay, 29_900)).status_code == 200
    p = _payment(client, order)
    assert p.refunded_paise == MINI
    assert p.note == "Razorpay refunded ₹499 (rfnd_P1, rfnd_P2). Credits were not removed."
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS  # the published policy: credits are kept
    shown = client.get("/v1/billing/upi/orders", headers=h).json()[0]
    assert shown["refunded_inr"] == 499


def test_a_failed_refund_is_kept_but_not_counted(client: TestClient, gw: Gateway) -> None:
    from orbit_api.models import PaymentRefund

    h = _signup(client, _new_ip())
    order = _order(client, h)
    pay = gw.pay(order)
    assert _post(client, _captured(gw, order, pay)).status_code == 200
    assert _post(client, _refund("rfnd_F1", pay, MINI, status="failed")).status_code == 200
    assert _payment(client, order).refunded_paise == 0
    row = _db(client, lambda db: db.scalar(select(PaymentRefund).where(PaymentRefund.refund_id == "rfnd_F1")))
    assert row.status == "failed" and row.payment_id is not None


def test_a_refund_before_its_capture_is_linked_when_the_capture_lands(client: TestClient, gw: Gateway) -> None:
    from orbit_api.models import PaymentEvent, PaymentRefund

    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    assert _post(client, _refund("rfnd_E1", pay, MINI), "evt_early").status_code == 200
    early = _db(client, lambda db: db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == "evt_early")))
    assert early.status == "unmatched"
    row = _db(client, lambda db: db.scalar(select(PaymentRefund).where(PaymentRefund.refund_id == "rfnd_E1")))
    assert row.payment_id is None and row.gateway_payment_id == pay
    assert _post(client, _captured(gw, order, pay), "evt_late").status_code == 200
    p = _payment(client, order)
    assert p.status == "approved" and p.refunded_paise == MINI
    row = _db(client, lambda db: db.scalar(select(PaymentRefund).where(PaymentRefund.refund_id == "rfnd_E1")))
    assert row.payment_id == p.id and row.linked_at is not None
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS


def test_a_payment_for_a_deleted_account_is_recorded_without_credits(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    order = _order(client, h)
    pay = gw.pay(order)
    gone = client.request("DELETE", "/v1/auth/me", headers=h, json={"password": "correct horse battery"})
    assert gone.status_code == 204, gone.text
    assert _post(client, _captured(gw, order, pay)).status_code == 200
    p = _payment(client, order)
    assert p.status == "approved" and p.user_id is None


# ---- reconciliation ----------------------------------------------------------------------------------------------


def test_a_lost_webhook_and_closed_page_are_reconciled(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    user_id = _me(client, h)
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    gw.pay(order, status="failed")  # a first attempt that failed
    pay = gw.pay(order)  # the second, captured; neither the checkout nor the webhook told us
    assert _wallet(client, h)["resume"] == before
    counts = _reconcile(client)
    assert counts["credited"] == 1
    assert _payment(client, order).gateway_payment_id == pay
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS
    assert _reconcile(client, timedelta(hours=2))["credited"] == 0
    assert _purchases(client, user_id) == 1


def test_delayed_capture_after_verify_is_credited_once(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    user_id = _me(client, h)
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order, status="authorized")
    held = client.post("/v1/billing/razorpay/verify", headers=h,
                       json={"order_id": order, "payment_id": pay, "signature": _sign(order, pay)})
    assert held.status_code == 200 and held.json()["status"] == "processing"
    assert _reconcile(client)["credited"] == 0  # still authorized
    gw.payments[pay]["status"] = "captured"
    assert _reconcile(client, timedelta(hours=1))["credited"] == 1
    # The webhook arriving afterwards adds nothing.
    assert _post(client, _captured(gw, order, pay)).status_code == 200
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS
    assert _purchases(client, user_id) == 1


def test_a_gateway_timeout_at_verify_leaves_it_processing(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    pay = gw.pay(order)
    gw.down = True
    held = client.post("/v1/billing/razorpay/verify", headers=h,
                       json={"order_id": order, "payment_id": pay, "signature": _sign(order, pay)})
    assert held.status_code == 200 and held.json()["status"] == "processing"
    assert _wallet(client, h)["resume"] == before
    assert _reconcile(client)["errors"] >= 1  # still down: counted, nothing credited
    gw.down = False
    assert _reconcile(client, timedelta(hours=1))["credited"] == 1
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS


def test_two_orders_are_each_matched_by_their_own_order(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    first, second = _order(client, h, "mini"), _order(client, h, "starter")
    gw.pay(second)  # only the second was paid
    assert _reconcile(client)["credited"] == 1
    assert _payment(client, first).status == "awaiting_payment"
    assert _payment(client, second).status == "approved"
    assert _wallet(client, h)["resume"] == before + 30  # the starter pack (3 credits)


def test_checks_back_off_and_unpaid_orders_expire(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    order = _order(client, h)
    assert _reconcile(client)["checked"] >= 1
    calls = len(gw.calls)
    _reconcile(client, timedelta(minutes=5, seconds=30))  # 30 s after the first check: not due yet
    assert len([c for c in gw.calls[calls:] if order in c]) == 0
    _reconcile(client, timedelta(hours=73))
    assert _payment(client, order).status == "expired"
    assert client.get("/v1/billing/upi/orders", headers=h).json() == []  # nothing to show for it


def test_verify_says_so_when_the_bank_failed_it(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    order = _order(client, h)
    pay = gw.pay(order, status="failed")
    r = client.post("/v1/billing/razorpay/verify", headers=h,
                    json={"order_id": order, "payment_id": pay, "signature": _sign(order, pay)})
    assert r.status_code == 409 and "nothing was charged" in r.json()["detail"]
    assert _payment(client, order).status == "awaiting_payment"


def test_a_capture_on_an_expired_order_is_still_credited(client: TestClient, gw: Gateway) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    order = _order(client, h)
    _reconcile(client, timedelta(hours=73))
    assert _payment(client, order).status == "expired"
    pay = gw.pay(order)  # the tab was left open for days, then paid
    assert _post(client, _captured(gw, order, pay)).status_code == 200
    assert _payment(client, order).status == "approved"
    assert _wallet(client, h)["resume"] == before + MINI_CREDITS


def test_an_order_opened_at_the_old_price_settles_after_a_price_cut(client: TestClient, gw: Gateway,
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    """An order is settled by the amount stored on it, never by today's price list: one opened before the rupee cut
    (D60) and paid at its old price is credited by the webhook or by the reconciler after the cut, once."""
    from orbit_api.billing.packs import packs

    old = [{"id": "starter", "label": "3 credits", "price_inr": 3599, "resume_credits": 30, "interview_minutes": 180}]
    monkeypatch.setattr(get_settings(), "credit_packs_json", json.dumps(old))
    h = _signup(client, _new_ip())
    user_id = _me(client, h)
    before = _wallet(client, h)
    by_webhook, by_reconciler, underpaid = (_order(client, h, "starter") for _ in range(3))
    assert gw.orders[by_webhook] == 359_900
    monkeypatch.setattr(get_settings(), "credit_packs_json", None)  # the cut: the default packs, starter ₹2,599
    assert packs()["starter"].price_inr == 2599
    pay = gw.pay(by_webhook)  # paid at the price the order was made at
    assert _post(client, _captured(gw, by_webhook, pay)).status_code == 200
    gw.pay(by_reconciler)  # its checkout answer and webhook both lost
    gw.pay(underpaid, amount=259_900)  # today's price against an old order is not a capture of it
    counts = _reconcile(client)
    assert counts["credited"] == 1
    for order in (by_webhook, by_reconciler):
        p = _payment(client, order)
        assert (p.status, p.amount_inr, p.resume_credits, p.interview_minutes) == ("approved", 3599, 30, 180)
    assert _payment(client, underpaid).status == "awaiting_payment"
    after = _wallet(client, h)
    assert after["resume"] == before["resume"] + 60
    assert after["interview_minutes_left"] == before["interview_minutes_left"] + 360
    assert _post(client, _captured(gw, by_webhook, pay)).status_code == 200  # a redelivery adds nothing
    assert _purchases(client, user_id) == 2
