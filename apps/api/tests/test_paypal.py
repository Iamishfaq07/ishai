"""PayPal for buyers outside India (orbit_api/billing/paypal.py): an order there for the dollar price, the buyer's
return capturing it, the webhook and the reconciler finishing what the return didn't, and credits added exactly once
and only for PayPal's COMPLETED capture of the right amount. A fake PayPal (httpx.MockTransport) plays the API."""

import json
import re
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from orbit_api.billing import paypal
from orbit_api.config import get_settings
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401  (the fixture)
from tests.test_payment_settlement import _payment, _reconcile

GOOD_SIG = "good-sig"


def _issue(issue: str) -> httpx.Response:
    return httpx.Response(422, json={"name": "UNPROCESSABLE_ENTITY", "message": "The requested action could not be "
                                     "performed.", "details": [{"issue": issue}]})


def _order_json(order_id: str, order: dict[str, Any]) -> dict[str, Any]:
    return {"id": order_id, "status": order["status"],
            "purchase_units": [{"reference_id": order["unit"]["reference_id"],
                                "payments": {"captures": order["captures"]}}]}


@pytest.fixture
def pp(enforce: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "paypal_client_id", "pp-client")
    monkeypatch.setattr(s, "paypal_client_secret", SecretStr("pp-secret"))
    monkeypatch.setattr(s, "paypal_webhook_id", "WH-ORBIT")
    monkeypatch.setattr(s, "paypal_env", "sandbox")
    monkeypatch.setattr(paypal, "_token", None)
    state: dict[str, Any] = {"orders": {}, "sent": [], "tokens": 0, "capture_status": "COMPLETED",
                             "capture_value": None, "decline": False}

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api-m.sandbox.paypal.com"
        path = request.url.path
        state["sent"].append(request)
        if path == "/v1/oauth2/token":
            state["tokens"] += 1
            assert request.headers["authorization"].startswith("Basic ")
            return httpx.Response(200, json={"access_token": "A21-token", "expires_in": 32400})
        assert request.headers["authorization"] == "Bearer A21-token"
        if path == "/v1/notifications/verify-webhook-signature":
            body = json.loads(request.content)
            ok = (body["transmission_sig"] == GOOD_SIG and body["webhook_id"] == "WH-ORBIT"
                  and isinstance(body["webhook_event"], dict))
            return httpx.Response(200, json={"verification_status": "SUCCESS" if ok else "FAILURE"})
        if path == "/v2/checkout/orders" and request.method == "POST":
            unit = json.loads(request.content)["purchase_units"][0]
            order_id = uuid.uuid4().hex[:17].upper()
            state["orders"][order_id] = {"status": "PAYER_ACTION_REQUIRED", "unit": unit, "captures": []}
            return httpx.Response(201, json={"id": order_id, "status": "PAYER_ACTION_REQUIRED", "links": [
                {"href": f"https://api-m.sandbox.paypal.com/v2/checkout/orders/{order_id}", "rel": "self"},
                {"href": f"https://www.sandbox.paypal.com/checkoutnow?token={order_id}", "rel": "payer-action"}]})
        m = re.fullmatch(r"/v2/checkout/orders/([A-Z0-9]+)(/capture)?", path)
        assert m, path
        order = state["orders"].get(m.group(1))
        if order is None:
            return httpx.Response(404, json={"name": "RESOURCE_NOT_FOUND"})
        if m.group(2):
            if order["status"] == "COMPLETED":
                return _issue("ORDER_ALREADY_CAPTURED")
            if order["status"] != "APPROVED":
                return _issue("ORDER_NOT_APPROVED")
            if state["decline"]:
                return _issue("INSTRUMENT_DECLINED")
            amount = dict(order["unit"]["amount"])
            if state["capture_value"]:
                amount["value"] = state["capture_value"]
            order["captures"] = [{"id": f"CAP{m.group(1)[:14]}", "status": state["capture_status"], "amount": amount,
                                  "custom_id": order["unit"]["custom_id"], "final_capture": True}]
            order["status"] = "COMPLETED"
            return httpx.Response(201, json=_order_json(m.group(1), order))
        return httpx.Response(200, json=_order_json(m.group(1), order))

    monkeypatch.setattr(paypal, "transport", httpx.MockTransport(handle))
    yield state


def _abroad(client: TestClient) -> dict[str, str]:
    return {**_signup(client, _new_ip()), "X-Orbit-Client-Country": "US"}


def _start(client: TestClient, h: dict[str, str], pack: str = "starter") -> dict[str, Any]:
    r = client.post("/v1/billing/paypal/orders", headers=h, json={"pack": pack})
    assert r.status_code == 201, r.text
    return dict(r.json())


def _capture(client: TestClient, h: dict[str, str], order_id: str) -> httpx.Response:
    return client.post("/v1/billing/paypal/capture", headers=h, json={"order_id": order_id})


def _hook(client: TestClient, kind: str, resource: dict[str, Any], sig: str = GOOD_SIG,
          event_id: str | None = None) -> httpx.Response:
    body = json.dumps({"id": event_id or f"WH-{uuid.uuid4().hex[:16]}", "event_type": kind,
                       "resource": resource}).encode()
    return client.post("/v1/billing/paypal/webhook", content=body, headers={
        "Content-Type": "application/json", "PAYPAL-AUTH-ALGO": "SHA256withRSA",
        "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
        "PAYPAL-TRANSMISSION-ID": "t-1", "PAYPAL-TRANSMISSION-SIG": sig,
        "PAYPAL-TRANSMISSION-TIME": "2026-10-16T18:00:00Z"})


def test_buyers_abroad_pay_by_paypal_and_are_credited_once_on_their_return(
        client: TestClient, pp: dict[str, Any]) -> None:
    us, india = {"X-Orbit-Client-Country": "US"}, {"X-Orbit-Client-Country": "IN"}
    from tests.test_credits import PROXY

    starter = next(p for p in client.get("/v1/billing/packs", headers={**us, "X-Orbit-Proxy-Secret": PROXY}).json()
                   if p["id"] == "starter")
    assert (starter["checkout"], starter["buyable"], starter["price_text"]) == ("paypal", True, "$53.99")
    month = client.get("/v1/billing/monthly", headers={**us, "X-Orbit-Proxy-Secret": PROXY}).json()[0]
    assert month["checkout"] == "paypal" and month["buyable"]
    rupees = client.get("/v1/billing/packs", headers={**india, "X-Orbit-Proxy-Secret": PROXY}).json()[0]
    assert rupees["currency"] == "INR" and rupees["checkout"] != "paypal" and rupees["international"] is True

    h = _abroad(client)
    before = _wallet(client, h)
    o = _start(client, h)
    assert o["approve_url"] == f"https://www.sandbox.paypal.com/checkoutnow?token={o['order_id']}"
    made = next(r for r in pp["sent"] if r.url.path == "/v2/checkout/orders")
    unit = json.loads(made.content)["purchase_units"][0]
    reference = _payment(client, o["order_id"]).reference
    assert unit["amount"] == {"currency_code": "USD", "value": "53.99"}
    assert unit["invoice_id"] == unit["custom_id"] == reference  # PayPal won't take a second order for it
    ctx = json.loads(made.content)["payment_source"]["paypal"]["experience_context"]
    assert ctx["return_url"].endswith("/billing?paypal=return") and ctx["shipping_preference"] == "NO_SHIPPING"
    assert ctx["cancel_url"].endswith("/billing?paypal=cancel&pack=starter")  # backing out reopens this cart
    assert made.headers["paypal-request-id"] == f"order-{reference}"

    # Back before approving (or by hand): nothing is taken and nothing is added.
    early = _capture(client, h, o["order_id"])
    assert early.status_code == 200 and early.json()["status"] == "awaiting_payment"
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    done = _capture(client, h, o["order_id"])
    assert done.status_code == 200 and done.json()["status"] == "approved", done.text
    assert (done.json()["method"], done.json()["amount_text"]) == ("paypal", "$53.99")
    assert _wallet(client, h)["resume"] == before["resume"] + 30
    again = _capture(client, h, o["order_id"])  # a reload of the return page
    assert again.json()["status"] == "approved" and _wallet(client, h)["resume"] == before["resume"] + 30
    assert pp["tokens"] == 1  # one OAuth token for every call
    stranger = _abroad(client)
    assert _capture(client, stranger, o["order_id"]).status_code == 404


def test_paypal_is_for_buyers_abroad_and_only_once_it_is_set_up(
        client: TestClient, pp: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    india = {**_signup(client, _new_ip()), "X-Orbit-Client-Country": "IN"}
    r = client.post("/v1/billing/paypal/orders", headers=india, json={"pack": "starter"})
    assert r.status_code == 409 and not any(x.url.path == "/v2/checkout/orders" for x in pp["sent"])
    monkeypatch.setattr(get_settings(), "paypal_client_secret", None)
    r = client.post("/v1/billing/paypal/orders", headers=_abroad(client), json={"pack": "starter"})
    assert r.status_code == 503


def test_a_capture_of_the_wrong_amount_is_never_credited(client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    before = _wallet(client, h)
    o = _start(client, h)
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    pp["capture_value"] = "1.00"
    r = _capture(client, h, o["order_id"])
    assert r.status_code == 200 and r.json()["status"] != "approved"
    assert _wallet(client, h)["resume"] == before["resume"]


def test_a_declined_card_says_so_and_charges_nothing(client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    o = _start(client, h)
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    pp["decline"] = True
    r = _capture(client, h, o["order_id"])
    assert r.status_code == 409 and "nothing was charged" in r.json()["detail"]


def test_a_pending_capture_waits_for_paypals_webhook_and_is_credited_once(
        client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    before = _wallet(client, h)
    o = _start(client, h)
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    pp["capture_status"] = "PENDING"
    assert _capture(client, h, o["order_id"]).json()["status"] == "processing"
    assert _wallet(client, h)["resume"] == before["resume"]

    capture = {**pp["orders"][o["order_id"]]["captures"][0], "status": "COMPLETED",
               "supplementary_data": {"related_ids": {"order_id": o["order_id"]}}}
    assert _hook(client, "PAYMENT.CAPTURE.COMPLETED", capture, sig="forged").status_code == 400
    assert _wallet(client, h)["resume"] == before["resume"]
    assert _hook(client, "PAYMENT.CAPTURE.COMPLETED", capture, event_id="WH-PENDING-1").status_code == 200
    assert _wallet(client, h)["resume"] == before["resume"] + 30
    assert _hook(client, "PAYMENT.CAPTURE.COMPLETED", capture, event_id="WH-PENDING-1").status_code == 200
    assert _hook(client, "PAYMENT.CAPTURE.COMPLETED", capture).status_code == 200  # a different event, same capture
    assert _wallet(client, h)["resume"] == before["resume"] + 30


def test_an_approved_order_never_brought_back_is_captured_by_the_webhook(
        client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    before = _wallet(client, h)
    o = _start(client, h)
    pp["orders"][o["order_id"]]["status"] = "APPROVED"  # the buyer approved, then closed the tab
    assert _hook(client, "CHECKOUT.ORDER.APPROVED", {"id": o["order_id"], "status": "APPROVED"}).status_code == 200
    assert pp["orders"][o["order_id"]]["status"] == "COMPLETED"
    assert _wallet(client, h)["resume"] == before["resume"] + 30
    assert _capture(client, h, o["order_id"]).json()["status"] == "approved"  # their late return changes nothing
    assert _wallet(client, h)["resume"] == before["resume"] + 30


def test_the_reconciler_captures_an_approved_order_and_leaves_unapproved_ones(
        client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    before = _wallet(client, h)
    approved, waiting = _start(client, h), _start(client, h, "mini")
    pp["orders"][approved["order_id"]]["status"] = "APPROVED"
    # (Other tests' PayPal orders in the shared DB are unknown to this fake PayPal: counted as errors, untouched.)
    assert _reconcile(client)["credited"] >= 1
    assert _payment(client, approved["order_id"]).status == "approved"
    assert _payment(client, waiting["order_id"]).status == "awaiting_payment"
    assert _wallet(client, h)["resume"] == before["resume"] + 30


def test_a_paypal_refund_is_recorded_and_the_credits_kept(client: TestClient, pp: dict[str, Any]) -> None:
    h = _abroad(client)
    o = _start(client, h)
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    assert _capture(client, h, o["order_id"]).json()["status"] == "approved"
    after = _wallet(client, h)
    capture_id = pp["orders"][o["order_id"]]["captures"][0]["id"]
    refund = {"id": "RF7Y1234567890ABC", "status": "COMPLETED", "amount": {"currency_code": "USD", "value": "10.00"},
              "links": [{"rel": "up", "href": f"https://api.sandbox.paypal.com/v2/payments/captures/{capture_id}"}]}
    assert _hook(client, "PAYMENT.CAPTURE.REFUNDED", refund).status_code == 200
    p = _payment(client, o["order_id"])
    assert p.refunded_paise == 1000 and p.note.startswith("PayPal refunded $10.00 of $53.99")
    assert _wallet(client, h)["resume"] == after["resume"]


def test_only_paypal_pages_are_followed_and_amounts_are_exact() -> None:
    assert paypal._paypal_page("https://www.sandbox.paypal.com/checkoutnow?token=X")
    assert paypal._paypal_page("https://www.paypal.com/checkoutnow?token=X")
    for bad in ("http://www.paypal.com/x", "https://paypal.com.evil.example/x", "https://evilpaypal.com/x",
                "javascript:alert(1)"):
        assert not paypal._paypal_page(bad), bad
    assert paypal.cents({"currency_code": "USD", "value": "53.99"}) == 5399
    assert paypal.cents({"value": "53.995"}) is None and paypal.cents({"value": "x"}) is None
    assert paypal.money(5399) == "53.99" and paypal.money(100) == "1.00"


def test_outside_india_both_paypal_and_a_card_are_offered_paypal_first(
        client: TestClient, pp: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.billing import razorpay
    from tests.test_credits import PROXY

    s = get_settings()
    monkeypatch.setattr(s, "razorpay_key_id", "rzp_test_key")
    monkeypatch.setattr(s, "razorpay_key_secret", SecretStr("rzp-secret"))
    monkeypatch.setattr(s, "razorpay_international", True)

    def card(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        return httpx.Response(200, json={"id": f"order_{uuid.uuid4().hex[:14]}", "amount": body["amount"],
                                         "currency": body["currency"], "status": "created"})

    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(card))
    us = {**_signup(client, _new_ip()), "X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-Country": "US"}
    pack = next(p for p in client.get("/v1/billing/packs", headers=us).json() if p["id"] == "mini")
    assert (pack["currency"], pack["checkout"], pack["methods"]) == ("USD", "paypal", ["paypal", "razorpay"])
    q = client.get("/v1/billing/quote", headers=us, params={"pack": "mini"}).json()
    assert (q["checkout"], q["methods"]) == ("paypal", ["paypal", "razorpay"])
    # Either way works: a card through Razorpay is a USD order there.
    o = client.post("/v1/billing/razorpay/orders", headers=us, json={"pack": "mini"})
    assert o.status_code == 201 and o.json()["currency"] == "USD"
    # Razorpay without cards from abroad: PayPal alone.
    monkeypatch.setattr(s, "razorpay_international", False)
    again = next(p for p in client.get("/v1/billing/packs", headers=us).json() if p["id"] == "mini")
    assert again["methods"] == ["paypal"]
    # In India: Razorpay alone, never PayPal.
    india = {**us, "X-Orbit-Client-Country": "IN"}
    inr = next(p for p in client.get("/v1/billing/packs", headers=india).json() if p["id"] == "mini")
    assert (inr["currency"], inr["methods"]) == ("INR", ["razorpay"])
    # The pricing page's read-only list sells nothing.
    shown = next(p for p in client.get("/v1/billing/packs", params={"currency": "USD"}).json() if p["id"] == "mini")
    assert shown["methods"] == [] and shown["buyable"] is False
