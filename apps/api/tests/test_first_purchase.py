"""FIRST10 is explicit, server-priced, never stacked, and redeemable on only one first order."""
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from tests.test_credits import enforce  # noqa: F401
from tests.test_payment_settlement import (  # noqa: F401
    Gateway,
    _captured,
    _payment,
    _post,
    gw,
)
from tests.test_paypal import _abroad, pp  # noqa: F401
from tests.test_referrals import _admin, _join, _pay, refs  # noqa: F401


@pytest.fixture
def offer(refs: Gateway, monkeypatch: pytest.MonkeyPatch) -> Gateway:  # noqa: F811
    monkeypatch.setattr(get_settings(), "first_purchase_percent", 10)
    return refs


def quote(client: TestClient, headers: dict[str, str], pack: str = "mini", code: str | None = None):
    return client.get("/v1/billing/quote", headers=headers, params={"pack": pack, **({"code": code} if code else {})})


def order(client: TestClient, headers: dict[str, str], code: str | None = "FIRST10", pack: str = "mini"):
    return client.post("/v1/billing/razorpay/orders", headers=headers,
                       json={"pack": pack, **({"code": code} if code else {})})


def test_only_explicit_first10_discounts_and_payment_consumes_it(client: TestClient, offer: Gateway) -> None:
    headers, _ = _join(client, None)
    assert quote(client, headers).json()["total_text"] == "₹499"
    priced = quote(client, headers, code=" first10 ").json()
    assert (priced["discount_percent"], priced["total_text"], priced["coupons"]) == (10, "₹449", True)
    started = order(client, headers)
    assert started.status_code == 201, started.text
    identity = started.json()["order_id"]
    # Reopening the same checkout never issues another discounted gateway order.
    assert order(client, headers).json()["order_id"] == identity
    assert order(client, headers, pack="starter").status_code == 409
    assert quote(client, headers, code="FIRST10").json()["total_text"] == "₹449"
    assert _post(client, _captured(offer, identity, offer.pay(identity))).status_code == 200
    assert _payment(client, identity).discount_minor == 5000
    assert quote(client, headers, code="FIRST10").status_code == 422
    assert order(client, headers).status_code == 422
    assert quote(client, headers).json()["coupons"] is False
    assert _payment(client, _pay(client, offer, headers)).amount_inr == 499


def test_unknown_and_referral_codes_cannot_replace_or_stack(client: TestClient, offer: Gateway) -> None:
    headers, _ = _join(client, None)
    code = "BIG" + uuid.uuid4().hex[:6].upper()
    created = client.post("/v1/admin/referrals/codes", headers=_admin(client), json={
        "code": code, "label": "Campus", "kind": "campus", "discount_percent": 25})
    assert created.status_code == 201
    for invalid in (code, "FIRST20", "FIRST 10", ""):
        assert order(client, headers, code=invalid or " ").status_code == 422
        assert quote(client, headers, code=invalid or " ").status_code == 422
    assert client.post("/v1/referrals/redeem", headers=headers, json={"code": code}).status_code == 422
    assert quote(client, headers).json()["discount_percent"] == 0


def test_offer_works_without_referrals_and_for_monthly_plans(client: TestClient, offer: Gateway,
                                                           monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "referrals", False)
    headers, _ = _join(client, None)
    plans = client.get("/v1/billing/monthly", headers=headers).json()
    response = quote(client, headers, pack=plans[0]["id"], code="FIRST10")
    assert response.status_code == 200, response.text
    assert response.json()["discount_percent"] == 10 and response.json()["kind"] == "plan"
    assert client.get("/v1/billing/promotion").json() == {"enabled": True, "code": "FIRST10", "percent": 10}


def test_paid_without_discount_is_ineligible(client: TestClient, offer: Gateway) -> None:
    headers, _ = _join(client, None)
    _pay(client, offer, headers)
    assert quote(client, headers, code="FIRST10").status_code == 422
    assert order(client, headers).status_code == 422


def test_paypal_uses_explicit_code_on_the_dollar_price(client: TestClient, pp: dict[str, Any],  # noqa: F811
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "first_purchase_percent", 10)
    headers = _abroad(client)
    priced = quote(client, headers, pack="starter", code="FIRST10").json()
    assert (priced["currency"], priced["total_text"]) == ("USD", "$48.59")
    result = client.post("/v1/billing/paypal/orders", headers=headers, json={"pack": "starter", "code": "FIRST10"})
    assert result.status_code == 201, result.text
    assert pp["orders"][result.json()["order_id"]]["unit"]["amount"] == {"currency_code": "USD", "value": "48.59"}
    assert client.post("/v1/billing/paypal/orders", headers=headers,
                       json={"pack": "mini", "code": "FIRST10"}).status_code == 409


def test_concurrent_first10_requests_reuse_one_order(client: TestClient, offer: Gateway) -> None:
    from concurrent.futures import ThreadPoolExecutor

    headers, _ = _join(client, None)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: order(client, headers), range(2)))
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json()["order_id"] == results[1].json()["order_id"]


def test_upi_reuses_only_the_same_upi_order(client: TestClient, offer: Gateway,
                                           monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upi_id", "orbit@upi")
    headers, _ = _join(client, None)
    first = client.post("/v1/billing/upi/orders", headers=headers, json={"pack": "mini", "code": "FIRST10"})
    assert first.status_code == 201, first.text
    second = client.post("/v1/billing/upi/orders", headers=headers, json={"pack": "mini", "code": "FIRST10"})
    assert second.json()["id"] == first.json()["id"]
    assert first.json()["amount_inr"] == 449
    assert order(client, headers).status_code == 409


def test_old_and_rejected_upi_orders_do_not_issue_another_discount(client: TestClient, offer: Gateway,
                                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from orbit_api.models import Payment
    from tests.business_helpers import db_call

    monkeypatch.setattr(get_settings(), "upi_id", "orbit@upi")
    headers, _ = _join(client, None)
    first = client.post("/v1/billing/upi/orders", headers=headers, json={"pack": "mini", "code": "FIRST10"})
    identity = first.json()["id"]

    async def reject(db):
        await db.execute(update(Payment).where(Payment.id == identity).values(status="rejected",
            created_at=datetime.now(UTC) - timedelta(days=3)))
    db_call(client, reject)
    retry = client.post("/v1/billing/upi/orders", headers=headers, json={"pack": "mini", "code": "FIRST10"})
    assert retry.status_code == 201 and retry.json()["id"] == identity
    assert order(client, headers, pack="starter").status_code == 409
