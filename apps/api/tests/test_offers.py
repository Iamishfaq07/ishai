from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.models import User
from orbit_api.offers.pay import parse_pay
from orbit_api.offers.tax import income_tax, take_home
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)


def test_reads_pay_lines() -> None:
    p = parse_pay("₹30L – ₹40L a year")
    assert p and (p.currency, p.low, p.high) == ("INR", 3_000_000, 4_000_000)
    p = parse_pay("$140k – $165k a year")
    assert p and (p.currency, p.low, p.high) == ("USD", 140_000, 165_000)
    p = parse_pay("$150K – $200K • Offers Equity")
    assert p and p.high == 200_000
    p = parse_pay("₹25,00,000 - ₹35,00,000")
    assert p and (p.low, p.high) == (2_500_000, 3_500_000)
    p = parse_pay("18-24 LPA")
    assert p and (p.currency, p.low) == ("INR", 1_800_000)
    p = parse_pay("$45 – $60 an hour")
    assert p and p.low == 45 * 2_080
    p = parse_pay("₹80k a month")
    assert p and p.low == 960_000
    assert parse_pay("Competitive") is None
    assert parse_pay("$5 – $500k") is None  # not a range anyone pays
    assert parse_pay(None) is None


def test_new_regime_tax() -> None:
    assert income_tax(1_200_000) == 0  # the 87A rebate
    assert income_tax(1_210_000) == round(10_000 * 1.04)  # marginal relief: no more than the income over 12L
    # 18L taxable: 0 + 20k + 40k + 60k + 2L * 20% = 1.6L, plus 4% cess.
    assert income_tax(1_800_000) == round(160_000 * 1.04)


def test_take_home_for_a_20_lakh_offer() -> None:
    t = take_home(2_000_000)
    assert t.employee_pf == 21_600 and t.professional_tax == 2_500
    assert 140_000 < t.monthly < 150_000
    assert t.variable_after_tax == 0
    with_variable = take_home(2_000_000, 200_000)
    assert 140_000 <= with_variable.variable_after_tax < 200_000  # taxed at the top slab it lands in
    full = take_home(2_000_000, pf="full")
    assert full.monthly < t.monthly  # more PF, less in the bank
    assert take_home(1_000_000).yearly_tax == 0


def _verify(client: TestClient, h: dict[str, str]) -> None:
    uid = client.get("/v1/auth/me", headers=h).json()["id"]

    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.id == uid).values(email_verified=True))
            await db.commit()
    run(client, go)


OFFER = {"company": "Razorpay", "role": "Backend Engineer", "city": "Bengaluru", "currency": "INR",
         "fixed": 2_400_000, "variable": 240_000, "joining_bonus": 200_000}


def test_offers_compare_with_the_market_and_get_a_plan(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, h)
    insert(jobs, *[_listing(company=c, title="Senior Backend Engineer", salary=s) for c, s in
                   (("A", "₹25L – ₹35L a year"), ("B", "₹30L – ₹40L a year"), ("C", "₹28L – ₹36L a year"),
                    ("D", "₹20L – ₹30L a year"))],
           _listing(company="E", title="Data Analyst", salary="₹8L – ₹12L a year"))
    pay = jobs.get("/v1/offers/pay", headers=h, params={"role": "Backend Engineer", "city": "Bengaluru"}).json()
    assert pay["count"] == 4 and pay["currency"] == "INR" and pay["scope"] == "Backend Engineer in Bengaluru"
    assert 2_500_000 <= pay["median"] <= 3_500_000
    r = jobs.post("/v1/offers", headers=h, json=OFFER)
    assert r.status_code == 201, r.text
    offer = r.json()
    assert offer["first_year"] == 2_840_000 and offer["yearly"] == 2_640_000
    assert offer["position"] == "below" and offer["take_home"]["monthly"] > 0
    assert offer["plan"] is None
    planned = jobs.post(f"/v1/offers/{offer['id']}/plan", headers=h).json()
    plan = planned["plan"]
    assert plan["ask"] > OFFER["fixed"] and plan["call_script"] and plan["email"]["body"]
    assert planned["plan_stale"] is False
    # The same figures: the same plan, no new AI call. New figures: the plan says it's out of date.
    assert jobs.post(f"/v1/offers/{offer['id']}/plan", headers=h).json()["plan"] == plan
    changed = jobs.put(f"/v1/offers/{offer['id']}", headers=h, json={**OFFER, "fixed": 2_600_000}).json()
    assert changed["plan_stale"] is True
    assert len(jobs.get("/v1/offers", headers=h).json()) == 1


def test_offers_are_private(jobs: TestClient) -> None:  # noqa: F811
    a, b = _register(jobs), _register(jobs)
    oid = jobs.post("/v1/offers", headers=a, json=OFFER).json()["id"]
    assert jobs.put(f"/v1/offers/{oid}", headers=b, json=OFFER).status_code == 404
    assert jobs.delete(f"/v1/offers/{oid}", headers=b).status_code == 404
    assert jobs.post(f"/v1/offers/{oid}/plan", headers=b).status_code in (403, 404)
    assert jobs.get("/v1/offers", headers=b).json() == []
    assert jobs.delete(f"/v1/offers/{oid}", headers=a).status_code == 204
    assert jobs.post("/v1/offers", headers=a, json={**OFFER, "fixed": 0}).status_code == 422
