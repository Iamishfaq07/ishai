"""The public pricing page's price lists (GET /v1/billing/packs and /v1/billing/monthly with `?currency=`): the same
packs and plans in rupees or in US dollars, for anyone to read, at list price and never buyable from there. Without
the parameter nothing changes: prices follow the buyer's country, with their first-purchase discount."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.test_credits import enforce  # noqa: F401  (the fixture gw needs)
from tests.test_payment_settlement import gw  # noqa: F401  (gw: the fixture)
from tests.test_referrals import _code, _join, refs  # noqa: F401  (refs: the fixture)

LISTS = ("/v1/billing/packs", "/v1/billing/monthly")


def _get(client: TestClient, path: str, headers: dict[str, str] | None = None, **params: str) -> Any:
    r = client.get(path, headers=headers or {}, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_lists_in_either_currency_are_for_reading_only(client: TestClient) -> None:
    for path in LISTS:
        usd = _get(client, path, currency="USD")
        inr = _get(client, path, currency="INR")
        assert usd and len(usd) == len(inr)
        assert all(i["currency"] == "USD" and i["price_text"].startswith("$") for i in usd)
        assert all(i["currency"] == "INR" and i["price_text"].startswith("₹") for i in inr)
        assert not any(i["buyable"] for i in usd + inr)  # nothing is bought from a currency picked on a page
        assert [i["id"] for i in usd] == [i["id"] for i in inr]
        assert client.get(path, params={"currency": "EUR"}).status_code == 422


def test_without_a_currency_the_lists_are_as_before(client: TestClient) -> None:
    for path in LISTS:
        plain = _get(client, path)
        assert all(i["currency"] == "INR" for i in plain)  # no country known: India, as before
        assert [i["price_text"] for i in plain] == [i["price_text"] for i in _get(client, path, currency="INR")]


@pytest.mark.usefixtures("refs")
def test_a_discount_is_never_shown_on_the_list_in_a_currency(client: TestClient) -> None:
    a, _ = _join(client, None)
    b, _ = _join(client, _code(client, a))  # a referred account: 10% off its first purchase
    india = {**b, "X-Orbit-Client-Country": "IN"}
    assert any("offer_price" in i for i in _get(client, "/v1/billing/packs", india))
    for currency in ("INR", "USD"):
        assert not any("offer_price" in i for i in _get(client, "/v1/billing/packs", india, currency=currency))
