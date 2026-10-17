"""Monthly plans (billing/monthly.py): a plan for 30 days bought once through the pack checkout, extended by buying
again, metered per 30-day period, and back to Free (credits intact) when it runs out."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.billing import monthly
from orbit_api.config import get_settings
from orbit_api.entitlements import period_start
from tests.test_signup_approval import _client, _outbox
from tests.test_signup_approval import _register as _register_named


def _pay(client: TestClient, h: dict[str, str], admin: dict[str, str], product: str) -> dict[str, Any]:
    o = client.post("/v1/billing/upi/orders", headers=h, json={"pack": product})
    assert o.status_code == 201, o.text
    oid = o.json()["id"]
    utr = f"{uuid.uuid4().int % 10**12:012d}"
    assert client.post(f"/v1/billing/upi/orders/{oid}/utr", headers=h, json={"utr": utr}).status_code == 200
    ok = client.post(f"/v1/admin/payments/{oid}", headers=admin, json={"action": "approve"})
    assert ok.status_code == 200, ok.text
    return dict(o.json())


def test_monthly_plans_are_listed_with_what_a_month_includes(client: TestClient) -> None:
    plans = {p["id"]: p for p in client.get("/v1/billing/monthly").json()}
    assert list(plans) == ["premium_weekly", "premium_monthly", "premium_yearly"]
    week, month, year = plans.values()
    assert (week["label"], week["price_inr"], week["days"]) == ("Weekly", 3499, 7)
    assert (month["label"], month["price_inr"], month["days"], month["plan"], month["badge"]) == (
        "Monthly", 6599, 30, "premium", "Most popular")
    assert (year["price_inr"], year["days"], year["per_month_inr"], year["badge"]) == (26499, 365, 2178, "Best value")
    # About 30% under Parakeet AI's rupee prices, ₹4,980 / ₹9,470 / ₹37,900 (checked 2026-10-18: D60).
    for plan, theirs in ((week, 4980), (month, 9470), (year, 37900)):
        assert theirs * 0.69 <= plan["price_inr"] <= theirs * 0.71
    assert month["resume_ai"] is True and month["live_minutes"] == 3000 and month["screenshots"] is None


def test_buying_a_month_gives_the_plan_and_buying_more_extends_it(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Ishfaq")
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, _user = _register_named(client, f"m-{uuid.uuid4().hex[:8]}@example.com")
        assert client.get("/v1/entitlements", headers=h).json()["plan"] == "free"

        o = _pay(client, h, admin, "premium_monthly")
        assert (o["label"], o["amount_inr"], o["resume_credits"], o["interview_minutes"]) == (
            "Monthly plan · 30 days", 6599, 0, 0)
        e = client.get("/v1/entitlements", headers=h).json()
        assert e["plan"] == "premium" and e["credits"] is None and e["features"]["resume_ai"] is True
        until = datetime.fromisoformat(e["until"])
        assert timedelta(days=29, hours=23) < until - datetime.now(UTC) <= timedelta(days=30)
        assert e["limits"]["live_minutes"] == 3000
        assert client.get("/v1/resumes/allowance", headers=h).json()["unlimited"] is True
        mail = next(m for m in reversed(_outbox().sent) if m.subject.startswith("Payment received"))
        assert "the Monthly plan (30 days)" in mail.subject and "Nothing renews" in mail.text

        # A year bought while the month runs starts where the month ends (it's the same plan).
        _pay(client, h, admin, "premium_yearly")
        later = datetime.fromisoformat(client.get("/v1/entitlements", headers=h).json()["until"])
        assert later - until == timedelta(days=365)
        assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "nope"}).status_code == 422
    finally:
        gen.close()


def test_a_paid_month_is_metered_in_30_day_periods() -> None:
    now = datetime(2026, 10, 28, 12, tzinfo=UTC)
    paid = SimpleNamespace(grant_plan="basic", grant_until=now + timedelta(days=30))
    assert period_start(paid, now) == now  # bought just now: its period starts now, not on 1 October
    two = SimpleNamespace(grant_plan="basic", grant_until=now + timedelta(days=45))  # bought twice, 15 days in
    assert period_start(two, now) == now - timedelta(days=15)
    assert period_start(None, now) == datetime(2026, 10, 1, tzinfo=UTC)  # no plan: the calendar month
    over = SimpleNamespace(grant_plan="basic", grant_until=now - timedelta(days=1))
    assert period_start(over, now) == datetime(2026, 10, 1, tzinfo=UTC)


def test_bad_monthly_plans_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    for bad in ([{"id": "x", "label": "X", "price_inr": 100, "plan": "free"}],
                [{"id": "starter", "label": "X", "price_inr": 100, "plan": "pro"}],  # a pack's id
                [{"id": "x", "label": "X", "price_inr": 0, "plan": "pro"}], {"id": "x"}):
        monkeypatch.setattr(s, "monthly_plans_json", json.dumps(bad))
        with pytest.raises(ValueError):
            monthly.monthly_plans()
    monkeypatch.setattr(s, "monthly_plans_json", "[]")
    assert monthly.monthly_plans() == {}
