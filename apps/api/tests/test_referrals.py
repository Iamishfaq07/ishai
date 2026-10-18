"""Referrals (orbit_api/billing/referrals.py): invite links and the admin's creator and campus codes. The discount
comes off the order on the server, in rupees and in dollars; the inviter's minutes are paid once, on the invited
account's first payment, however the news of it arrives (checkout, webhook, reconciler); self-invites are blocked,
rewards stop at the monthly cap, a refund takes back what the inviter hasn't used, expired and used-up codes are
refused in words, and a sign-up through Google keeps the link's code. Fakes play Razorpay and PayPal."""

import asyncio
import hashlib
import hmac
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from orbit_api.billing import pricing, referrals
from orbit_api.config import get_settings
from orbit_api.models import CreditEntry, Payment, Referral, ReferralCode, UsageEvent
from tests.test_credits import _ip, _new_ip, _wallet, enforce  # noqa: F401  (the fixture)
from tests.test_payment_settlement import (  # noqa: F401  (gw: the fixture)
    HOOK_SECRET,
    Gateway,
    _captured,
    _db,
    _order,
    _payment,
    _post,
    _refund,
    _sign,
    gw,
)
from tests.test_paypal import pp  # noqa: F401  (the fixture)

ADMIN = "growth-admin@example.com"
PASSWORD = "correct horse battery"


@pytest.fixture
def refs(gw: Gateway, monkeypatch: pytest.MonkeyPatch) -> Iterator[Gateway]:  # noqa: F811
    s = get_settings()
    monkeypatch.setattr(s, "referrals", True)
    monkeypatch.setattr(s, "admin_email", ADMIN)
    yield gw


def _join(client: TestClient, ref: str | None, ip: str | None = None,
          email: str | None = None) -> tuple[dict[str, str], str]:
    """A new account (from its own network unless `ip` says otherwise), signed up with a link's code."""
    ip = ip or _new_ip()
    body: dict[str, Any] = {"email": email or f"r-{uuid.uuid4().hex[:10]}@example.com", "password": PASSWORD}
    if ref:
        body["ref"] = ref
    r = client.post("/v1/auth/register", headers=_ip(ip), json=body)
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return _ip(ip, {"Authorization": f"Bearer {r.json()['access_token']}"}), str(r.json()["user"]["id"])


def _admin(client: TestClient) -> dict[str, str]:
    r = client.post("/v1/auth/register", headers=_ip(_new_ip()), json={"email": ADMIN, "password": PASSWORD})
    if r.status_code == 409:
        r = client.post("/v1/auth/login", headers=_ip(_new_ip()), json={"email": ADMIN, "password": PASSWORD})
    assert r.status_code in (200, 201), r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _code(client: TestClient, h: dict[str, str]) -> str:
    r = client.get("/v1/referrals/me", headers=h)
    assert r.status_code == 200, r.text
    return str(r.json()["code"])


def _minutes(client: TestClient, h: dict[str, str]) -> float:
    return float(_wallet(client, h)["interview_minutes_left"])


def _referral(client: TestClient, user_id: str) -> Any:
    return _db(client, lambda db: db.scalar(select(Referral).where(Referral.user_id == user_id)))


def _rewards(client: TestClient, user_id: str, reason: str = referrals.REWARD) -> int:
    return int(_db(client, lambda db: db.scalar(select(func.count()).select_from(CreditEntry).where(
        CreditEntry.user_id == user_id, CreditEntry.reason == reason))))


def _listed(client: TestClient, h: dict[str, str], pack: str = "starter") -> dict[str, Any]:
    return next(p for p in client.get("/v1/billing/packs", headers=h).json() if p["id"] == pack)


def _pay(client: TestClient, gw: Gateway, h: dict[str, str], pack: str = "mini") -> str:  # noqa: F811
    """Buys `pack` through Razorpay: the order, the capture, the webhook. Returns Razorpay's order id."""
    order = _order(client, h, pack)
    assert _post(client, _captured(gw, order, gw.pay(order))).status_code == 200
    assert _payment(client, order).status == "approved"
    return order


# ---- the discount -----------------------------------------------------------------------------------------------


def test_the_discount_maths_in_rupees_and_dollars() -> None:
    inr, usd = pricing.INR, pricing.USD
    # Whole rupees and whole cents, rounded down: never less than the percent off.
    assert referrals.discounted(pricing.Price(inr, 259_900, 2599), 10) == (pricing.Price(inr, 233_900, 2339), 26_000)
    assert referrals.discounted(pricing.Price(inr, 49_900, 499), 10) == (pricing.Price(inr, 44_900, 449), 5_000)
    assert referrals.discounted(pricing.Price(inr, 164_900, 1649), 15)[0].text() == "₹1,401"
    dollars, off = referrals.discounted(pricing.Price(usd, 5399, 4751), 10)
    assert (dollars.minor, dollars.text(), off, dollars.inr) == (4859, "$48.59", 540, round(48.59 * 88))
    assert referrals.discounted(pricing.Price(usd, 799, 703), 10)[0].text() == "$7.19"
    same = pricing.Price(inr, 259_900, 2599)
    assert referrals.discounted(same, 0) == (same, 0)


def test_the_discount_comes_off_the_order_on_the_server(client: TestClient, refs: Gateway,
                                                        pp: dict[str, Any]) -> None:  # noqa: F811
    a, a_id = _join(client, None)
    code = _code(client, a)
    b, b_id = _join(client, code)
    india = {**b, "X-Orbit-Client-Country": "IN"}
    listed = _listed(client, india)
    full = pricing.Price(pricing.INR, round(listed["price"] * 100), listed["price_inr"])
    less, off = referrals.discounted(full, 10)
    assert (listed["offer_percent"], listed["offer_price_text"], listed["price_text"]) == (10, less.text(), full.text())
    assert "offer_price" not in _listed(client, a)  # the inviter has no discount of their own
    year = max(client.get("/v1/billing/monthly", headers=india).json(), key=lambda m: m["days"])
    year_less, _ = referrals.discounted(pricing.Price(pricing.INR, round(year["price"] * 100), year["price_inr"]), 10)
    # A long plan's monthly equivalent is of what it costs this buyer.
    assert year["offer_price_text"] == year_less.text()
    assert year["per_month_text"] == pricing.money(pricing.INR, round(year_less.minor * 30 / year["days"]))
    r = client.post("/v1/billing/razorpay/orders", headers=india, json={"pack": "starter"})
    assert r.status_code == 201 and r.json()["amount_paise"] == less.minor
    order = r.json()["order_id"]
    assert refs.orders[order] == less.minor  # what Razorpay was asked to charge
    p = _payment(client, order)
    coded = _db(client, lambda db: db.scalar(select(ReferralCode).where(ReferralCode.code == code)))
    assert (p.amount_inr, p.currency, p.referral_code_id, p.discount_minor) == (less.inr, "INR", coded.id, off)
    assert _post(client, _captured(refs, order, refs.pay(order))).status_code == 200
    assert _payment(client, order).status == "approved"
    # Paid once: the next order is full price, and the listing says so.
    assert "offer_price" not in _listed(client, india)
    again = client.post("/v1/billing/razorpay/orders", headers=india, json={"pack": "starter"}).json()
    assert again["amount_paise"] == full.minor

    # In dollars, through PayPal, the same way.
    c, c_id = _join(client, code)
    us = {**c, "X-Orbit-Client-Country": "US"}
    listed = _listed(client, us)
    full = pricing.Price(pricing.USD, round(listed["price"] * 100), 0)
    less, off = referrals.discounted(full, 10)
    assert listed["currency"] == "USD" and listed["offer_price_text"] == less.text()
    made = client.post("/v1/billing/paypal/orders", headers=us, json={"pack": "starter"})
    assert made.status_code == 201, made.text
    sent = pp["orders"][made.json()["order_id"]]["unit"]["amount"]
    assert sent == {"currency_code": "USD", "value": f"{less.minor / 100:.2f}"}
    p = _payment(client, made.json()["order_id"])
    assert (p.amount_minor, p.currency, p.discount_minor) == (less.minor, "USD", off)
    pp["orders"][made.json()["order_id"]]["status"] = "APPROVED"
    done = client.post("/v1/billing/paypal/capture", headers=us, json={"order_id": made.json()["order_id"]})
    assert done.status_code == 200 and done.json()["status"] == "approved"
    assert (_referral(client, b_id).status, _referral(client, c_id).status) == ("rewarded", "rewarded")
    assert _rewards(client, a_id) == 2


# ---- the reward -------------------------------------------------------------------------------------------------


def test_the_inviter_is_rewarded_once_however_the_payment_lands(client: TestClient, refs: Gateway) -> None:
    from orbit_api.billing.settle import reconcile
    from orbit_api.db import sessionmaker

    a, a_id = _join(client, None)
    code = _code(client, a)
    before = _minutes(client, a)
    b, b_id = _join(client, code)
    order = _order(client, b, "starter")
    pay = refs.pay(order)
    body = _captured(refs, order, pay)
    sig = hmac.new(HOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()

    async def race() -> list[Any]:
        # The checkout's answer, the webhook delivered four times and the reconciler, all at once.
        async def sweep() -> dict[str, int]:
            async with sessionmaker()() as db:
                return await reconcile(db, now=datetime.now(UTC) + timedelta(minutes=5))

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://testserver") \
                as http:
            hooks = [http.post("/v1/billing/webhook", content=body, headers={
                "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": f"evt_ref_{uuid.uuid4().hex[:8]}",
                "Content-Type": "application/json"}) for _ in range(4)]
            verify = http.post("/v1/billing/razorpay/verify", headers=b, json={
                "order_id": order, "payment_id": pay, "signature": _sign(order, pay)})
            return list(await asyncio.gather(*hooks, verify, sweep()))

    replies = client.portal.call(race)  # type: ignore[union-attr]
    assert all(r.status_code == 200 for r in replies[:5]), [r.text for r in replies[:5]]
    assert _payment(client, order).status == "approved"
    assert _minutes(client, a) == before + 30
    assert _rewards(client, a_id) == 1
    row = _referral(client, b_id)
    assert (row.status, row.reward_seconds, row.first_payment_id) == ("rewarded", 1800, _payment(client, order).id)
    # Later payments by the same friend, by any route, add nothing more.
    _pay(client, refs, b)
    _db(client, lambda db: reconcile(db, now=datetime.now(UTC) + timedelta(hours=2)))
    assert _post(client, body, event_id="evt_ref_late").status_code == 200
    assert _rewards(client, a_id) == 1 and _minutes(client, a) == before + 30
    me = client.get("/v1/referrals/me", headers=a).json()
    assert (me["joined"], me["paid"], me["minutes_earned"], me["rewards_this_month"]) == (1, 1, 30, 1)
    assert me["link"].endswith(f"/r/{code}") and me["link"] in me["share_text"]
    assert (me["reward_minutes"], me["discount_percent"], me["monthly_cap"]) == (30, 10, 10)


def test_rewards_stop_at_the_monthly_cap(client: TestClient, refs: Gateway, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "referral_monthly_cap", 2)
    a, a_id = _join(client, None)
    code = _code(client, a)
    before = _minutes(client, a)
    friends = [_join(client, code) for _ in range(3)]
    for h, _uid in friends:
        _pay(client, refs, h)
    assert _minutes(client, a) == before + 60 and _rewards(client, a_id) == 2
    assert sorted(_referral(client, uid).status for _h, uid in friends) == ["capped", "rewarded", "rewarded"]
    me = client.get("/v1/referrals/me", headers=a).json()
    assert (me["joined"], me["paid"], me["minutes_earned"], me["rewards_this_month"]) == (3, 3, 60, 2)
    # The friend past the cap still got their discount: it's the inviter's reward that's capped.
    capped = next(uid for _h, uid in friends if _referral(client, uid).status == "capped")
    assert _db(client, lambda db: db.scalar(select(Payment.discount_minor).where(Payment.user_id == capped)))


def test_a_refund_takes_back_the_reward_minutes_not_used_yet(client: TestClient, refs: Gateway) -> None:
    a, a_id = _join(client, None)
    code = _code(client, a)
    b, b_id = _join(client, code)
    order = _pay(client, refs, b)
    p = _payment(client, order)
    have = _minutes(client, a)  # the welcome minutes and the 30 for the friend
    assert _rewards(client, a_id) == 1

    async def use(db: Any) -> None:  # the inviter spends all but 10 minutes in a live interview
        db.add(UsageEvent(user_id=a_id, metric="live_seconds", quantity=(have - 10) * 60))
        await db.commit()

    _db(client, use)
    assert round(_minutes(client, a)) == 10
    refund = _refund(f"rfnd_{uuid.uuid4().hex[:10]}", str(p.gateway_payment_id), p.amount_inr * 100)
    for event in ("evt_rf_1", "evt_rf_2"):  # delivered twice: handled once
        assert _post(client, refund, event_id=event).status_code == 200
    assert round(_minutes(client, a)) == 0  # the 10 left were reward minutes: taken back
    assert _rewards(client, a_id, referrals.REWARD_BACK) == 1
    row = _referral(client, b_id)
    assert row.clawback_seconds == 600 and row.clawed_back_at is not None
    assert "took back 10 of 30 reward minutes" in row.flag and "20 were already used" in row.flag
    review = client.get("/v1/admin/referrals", headers=_admin(client)).json()["review"]
    assert any(r["id"] == row.id and "took back" in r["flag"] for r in review)
    # The friend keeps what they bought (the refund policy), and their payment shows the refund.
    assert _payment(client, order).refunded_paise == p.amount_inr * 100


# ---- abuse ------------------------------------------------------------------------------------------------------


def test_an_invite_to_the_inviters_own_account_inbox_or_network_is_blocked(client: TestClient,
                                                                            refs: Gateway) -> None:
    tag = uuid.uuid4().hex[:8]
    home = _new_ip()
    a, a_id = _join(client, None, ip=home, email=f"asha.{tag}@gmail.com")
    code = _code(client, a)
    own = client.post("/v1/referrals/redeem", headers=a, json={"code": code.lower()})
    assert own.status_code == 422 and "your own invite code" in own.json()["detail"]
    # The same inbox spelled another way (Gmail ignores dots and +tags), from another network; and someone on the
    # inviter's own network.
    twin, twin_id = _join(client, code, email=f"asha{tag}+orbit@gmail.com")
    housemate, housemate_id = _join(client, code, ip=home)
    for uid, why in ((twin_id, "same_inbox"), (housemate_id, "same_network")):
        row = _referral(client, uid)
        assert (row.status, row.reason) == ("blocked", why)
    # Blocked: no discount, and their payments earn the inviter nothing.
    assert "offer_price" not in _listed(client, twin)
    _pay(client, refs, twin)
    _pay(client, refs, housemate)
    assert _rewards(client, a_id) == 0
    # At checkout the same checks refuse the code, without saying whose network it is.
    neighbour, _ = _join(client, None, ip=home)
    r = client.post("/v1/referrals/redeem", headers=neighbour, json={"code": code})
    assert r.status_code == 422 and r.json()["detail"] == "That code can't be used on this account."
    # Two accounts can't invite each other.
    friend, friend_id = _join(client, code)
    assert _referral(client, friend_id).status == "joined"
    r = client.post("/v1/referrals/redeem", headers=a, json={"code": _code(client, friend)})
    assert r.status_code == 422
    # One code per account, for good.
    other = _code(client, _join(client, None)[0])
    r = client.post("/v1/referrals/redeem", headers=friend, json={"code": other})
    assert r.status_code == 422 and "already has a code" in r.json()["detail"]
    # The admin sees the blocked ones.
    review = {r["email"]: r for r in client.get("/v1/admin/referrals", headers=_admin(client)).json()["review"]}
    assert review[f"asha{tag}+orbit@gmail.com"]["reason"] == "same_inbox"


def test_codes_at_checkout_expired_used_up_and_switched_off(client: TestClient, refs: Gateway) -> None:
    admin = _admin(client)
    tag = uuid.uuid4().hex[:5].upper()
    made = client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"priya {tag}", "label": "Priya (YouTube)", "kind": "creator", "commission_percent": 20, "max_uses": 1})
    assert made.status_code == 201, made.text
    code = made.json()
    assert (code["code"], code["discount_percent"], code["problem"]) == (f"PRIYA{tag}", 10, None)
    assert client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"Priya{tag}", "label": "again", "kind": "creator"}).status_code == 409
    assert client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": "no!", "label": "x", "kind": "campus"}).status_code == 422
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"OLD{tag}", "label": "x", "kind": "campus", "expires_at": past}).status_code == 422
    b, b_id = _join(client, None)
    assert client.post("/v1/admin/referrals/codes", headers=b, json={
        "code": f"MINE{tag}", "label": "x", "kind": "creator"}).status_code == 403

    # Matched without regard to case or spaces, and a code nobody made is said plainly.
    ok = client.post("/v1/referrals/redeem", headers=b, json={"code": f" priya{tag.lower()} "})
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"code": f"PRIYA{tag}", "kind": "creator", "label": "Priya (YouTube)", "percent": 10,
                         "text": "10% off your first purchase"}
    assert client.post("/v1/referrals/redeem", headers=b, json={"code": f"PRIYA{tag}"}).status_code == 200  # again
    missing = client.post("/v1/referrals/redeem", headers=_join(client, None)[0], json={"code": "NOSUCHCODE9"})
    assert missing.status_code == 422 and "couldn't find that code" in missing.json()["detail"]
    info = client.get(f"/v1/referrals/codes/priya{tag}")
    assert info.status_code == 200 and info.json()["label"] == "Priya (YouTube)"

    # Used up: one paying account was all it allowed.
    _pay(client, refs, b)
    assert _referral(client, b_id).status == "paid"  # a creator code: nothing to reward
    c, _ = _join(client, None)
    used = client.post("/v1/referrals/redeem", headers=c, json={"code": f"PRIYA{tag}"})
    assert used.status_code == 422 and "used as many times" in used.json()["detail"]
    assert client.get(f"/v1/referrals/codes/PRIYA{tag}").status_code == 404
    # Paid before: codes are for a first purchase.
    late = client.post("/v1/referrals/redeem", headers=b, json={"code": _code(client, c)})
    assert late.status_code == 422

    # Expired after it was entered: the discount goes with it, and the order is full price.
    soon = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    campus = client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"IITB{tag}", "label": "IIT Bombay placement cell", "kind": "campus", "discount_percent": 15,
        "expires_at": soon}).json()
    d, d_id = _join(client, f"iitb{tag}")  # from a link, at sign-up
    assert _listed(client, d)["offer_percent"] == 15 and _referral(client, d_id).status == "joined"

    async def expire(db: Any) -> None:
        await db.execute(update(ReferralCode).where(ReferralCode.id == campus["id"])
                         .values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()

    _db(client, expire)
    listed = _listed(client, d)
    assert "offer_price" not in listed
    full = _payment(client, _order(client, d, "starter"))
    assert (full.amount_inr, full.discount_minor, full.referral_code_id) == (listed["price_inr"], None, None)
    expired = client.post("/v1/referrals/redeem", headers=_join(client, None)[0], json={"code": f"IITB{tag}"})
    assert expired.status_code == 422 and "expired on" in expired.json()["detail"]

    # Switched off (and on again) by the admin.
    third = client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"NIT{tag}", "label": "NIT", "kind": "campus"}).json()
    off = client.patch(f"/v1/admin/referrals/codes/{third['id']}", headers=admin, json={"active": False})
    assert off.status_code == 200 and off.json()["problem"] == "That code isn't active any more."
    e, _ = _join(client, None)
    r = client.post("/v1/referrals/redeem", headers=e, json={"code": f"nit{tag}"})
    assert r.status_code == 422 and "isn't active" in r.json()["detail"]
    on = client.patch(f"/v1/admin/referrals/codes/{third['id']}", headers=admin,
                      json={"active": True, "discount_percent": 20, "max_uses": 5})
    assert (on.json()["problem"], on.json()["discount_percent"], on.json()["max_uses"]) == (None, 20, 5)
    assert client.post("/v1/referrals/redeem", headers=e, json={"code": f"nit{tag}"}).json()["percent"] == 20
    kept = client.patch(f"/v1/admin/referrals/codes/{third['id']}", headers=admin,
                        json={"label": None, "discount_percent": None})
    assert (kept.json()["label"], kept.json()["discount_percent"]) == ("NIT", 20)  # null: not changed
    cleared = client.patch(f"/v1/admin/referrals/codes/{third['id']}", headers=admin, json={"clear_max_uses": True})
    assert cleared.json()["max_uses"] is None


# ---- reporting --------------------------------------------------------------------------------------------------


def test_the_admin_report_keeps_rupees_and_dollars_apart(client: TestClient, refs: Gateway,
                                                         pp: dict[str, Any]) -> None:  # noqa: F811
    admin = _admin(client)
    tag = uuid.uuid4().hex[:5].upper()
    made = client.post("/v1/admin/referrals/codes", headers=admin, json={
        "code": f"RAHUL{tag}", "label": "Rahul's channel", "kind": "creator", "commission_percent": 25}).json()
    india, _ = _join(client, None)
    india = {**india, "X-Orbit-Client-Country": "IN"}
    abroad, _ = _join(client, None)
    abroad = {**abroad, "X-Orbit-Client-Country": "US"}
    _join(client, f"rahul{tag}")  # signed up through the link, hasn't paid
    for h in (india, abroad):
        assert client.post("/v1/referrals/redeem", headers=h, json={"code": f"RAHUL{tag}"}).status_code == 200
    paid_inr = _payment(client, _pay(client, refs, india, "starter")).amount_inr * 100
    o = client.post("/v1/billing/paypal/orders", headers=abroad, json={"pack": "starter"}).json()
    pp["orders"][o["order_id"]]["status"] = "APPROVED"
    assert client.post("/v1/billing/paypal/capture", headers=abroad, json={"order_id": o["order_id"]}).json()[
        "status"] == "approved"
    paid_usd = int(_payment(client, o["order_id"]).amount_minor)

    report = client.get("/v1/admin/referrals", headers=admin).json()
    assert report["enabled"] is True and report["reward_minutes"] == 30
    row = next(c for c in report["codes"] if c["id"] == made["id"])
    assert (row["signups"], row["paying"], row["revenue_inr"], row["revenue_usd"]) == (3, 2, paid_inr, paid_usd)
    assert row["commission_inr"] == paid_inr * 25 // 100 // 100 * 100 and row["commission_usd"] == paid_usd * 25 // 100
    assert row["revenue_inr_text"].startswith("₹") and row["revenue_usd_text"].startswith("$")
    assert report["invites"]["id"] is None and report["invites"]["code"] == "Invite links"

    csv = client.get("/v1/admin/referrals/export", headers=admin)
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("code,kind,label,discount_percent,commission_percent")
    line = next(x for x in lines if x.startswith(f"RAHUL{tag},"))
    assert f",{paid_inr // 100}," in line and f",{paid_usd / 100:.2f}," in line
    assert client.get("/v1/admin/referrals/export", headers=india).status_code == 403
    assert client.get("/v1/admin/referrals", headers=india).status_code == 403


# ---- sign-up --------------------------------------------------------------------------------------------------


@pytest.fixture
def google_refs(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    for k, v in {"ORBIT_GOOGLE_CLIENT_ID": "orbit-client", "ORBIT_GOOGLE_CLIENT_SECRET": "orbit-secret",
                 "ORBIT_GOOGLE_REDIRECT_URI": "http://testserver/v1/auth/google/callback",
                 "ORBIT_REFERRALS": "true"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from orbit_api.main import create_app

    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()


def test_a_google_sign_up_keeps_the_links_code(google_refs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from urllib.parse import parse_qs, urlparse

    from orbit_api.auth import google

    client = google_refs
    inviter = {"X-Forwarded-For": _new_ip()}
    r = client.post("/v1/auth/register", headers=inviter,
                    json={"email": f"g-inviter-{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD})
    assert r.status_code == 201
    token = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.cookies.clear()
    code = client.get("/v1/referrals/me", headers=token).json()["code"]
    assert client.get("/v1/auth/me", headers=token).json()["referrals"] is True

    def sign_up_with_google(start: str) -> str:
        email = f"g-{uuid.uuid4().hex[:8]}@gmail.com"

        async def fake(code: str, verifier: str, uri: str) -> dict[str, str]:
            return {"sub": f"sub-{email}", "email": email, "name": "Meera"}

        monkeypatch.setattr(google, "fetch_identity", fake)
        here = {"X-Forwarded-For": _new_ip()}
        begin = client.get(start, headers=here, follow_redirects=False)
        state = parse_qs(urlparse(begin.headers["location"]).query)["state"][0]
        done = client.get(f"/v1/auth/google/callback?code=c&state={state}", headers=here, follow_redirects=False)
        assert done.status_code == 302 and done.headers["location"].endswith("/welcome")
        uid = str(client.get("/v1/auth/me").json()["id"])
        client.cookies.clear()
        return uid

    # The web app sends the link's code to /google/start; it rides through Google's page in the signed state.
    first = sign_up_with_google(f"/v1/auth/google/start?next=/&ref={code.lower()}")
    # Or it's in the first-party cookie the web app keeps it in.
    client.cookies.set(referrals.REF_COOKIE, code)
    second = sign_up_with_google("/v1/auth/google/start?next=/")
    for uid in (first, second):
        row = _referral(client, uid)
        assert row is not None and (row.status, row.via) == ("joined", "signup")
        assert row.referrer_user_id is not None and row.kind == "invite"
    # A stale code doesn't stop a sign-up: it's just not attributed.
    client.cookies.set(referrals.REF_COOKIE, "NOSUCH999")
    third = sign_up_with_google("/v1/auth/google/start?next=/")
    assert _referral(client, third) is None


def test_with_referrals_off_nothing_is_attributed_or_discounted(client: TestClient, gw: Gateway,  # noqa: F811
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "admin_email", ADMIN)
    assert get_settings().referrals is False  # the default
    a, a_id = _join(client, None)
    assert client.get("/v1/referrals/me", headers=a).status_code == 404
    assert client.get("/v1/auth/me", headers=a).json()["referrals"] is False

    async def make(db: Any) -> None:
        db.add(ReferralCode(code=f"OFF{uuid.uuid4().hex[:6].upper()}", kind="invite", owner_user_id=a_id))
        await db.commit()

    _db(client, make)
    code = _db(client, lambda db: db.scalar(select(ReferralCode.code).where(ReferralCode.owner_user_id == a_id)))
    b, b_id = _join(client, code)
    assert _referral(client, b_id) is None
    assert client.post("/v1/referrals/redeem", headers=b, json={"code": code}).status_code == 404
    assert client.get(f"/v1/referrals/codes/{code}").status_code == 404
    listed = _listed(client, b, "mini")
    assert "offer_price" not in listed
    assert _payment(client, _pay(client, gw, b)).discount_minor is None
    assert _rewards(client, a_id) == 0
    # The admin can still make codes and see the values before switching it on.
    report = client.get("/v1/admin/referrals", headers=_admin(client))
    assert report.status_code == 200 and report.json()["enabled"] is False


def test_one_open_order_carries_the_discount(client: TestClient, refs: Gateway,
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    """A first-purchase discount on several open orders, all paid, would be a discount on everything (red team). The
    newest order takes it from unpaid ones (still credited if paid after all), and a payment already on its way keeps
    it, so an order meanwhile is full price."""
    monkeypatch.setattr(get_settings(), "upi_id", "owner@okicici")
    a, _ = _join(client, None)
    b, _ = _join(client, _code(client, a))
    india = {**b, "X-Orbit-Client-Country": "IN"}
    starter, mini = _listed(client, india, "starter"), _listed(client, india, "mini")
    card = client.post("/v1/billing/razorpay/orders", headers=india, json={"pack": "starter"}).json()
    first = _payment(client, card["order_id"])
    assert first.discount_minor and first.status == "awaiting_payment"

    upi = client.post("/v1/billing/upi/orders", headers=india, json={"pack": "mini"})
    assert upi.status_code == 201, upi.text
    assert upi.json()["amount_inr"] == round(mini["offer_price"])  # the discount moved to the newest order
    moved = _payment(client, card["order_id"])
    assert moved.status == "expired" and "newer order" in (moved.note or "")
    # Asked again for the same pack, UPI hands back the same order, discount and all.
    assert client.post("/v1/billing/upi/orders", headers=india, json={"pack": "mini"}).json()["id"] == upi.json()["id"]

    sent = client.post(f"/v1/billing/upi/orders/{upi.json()['id']}/utr", headers=india, json={"utr": "412345678901"})
    assert sent.status_code == 200 and sent.json()["status"] == "submitted"
    # A payment on its way to the admin keeps the discount: another order meanwhile is at the full price.
    again = client.post("/v1/billing/razorpay/orders", headers=india, json={"pack": "starter"}).json()
    assert again["amount_paise"] == round(starter["price"] * 100)

    # The order that lost the discount, paid after all: still credited at what it charged.
    assert _post(client, _captured(refs, card["order_id"], refs.pay(card["order_id"]))).status_code == 200
    assert _payment(client, card["order_id"]).status == "approved"


def test_orders_come_through_the_website_once_its_worker_signs(client: TestClient, refs: Gateway,
                                                               monkeypatch: pytest.MonkeyPatch) -> None:
    """A direct caller could name any account country and buy at rupee prices from anywhere (red team): with the
    proxy secret set, an order needs the website's signed request. The desktop app buys on the website already."""
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "upi_id", "owner@okicici")
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr("edge-secret"))
    h, _ = _join(client, None)
    # Outside production (development, these tests) nothing changes.
    assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "mini"}).status_code == 201
    monkeypatch.setattr(get_settings(), "env", "production")
    monkeypatch.setattr(get_settings(), "allowed_emails", "*")  # a public server
    direct = {**h, "X-Orbit-Client-Country": "IN"}  # believed only with the secret
    for path in ("/v1/billing/upi/orders", "/v1/billing/razorpay/orders", "/v1/billing/paypal/orders"):
        r = client.post(path, headers=direct, json={"pack": "mini"})
        assert r.status_code == 409 and "/billing" in r.json()["detail"], (path, r.text)
    signed = {**direct, "X-Orbit-Proxy-Secret": "edge-secret"}
    assert client.post("/v1/billing/upi/orders", headers=signed, json={"pack": "starter"}).status_code == 201
    assert client.post("/v1/billing/razorpay/orders", headers=signed, json={"pack": "mini"}).status_code == 201
