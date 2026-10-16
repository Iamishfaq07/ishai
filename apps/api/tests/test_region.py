"""The country a user applies in (orbit_api/region.py, PATCH /v1/auth/me/region, users.country)."""

import uuid
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.region import country_code, is_india
from tests.test_api import _register


def test_country_codes() -> None:
    assert country_code("gb") == "GB" and country_code("UK") == "GB" and country_code(" in ") == "IN"
    for bad in (None, "", "XX", "USA", "India"):
        assert country_code(bad) is None, bad
    assert is_india("IN") and is_india("in") and not is_india("US") and not is_india(None)


def test_sign_up_keeps_the_browsers_guess_and_settings_change_it(client: TestClient) -> None:
    email = f"r{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery", "country": "us"})
    assert r.status_code in (200, 201), r.text
    assert r.json()["user"]["country"] == "US"
    other = f"r{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/v1/auth/register", json={"email": other, "password": "correct horse battery", "country": "??"})
    assert r.status_code in (200, 201) and r.json()["user"]["country"] is None  # a bad guess never blocks sign-up

    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["country"] is None
    r = client.patch("/v1/auth/me/region", headers=h, json={"country": "gb"})
    assert r.status_code == 200 and r.json()["country"] == "GB"
    assert client.get("/v1/auth/me", headers=h).json()["country"] == "GB"
    for bad in ({"country": "XX"}, {"country": "USA"}, {}):
        assert client.patch("/v1/auth/me/region", headers=h, json=bad).status_code == 422, bad
    assert client.patch("/v1/auth/me/region", json={"country": "IN"}).status_code == 401


def test_the_migration_adds_and_removes_the_column(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "region.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def columns() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute("pragma table_info(users)")}

    alembic("upgrade", "head")
    assert "country" in columns()
    alembic("downgrade", "e4b6d8f0a2c3")
    assert "country" not in columns()
    alembic("upgrade", "head")


def test_prompts_are_written_for_the_country() -> None:
    from orbit_api.job_portal.fit import FIT_SYSTEM
    from orbit_api.region import country_name, localize
    from orbit_api.resumes.kit import NAUKRI_SYSTEM, OUTREACH_SYSTEM

    assert country_name("us") == "the United States" and country_name("FJ") == "FJ" and country_name(None) is None
    us = localize(OUTREACH_SYSTEM, "US")
    assert "applying for jobs in the United States" in us and "plain American business English" in us
    india = localize(OUTREACH_SYSTEM, "IN")
    assert "applying for jobs in India" in india and "Indian-English" in india
    unknown = localize(FIT_SYSTEM, None)
    assert "applying for jobs." in unknown and "international business English" not in unknown
    assert "international business English" in localize(OUTREACH_SYSTEM, "DE")
    for p in (us, india, unknown, localize(NAUKRI_SYSTEM, "IN")):
        assert "__" not in p


def test_a_feature_without_the_ai_follows_the_account_then_the_edge_then_india() -> None:
    import os

    from starlette.requests import Request

    from orbit_api.region import market_country

    def request(**headers: str) -> Request:
        return Request({"type": "http", "method": "GET", "path": "/", "query_string": b"",
                        "headers": [(k.replace("_", "-").encode(), v.encode()) for k, v in headers.items()]})

    seen_in_us = request(x_orbit_proxy_secret=os.environ["ORBIT_PROXY_SECRET"], x_orbit_client_country="US")
    assert market_country("GB", seen_in_us) == "GB"  # the account's own country wins
    assert market_country(None, seen_in_us) == "US"
    assert market_country(None, request(x_orbit_client_country="US")) == "IN"  # not from the Worker: not believed
    assert market_country(None) == "IN" and market_country("xx") == "IN"  # nothing to go on: India, as always
    assert market_country("gb") == "GB"


def test_each_country_has_its_currency() -> None:
    from orbit_api.region import currency

    assert currency("IN") == "INR" and currency("gb") == "GBP" and currency("UK") == "GBP"
    assert currency("DE") == currency("PT") == currency("FI") == "EUR" and currency("NZ") == "NZD"
    assert currency(None) is None and currency("FJ") is None and currency("XX") is None


def test_a_referral_goes_by_whatsapp_only_in_india() -> None:
    from orbit_api.region import localize
    from orbit_api.resumes.kit import OUTREACH_SYSTEM, outreach_system

    india = outreach_system("IN")
    assert india == localize(OUTREACH_SYSTEM, "IN")  # as it always was
    assert "a LinkedIn or WhatsApp message" in india and "read on LinkedIn or WhatsApp" in india
    for country in ("US", "GB", None):
        rules = outreach_system(country)
        assert "WhatsApp" not in rules, country
        assert "a LinkedIn message or a short email" in rules and "read on LinkedIn or in an email" in rules
