"""The first-purchase offer (ORBIT_FIRST_PURCHASE_PERCENT): every account's first purchase is that much off, with or
without a code; a code that gives more wins, and discounts never add up. The cart (GET /v1/billing/quote) says what
an order will charge, and the order charges it."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from tests.test_credits import enforce  # noqa: F401  (the fixture)
from tests.test_payment_settlement import Gateway, _payment, gw  # noqa: F401  (gw: the fixture)
from tests.test_paypal import _abroad, _start, pp  # noqa: F401  (pp: the fixture)
from tests.test_referrals import _admin, _join, _pay, refs  # noqa: F401  (refs: the fixture)


@pytest.fixture
def offer(refs: Gateway, monkeypatch: pytest.MonkeyPatch) -> Gateway:  # noqa: F811
    monkeypatch.setattr(get_settings(), "first_purchase_percent", 10)
    return refs


def _quote(client: TestClient, h: dict[str, str], pack: str = "mini") -> dict[str, Any]:
    r = client.get(f"/v1/billing/quote?pack={pack}", headers=h)
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_every_first_purchase_is_ten_percent_off_then_list_price(client: TestClient, offer: Gateway) -> None:
    h, _ = _join(client, None)
    q = _quote(client, h)
    assert (q["price_text"], q["discount_percent"], q["discount_text"], q["discount_reason"], q["total_text"]) == (
        "₹499", 10, "-₹50", "First purchase offer", "₹449")
    assert q["includes"] == ["25 AI credits", "Never expire"] and q["checkout"] == "razorpay" and q["coupons"]
    mini = next(p for p in client.get("/v1/billing/packs", headers=h).json() if p["id"] == "mini")
    assert (mini["offer_price_text"], mini["offer_percent"]) == ("₹449", 10)
    order = _pay(client, offer, h)
    assert (_payment(client, order).amount_inr, _payment(client, order).discount_minor) == (449, 5000)
    # Paid once: list price from now on, and no codes.
    again = _quote(client, h)
    assert (again["discount_percent"], again["total_text"], again["coupons"]) == (0, "₹499", False)
    assert _payment(client, _pay(client, offer, h)).amount_inr == 499


def test_a_bigger_code_wins_and_a_smaller_one_never_adds(client: TestClient, offer: Gateway) -> None:
    admin = _admin(client)
    tag = uuid.uuid4().hex[:5].upper()
    for name, percent in ((f"BIG{tag}", 25), (f"SMALL{tag}", 5)):
        r = client.post("/v1/admin/referrals/codes", headers=admin, json={
            "code": name, "label": "Campus", "kind": "campus", "discount_percent": percent})
        assert r.status_code == 201, r.text
    big, _ = _join(client, None)
    got = client.post("/v1/referrals/redeem", headers=big, json={"code": f"BIG{tag}"}).json()
    assert (got["kind"], got["percent"]) == ("campus", 25)
    q = _quote(client, big, "starter")
    assert (q["discount_percent"], q["discount_reason"]) == (25, f"Code BIG{tag} (Campus)")
    small, _ = _join(client, None)
    got = client.post("/v1/referrals/redeem", headers=small, json={"code": f"SMALL{tag}"}).json()
    assert (got["kind"], got["percent"], got["code"]) == ("first", 10, None)
    assert _quote(client, small)["discount_reason"] == "First purchase offer"


def test_with_the_offer_off_only_codes_discount(client: TestClient, refs: Gateway) -> None:  # noqa: F811
    h, _ = _join(client, None)
    q = _quote(client, h)
    assert (q["discount_percent"], q["discount_text"], q["total_text"]) == (0, "", "₹499")
    assert client.get("/v1/billing/quote?pack=nope", headers=h).status_code == 422
    assert client.get("/v1/billing/quote?pack=mini").status_code == 401


def test_a_plan_in_the_cart(client: TestClient, offer: Gateway) -> None:
    h, _ = _join(client, None)
    plans = client.get("/v1/billing/monthly", headers=h).json()
    q = _quote(client, h, plans[0]["id"])
    assert q["kind"] == "plan" and q["includes"][0].startswith(f"{plans[0]['days']} days of ")
    assert q["discount_percent"] == 10 and q["total_text"] == plans[0]["offer_price_text"]


def test_abroad_the_offer_comes_off_the_dollar_price_and_paypal_charges_it(
        client: TestClient, pp: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setattr(get_settings(), "first_purchase_percent", 10)
    h = _abroad(client)
    q = _quote(client, h, "starter")
    assert (q["currency"], q["price_text"], q["discount_text"], q["total_text"], q["checkout"]) == (
        "USD", "$53.99", "-$5.40", "$48.59", "paypal")
    order = _start(client, h)
    sent = pp["orders"][order["order_id"]]
    assert sent["unit"]["amount"] == {"currency_code": "USD", "value": "48.59"}
