"""UPI payments can't be credited twice: a UTR is ASCII digits only, a deleted account's payments (and their UTRs)
stay, a payment is decided once even when approved twice at the same moment, and a changed UTR isn't approved."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.billing.upi import normalize_utr
from orbit_api.db import sessionmaker
from orbit_api.models import CreditEntry, Payment
from tests.test_credits import _wallet
from tests.test_signup_approval import _client
from tests.test_signup_approval import _register as _register_named


def _utr() -> str:
    return f"{uuid.uuid4().int % 10**12:012d}"


def _paid_order(client: TestClient, h: dict[str, str], utr: str) -> dict[str, Any]:
    o = client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"}).json()
    r = client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": utr})
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_a_utr_is_twelve_ascii_digits() -> None:
    assert normalize_utr("1234 5678 9012") == "123456789012"
    assert normalize_utr("𝟏23456789012") is None  # a lookalike digit is not the same UTR
    assert normalize_utr("１２３４５６７８９０１２") is None  # full-width
    assert normalize_utr("12345678901") is None


@pytest.fixture
def shop(monkeypatch: pytest.MonkeyPatch) -> Any:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Ishfaq")
    client = next(gen)
    admin, _ = _register_named(client, admin_email)
    yield client, admin
    gen.close()


def test_a_deleted_accounts_utr_cant_be_used_again(shop: Any) -> None:
    client, admin = shop
    h, _ = _register_named(client, f"a-{uuid.uuid4().hex[:8]}@example.com")
    utr = _utr()
    o = _paid_order(client, h, utr)
    assert client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve"}).status_code == 200
    assert client.delete("/v1/auth/me", headers=h).status_code in (200, 204)
    # The payment is still on the books, without its account.
    rows = client.get("/v1/admin/payments?only=all", headers=admin).json()["payments"]
    kept = next(p for p in rows if p["id"] == o["id"])
    assert kept["user_id"] is None and kept["email"] == "(deleted account)" and kept["utr"] == utr
    # A new account can't claim the same transfer.
    h2, _ = _register_named(client, f"b-{uuid.uuid4().hex[:8]}@example.com")
    o2 = client.post("/v1/billing/upi/orders", headers=h2, json={"pack": "starter"}).json()
    assert client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=h2, json={"utr": utr}).status_code == 409


def test_a_payment_is_credited_once_and_only_with_the_utr_the_admin_checked(shop: Any) -> None:
    client, admin = shop
    h, _ = _register_named(client, f"c-{uuid.uuid4().hex[:8]}@example.com")
    o = _paid_order(client, h, _utr())
    # The payer corrects the UTR after the admin looked: the old one isn't approved.
    new_utr = _utr()
    assert client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": new_utr}).status_code == 200
    stale = client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve", "utr": o["utr"]})
    assert stale.status_code == 409
    ok = client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve", "utr": new_utr})
    assert ok.status_code == 200
    assert client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve"}).status_code == 409
    assert _wallet(client, h)["resume"] == 16  # welcome + one pack
    # And an approved order can't be given another UTR.
    assert client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": _utr()}).status_code == 409

    async def grants() -> int:
        async with sessionmaker()() as db:
            return len((await db.scalars(select(CreditEntry).where(CreditEntry.payment_id == o["id"]))).all())

    assert client.portal.call(grants) == 2  # one resume grant, one minutes grant


def test_the_database_refuses_a_second_grant_for_one_payment(shop: Any) -> None:
    client, _ = shop
    h, user = _register_named(client, f"d-{uuid.uuid4().hex[:8]}@example.com")
    o = _paid_order(client, h, _utr())

    async def double() -> str:
        from sqlalchemy.exc import IntegrityError

        async with sessionmaker()() as db:
            for _ in range(2):
                db.add(CreditEntry(user_id=user["id"], kind="resume", amount=15, reason="purchase",
                                   payment_id=o["id"]))
            try:
                await db.commit()
            except IntegrityError:
                return "refused"
            return "allowed"

    assert client.portal.call(double) == "refused"

    async def status() -> str:
        async with sessionmaker()() as db:
            p = await db.get(Payment, o["id"])
            assert p is not None
            return p.status

    assert client.portal.call(status) == "submitted"
