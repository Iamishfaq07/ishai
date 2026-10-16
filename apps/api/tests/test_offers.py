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


def test_what_if_figures_change_nothing_and_stay_private(jobs: TestClient) -> None:  # noqa: F811
    a, b = _register(jobs), _register(jobs)
    oid = jobs.post("/v1/offers", headers=a, json=OFFER).json()["id"]
    same = jobs.post(f"/v1/offers/{oid}/scenario", headers=a, json={}).json()
    assert same["offer"] == same["scenario"]  # no changes: the same figures
    r = jobs.post(f"/v1/offers/{oid}/scenario", headers=a, json={
        "fixed_change_pct": 10, "variable_payout_pct": 50, "joining_bonus": 0, "equity_value_pct": 200})
    assert r.status_code == 200, r.text
    s = r.json()["scenario"]
    assert s["fixed"] == 2_640_000 and s["variable"] == 120_000 and s["joining_bonus"] == 0
    assert s["first_year"] == 2_640_000 + 120_000
    assert s["monthly_in_hand"] > same["offer"]["monthly_in_hand"]  # more fixed pay, more each month
    # Nothing saved: the offer reads as before.
    assert jobs.get("/v1/offers", headers=a).json()[0]["fixed"] == 2_400_000
    assert jobs.post(f"/v1/offers/{oid}/scenario", headers=b, json={}).status_code == 404
    assert jobs.post(f"/v1/offers/{oid}/scenario", headers=a, json={"fixed_change_pct": 500}).status_code == 422


def test_dollars_are_the_ones_where_the_post_is() -> None:
    for country, code in (("CA", "CAD"), ("AU", "AUD"), ("NZ", "NZD"), ("SG", "SGD"), ("US", "USD"), ("IN", "USD"),
                          (None, "USD")):
        p = parse_pay("$90k – $110k a year", country)
        assert p and (p.currency, p.low, p.high) == (code, 90_000, 110_000), country
    p = parse_pay("CA$95,000 – CA$115,000", "US")  # the line says which dollar
    assert p and (p.currency, p.low) == ("CAD", 95_000)
    assert getattr(parse_pay("A$120k – A$140k"), "currency", None) == "AUD"
    p = parse_pay("S$6,000 – S$8,000 a month")
    assert p and (p.currency, p.low) == ("SGD", 72_000)
    assert getattr(parse_pay("$120k – $150k USD", "CA"), "currency", None) == "USD"  # it says which
    assert getattr(parse_pay("NZD 90,000 - 110,000"), "currency", None) == "NZD"
    assert getattr(parse_pay("CHF 120,000 - 140,000 a year", "CH"), "currency", None) == "CHF"
    p = parse_pay("₹30L – ₹40L a year", "IN")  # India's lines read as they always have
    assert p and (p.currency, p.low, p.high) == ("INR", 3_000_000, 4_000_000)


def test_a_canadian_market_reads_its_dollars_as_canadian(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    jobs.patch("/v1/auth/me/region", headers=h, json={"country": "CA"})
    toronto = {"locations": ["Toronto, ON"], "cities": ["Toronto"], "country": "CA"}
    insert(jobs, *[_listing(company=c, title="Platform Engineer", salary=s, **toronto) for c, s in
                   (("A", "$100k – $120k a year"), ("B", "$110k – $130k a year"), ("C", "CA$95,000 – CA$115,000"))],
           _listing(company="D", title="Platform Engineer", salary="$150k – $180k a year", locations=["Austin, TX"],
                    cities=["Austin"], country="US"))
    pay = jobs.get("/v1/offers/pay", headers=h, params={"role": "Platform Engineer"}).json()
    assert pay["currency"] == "CAD" and pay["count"] == 3 and pay["high"] == 130_000


def test_a_new_offer_is_in_the_currency_where_the_user_applies(jobs: TestClient) -> None:  # noqa: F811
    india = _register(jobs)
    unsaid = {k: v for k, v in OFFER.items() if k != "currency"}
    o = jobs.post("/v1/offers", headers=india, json=unsaid).json()
    assert o["currency"] == "INR" and o["take_home"]["monthly"] > 0  # no country yet: rupees, as always
    uk = _register(jobs)
    jobs.patch("/v1/auth/me/region", headers=uk, json={"country": "GB"})
    offer = {"company": "Monzo", "role": "Backend Engineer", "city": "London", "fixed": 85_000}
    r = jobs.post("/v1/offers", headers=uk, json=offer)
    assert r.status_code == 201, r.text
    assert r.json()["currency"] == "GBP" and r.json()["take_home"] is None
    oid = r.json()["id"]
    # An edit that doesn't say keeps the offer's currency; one that does changes it.
    assert jobs.put(f"/v1/offers/{oid}", headers=uk, json={**offer, "fixed": 90_000}).json()["currency"] == "GBP"
    assert jobs.put(f"/v1/offers/{oid}", headers=uk, json={**offer, "currency": "EUR"}).json()["currency"] == "EUR"
    assert jobs.post("/v1/offers", headers=uk, json={**offer, "currency": "pounds"}).status_code == 422


def test_the_plan_uses_the_offers_own_words() -> None:
    from orbit_api.offers.plan import offer_text, system_prompt

    rupees = system_prompt(OFFER, "IN")  # India's words, as they always were
    assert "the fixed pay a year to ask for" in rupees and "a large variable share" in rupees
    assert ("(joining bonus, review in 6 months, more\n   variable, a start date) if the fixed pay can't move"
            in rupees) and "a joining bonus with a clawback" in rupees and "__" not in rupees
    assert offer_text(OFFER).splitlines()[3:6] == ["Fixed pay a year: ₹24L", "Variable pay a year (target): ₹2.4L",
                                                   "Joining bonus: ₹2L"]
    usd = {**OFFER, "currency": "USD", "city": "Austin", "fixed": 150_000, "variable": 15_000, "joining_bonus": 20_000}
    dollars = system_prompt(usd, "US")
    assert "the base salary a year to ask for" in dollars and "a large bonus share" in dollars
    assert ("(signing bonus, review in 6 months, more\n   bonus, a start date) if the base salary can't move"
            in dollars) and "a signing bonus with a clawback" in dollars
    assert "joining" not in dollars and "variable" not in dollars and "fixed pay" not in dollars
    assert offer_text(usd).splitlines()[3:6] == ["Base salary a year: USD 150,000", "Target bonus a year: USD 15,000",
                                                 "Signing bonus: USD 20,000"]
