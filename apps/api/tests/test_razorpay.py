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

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        return httpx.Response(200, json={"id": f"order_{uuid.uuid4().hex[:14]}", "amount": body["amount"],
                                         "currency": "INR", "status": "created"})

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


def test_packs_say_how_they_are_bought(client: TestClient, rzp: list[httpx.Request]) -> None:
    packs = client.get("/v1/billing/packs").json()
    assert all(p["buyable"] and p["checkout"] == "razorpay" for p in packs)


def test_a_paid_checkout_adds_the_pack_once(client: TestClient, rzp: list[httpx.Request]) -> None:
    h = _signup(client, _new_ip())
    before = _wallet(client, h)
    r = client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "starter"})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["key_id"] == "rzp_test_key" and o["amount_paise"] == 199_900 and o["currency"] == "INR"
    assert o["label"] == "Starter pack" and o["order_id"].startswith("order_")
    sent = rzp[0]
    assert str(sent.url) == "https://api.razorpay.com/v1/orders" and sent.headers["authorization"].startswith("Basic ")
    assert json.loads(sent.content)["amount"] == 199_900
    # Not shown on the billing page until it's paid.
    assert client.get("/v1/billing/upi/orders", headers=h).json() == []

    bad = client.post("/v1/billing/razorpay/verify", headers=h,
                      json={"order_id": o["order_id"], "payment_id": "pay_X1", "signature": "nope"})
    assert bad.status_code == 400
    ok = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_X1", "signature": _sign(o["order_id"], "pay_X1")})
    assert ok.status_code == 200 and ok.json()["status"] == "approved" and ok.json()["method"] == "razorpay"
    after = _wallet(client, h)
    assert after["resume"] == before["resume"] + 15
    # The webhook arriving afterwards, and the checkout answering twice, add nothing more.
    assert _hook(client, "payment.captured", o["order_id"], "pay_X1", 199_900).status_code == 200
    again = client.post("/v1/billing/razorpay/verify", headers=h, json={
        "order_id": o["order_id"], "payment_id": "pay_X1", "signature": _sign(o["order_id"], "pay_X1")})
    assert again.status_code == 200 and _wallet(client, h) == after
    assert [x["status"] for x in client.get("/v1/billing/upi/orders", headers=h).json()] == ["approved"]


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
    assert _wallet(client, h)["resume"] == before + 5
    assert _hook(client, "payment.captured", o["order_id"], "pay_W1", 49_900).status_code == 200
    assert _wallet(client, h)["resume"] == before + 5


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
