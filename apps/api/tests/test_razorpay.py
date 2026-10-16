"""Credit packs through Razorpay (orbit_api/billing/razorpay.py): an order made there, the checkout's signed answer
or the webhook confirming it, and the pack's credits added exactly once."""

import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from orbit_api.billing import razorpay
from orbit_api.config import get_settings
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401  (the fixture)

KEY_SECRET = "rzp_test_secret"
HOOK_SECRET = "rzp_hook_secret"


@pytest.fixture
def rzp(enforce: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[list[httpx.Request]]:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "razorpay_key_id", "rzp_test_key")
    monkeypatch.setattr(s, "razorpay_key_secret", SecretStr(KEY_SECRET))
    monkeypatch.setattr(s, "razorpay_webhook_secret", SecretStr(HOOK_SECRET))
    seen: list[httpx.Request] = []
    orders: list[tuple[str, int, str]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET" and "/payments/" in request.url.path:
            pay_id = request.url.path.rsplit("/", 1)[-1]
            order_id, amount, currency = orders[-1]
            return httpx.Response(200, json={"id": pay_id, "order_id": order_id, "amount": amount,
                                             "currency": currency, "status": "captured"})
        body = json.loads(request.content)
        order_id = f"order_{uuid.uuid4().hex[:14]}"
        orders.append((order_id, int(body["amount"]), str(body["currency"])))
        return httpx.Response(200, json={"id": order_id, "amount": body["amount"],
                                         "currency": body["currency"], "status": "created"})

    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(handle))
    yield seen


def _sign(order_id: str, payment_id: str) -> str:
    return hmac.new(KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _hook(client: TestClient, event: str, order_id: str, payment_id: str, amount: int,
          secret: str = HOOK_SECRET) -> httpx.Response:
    body = json.dumps({"event": event, "payload": {"payment": {"entity": {
        "id": payment_id, "order_id": order_id, "amount": amount, "currency": "INR", "status": "captured"}}}}).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return client.post("/v1/billing/webhook", content=body,
                       headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"})


def test_packs_say_how_they_are_bought(client: TestClient, rzp: list[httpx.Request],
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    packs = client.get("/v1/billing/packs").json()
    assert all(p["buyable"] and p["checkout"] == "razorpay" and not p["international"] for p in packs)
    monkeypatch.setattr(get_settings(), "razorpay_international", True)
    assert all(p["international"] for p in client.get("/v1/billing/packs").json())


def test_a_paid_checkout_adds_the_pack_once(client: TestClient, rzp: list[httpx.Request]) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)
    r = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "starter"})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["key_id"] == "rzp_test_key" and o["amount_paise"] == 359_900 and o["currency"] == "INR"
    assert o["label"] == "3 interview credits" and o["order_id"].startswith("order_")
    sent = rzp[0]
    assert str(sent.url) == "https://api.razorpay.com/v1/orders" and sent.headers["authorization"].startswith("Basic ")
    assert json.loads(sent.content)["amount"] == 359_900
    # Not shown on the billing page until it's paid.
    assert client.get("/v1/billing/upi/orders", headers=h).json() == []

    bad = client.post("/v1/billing/razorpay/verify", headers=h,
                      json={"order_id": o["order_id"], "payment_id": "pay_X1", "signature": "nope"})
    assert bad.status_code == 400
    ok = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_X1", "signature": _sign(o["order_id"], "pay_X1")})
    assert ok.status_code == 200 and ok.json()["status"] == "approved" and ok.json()["method"] == "razorpay"
    after = _wallet(client, h)
    assert after["resume"] == before["resume"] + 30
    # The webhook arriving afterwards, and the checkout answering twice, add nothing more.
    assert _hook(client, "payment.captured", o["order_id"], "pay_X1", 359_900).status_code == 200
    again = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_X1", "signature": _sign(o["order_id"], "pay_X1")})
    assert again.status_code == 200 and _wallet(client, h) == after
    assert [x["status"] for x in client.get("/v1/billing/upi/orders", headers=h).json()] == ["approved"]


def test_an_authorized_payment_does_not_add_credits(client: TestClient, rzp: list[httpx.Request],
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    o = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "starter"}).json()

    def authorized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "pay_auth", "order_id": o["order_id"], "amount": 359_900,
                                         "currency": "INR", "status": "authorized"})

    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(authorized))
    held = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_auth", "signature": _sign(o["order_id"], "pay_auth")})
    # Not captured: nothing is added, and the order shows as processing (V3-09), not as an error.
    assert held.status_code == 200 and held.json()["status"] == "processing"
    assert _wallet(client, h)["resume"] == before
    assert [x["status"] for x in client.get("/v1/billing/upi/orders", headers=h).json()] == ["processing"]
    # An authorized webhook must not grant either.
    body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_auth", "order_id": o["order_id"], "amount": 359_900, "currency": "INR",
        "status": "authorized"}}}}).encode()
    sig = hmac.new(HOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    assert client.post("/v1/billing/webhook", content=body,
                       headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"}).status_code == 200
    assert _wallet(client, h)["resume"] == before


def _signed(client: TestClient, event: dict[str, Any]) -> httpx.Response:
    body = json.dumps(event).encode()
    sig = hmac.new(HOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return client.post("/v1/billing/webhook", content=body,
                       headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"})


def test_a_refund_is_recorded_and_credits_stay(client: TestClient, rzp: list[httpx.Request]) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    o = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).json()
    assert _hook(client, "payment.captured", o["order_id"], "pay_R1", 49_900).status_code == 200
    assert _wallet(client, h)["resume"] == before + 25
    refund = {"event": "refund.processed", "payload": {"refund": {"entity": {
        "id": "rfnd_R1", "payment_id": "pay_R1", "amount": 49_900, "currency": "INR"}}}}
    assert _signed(client, refund).json() == {"ok": True}
    assert _signed(client, refund).json() == {"ok": True}
    assert _wallet(client, h)["resume"] == before + 25
    note = client.get("/v1/billing/upi/orders", headers=h).json()[0]["note"]
    assert note == "Razorpay refunded ₹499 (rfnd_R1). Credits were not removed."


def test_the_webhook_confirms_a_payment_whose_page_closed(client: TestClient, rzp: list[httpx.Request]) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)["resume"]
    o = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).json()
    assert _hook(client, "payment.captured", o["order_id"], "pay_W1", 49_900, secret="forged").status_code == 400
    assert _hook(client, "payment.captured", o["order_id"], "pay_W1", 100).status_code == 200  # wrong amount
    assert _wallet(client, h)["resume"] == before
    assert _hook(client, "payment.failed", o["order_id"], "pay_W1", 49_900).status_code == 200
    assert _wallet(client, h)["resume"] == before
    assert _hook(client, "order.paid", o["order_id"], "pay_W1", 49_900).status_code == 200
    assert _wallet(client, h)["resume"] == before + 25
    assert _hook(client, "payment.captured", o["order_id"], "pay_W1", 49_900).status_code == 200
    assert _wallet(client, h)["resume"] == before + 25


def test_someone_elses_order_and_setup_problems(client: TestClient, rzp: list[httpx.Request],
                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    h, other = _signup(client, _new_ip()), _signup(client, _new_ip())
    o = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).json()
    theirs = client.post("/v1/billing/razorpay/verify", headers=other, json={
        "order_id": o["order_id"], "payment_id": "pay_Z", "signature": _sign(o["order_id"], "pay_Z")})
    assert theirs.status_code == 404
    assert client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "gold"}).status_code == 422

    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"description": "server error"}})

    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(down))
    assert client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).status_code == 503
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", None)
    assert client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).status_code == 503
    assert client.get("/v1/billing/packs").json()[0]["checkout"] in ("upi", None)


async def test_a_refused_key_says_why_in_the_log(monkeypatch: pytest.MonkeyPatch) -> None:
    def refused(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"code": "BAD_REQUEST_ERROR",
                                                   "description": "Authentication failed"}})

    monkeypatch.setattr(get_settings(), "razorpay_key_id", "rzp_live_key")
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", SecretStr(KEY_SECRET))
    monkeypatch.setattr(razorpay, "transport", httpx.MockTransport(refused))
    with pytest.raises(razorpay.RazorpayError) as e:
        await razorpay.create_order(99, "ORB1", {})
    assert "401: Authentication failed" in str(e.value) and "same Test/Live mode" in str(e.value)
    assert KEY_SECRET not in str(e.value)


def test_pasted_keys_lose_stray_spaces(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import Settings

    monkeypatch.setenv("ORBIT_RAZORPAY_KEY_ID", " rzp_live_abc\n")
    monkeypatch.setenv("ORBIT_RAZORPAY_KEY_SECRET", "secret \n")
    monkeypatch.setenv("ORBIT_RAZORPAY_WEBHOOK_SECRET", "  ")
    s = Settings()
    assert s.razorpay_key_id == "rzp_live_abc"
    assert s.razorpay_key_secret is not None and s.razorpay_key_secret.get_secret_value() == "secret"
    assert s.razorpay_webhook_secret is None


def test_the_migration_adds_and_removes_the_columns(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "rzp.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def columns() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute("pragma table_info(payments)")}

    alembic("upgrade", "head")
    assert {"method", "gateway_order_id", "gateway_payment_id"} <= columns()
    alembic("downgrade", "a6d8f0b2c4e5")
    assert "gateway_order_id" not in columns()
    alembic("upgrade", "head")


def test_outside_india_prices_and_charges_are_in_dollars_30_percent_higher(
        client: TestClient, rzp: list[httpx.Request], monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.billing import pricing
    from tests.test_credits import PROXY

    us = {"X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-Country": "US"}
    india = {"X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-Country": "IN"}
    starter_in = next(p for p in client.get("/v1/billing/packs", headers=india).json() if p["id"] == "starter")
    assert (starter_in["currency"], starter_in["price_text"]) == ("INR", "₹3,599")
    # ₹3,599 at ₹88 to the dollar is $40.90; 30% more is $53.17, shown as $53.99.
    starter_us = next(p for p in client.get("/v1/billing/packs", headers=us).json() if p["id"] == "starter")
    assert (starter_us["currency"], starter_us["price"], starter_us["price_text"]) == ("USD", 53.99, "$53.99")
    assert starter_us["buyable"] is False  # dollars need Razorpay's international payments switched on
    month = next(m for m in client.get("/v1/billing/monthly", headers=us).json() if m["id"] == "premium_monthly")
    assert month["price_text"] == "$135.99" and month["per_month_text"] == "$135.99"
    # A spoofed country without the proxy secret counts for nothing: rupees (the default).
    assert client.get("/v1/billing/packs", headers={"X-Orbit-Client-Country": "US"}).json()[0]["currency"] == "INR"
    for inr in (499, 2299, 3599, 7199, 10899, 4799, 9199, 35999):
        cents = pricing.usd_cents(inr)
        assert cents % 100 == 99 and cents / 100 >= inr / 88 * 1.3

    monkeypatch.setattr(get_settings(), "razorpay_international", True)
    assert next(p for p in client.get("/v1/billing/packs", headers=us).json() if p["id"] == "starter")["buyable"]
    h = {**_signup(client, _new_ip()), "X-Orbit-Client-Country": "US"}
    before = _wallet(client, h)
    o = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "starter"}).json()
    assert (o["amount_paise"], o["currency"]) == (5399, "USD")
    assert json.loads(rzp[-1].content)["currency"] == "USD"
    ok = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_U1", "signature": _sign(o["order_id"], "pay_U1")})
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert (ok.json()["currency"], ok.json()["amount_text"]) == ("USD", "$53.99")
    assert _wallet(client, h)["resume"] == before["resume"] + 30
    # UPI is rupees, for India only.
    upi = client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"})
    assert upi.status_code in (409, 503)
