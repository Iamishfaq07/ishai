"""New payments go through Razorpay in India and PayPal abroad only: paying the UPI ID by hand (a QR, then a UTR)
is off unless ORBIT_MANUAL_UPI is on (the other suites switch it on to exercise orders already open that way)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401  (enforce: the fixture)
from tests.test_payment_settlement import Gateway, gw  # noqa: F401  (gw: the fixture)


def _packs(client: TestClient, h: dict[str, str]) -> list[dict[str, Any]]:
    return list(client.get("/v1/billing/packs", headers=h).json())


def test_by_default_packs_sell_through_razorpay_and_upi_by_hand_is_refused(
        client: TestClient, gw: Gateway, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "manual_upi", False)
    monkeypatch.setattr(s, "upi_id", "owner@okicici")
    h = _signup(client, _new_ip())
    assert {p["checkout"] for p in _packs(client, h)} == {"razorpay"}
    r = client.post("/v1/billing/upi/orders", headers=h, json={"pack": "mini"})
    assert r.status_code == 410 and "Razorpay" in r.json()["detail"]
    assert client.post("/v1/billing/razorpay/orders", headers=h, json={"pack": "mini"}).status_code == 201


def test_without_razorpay_nothing_is_buyable_rather_than_upi_by_hand(
        client: TestClient, enforce: None, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "manual_upi", False)
    monkeypatch.setattr(s, "upi_id", "owner@okicici")
    h = _signup(client, _new_ip())
    assert all(not p["buyable"] and p["checkout"] is None for p in _packs(client, h))
    assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "mini"}).status_code == 410
