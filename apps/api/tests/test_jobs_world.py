"""Jobs AI worldwide: posts kept from every country, each user's feed for the country they apply in (India first),
remote posts by who they're open to, and search links, cities and searches for that country. The company boards
hiring outside India, and SmartRecruiters asked one country at a time, reach those feeds (and Offer AI's pay ranges
and LinkedIn AI's keywords) while India's feed stays as it was."""

import asyncio
from collections import Counter
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings, get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal import geo, ranking, refresh
from orbit_api.job_portal.companies import DEFAULT_BOARDS, boards
from orbit_api.job_portal.http import FeedClient
from orbit_api.job_portal.portals import portal_links, portals_for
from orbit_api.job_portal.postings import Posting, normalize
from orbit_api.job_portal.profile import JobPrefs, search_queries
from orbit_api.job_portal.search_parse import parse_search
from orbit_api.job_portal.sources import allowed_hosts, source_named
from orbit_api.job_portal.sources.base import SearchQuery, Source
from orbit_api.job_portal.sources.greenhouse import pay_of
from orbit_api.linkedin.routes import market_keywords
from tests import jobs_fixtures as fx
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, make_resume, run  # noqa: F401  (the fixture)


def _post(where: str, **kw: Any) -> Posting:
    return Posting(source="greenhouse", external_id=where, board="b", company="Acme", title="Backend Engineer",
                   url="https://example.com/j", apply_url="https://example.com/j", posted_at=None, locations=[where],
                   description="Build services.", **kw)


def test_posts_are_placed_in_their_country_and_remote_ones_by_who_they_are_open_to() -> None:
    def place(where: str, **kw: Any) -> tuple[Any, Any, Any]:
        row = normalize(_post(where, **kw))
        return (row["country"], row["cities"], row["remote_scope"]) if row else None  # type: ignore[return-value]

    assert place("Bangalore, Karnataka, India") == ("IN", ["Bengaluru"], None)
    assert place("Pune, IN") == ("IN", ["Pune"], None)
    assert place("Austin, TX") == ("US", ["Austin"], None)
    assert place("London, England, United Kingdom") == ("GB", ["London"], None)
    assert place("Munich, Germany") == ("DE", ["Munich"], None)
    assert place("Remote - US") == ("US", [], ["US"])
    assert place("Remote (EMEA)") == (None, [], ["EMEA"])
    assert place("Remote, Worldwide") == (None, [], ["*"])
    assert place("Remote - Bengaluru") == ("IN", ["Bengaluru"], ["IN"])
    assert place("Remote", remote_unstated_ok=True) == (None, [], ["IN"])  # an India-first board
    assert place("Remote", open_to=["CA"]) == (None, [], ["CA"])  # the source said
    assert place("Remote") is None  # open to whom? not listed
    assert place("Somewhere nice") is None


def test_who_a_remote_post_is_open_to() -> None:
    assert geo.open_to(["*"], "BR") and geo.open_to(["EMEA"], "DE") and geo.open_to(["APAC"], "IN")
    assert not geo.open_to(["US"], "IN") and not geo.open_to(["EMEA"], "US") and not geo.open_to([], "IN")
    assert geo.countries_in("join us today") == [] and geo.countries_in("Remote - US") == ["US"]


def _feed(client: TestClient, h: dict[str, str], **params: Any) -> list[str]:
    r = client.get("/v1/jobs/feed", headers=h, params=params)
    assert r.status_code == 200, r.text
    return [j["title"] for j in r.json()["items"]]


def test_each_feed_is_for_the_country_its_user_applies_in(jobs: TestClient) -> None:  # noqa: F811
    insert(jobs,
           _listing(title="Backend Engineer Bengaluru"),
           _listing(title="Backend Engineer Austin", locations=["Austin, TX"], cities=["Austin"], country="US"),
           _listing(title="Backend Engineer London", locations=["London, UK"], cities=["London"], country="GB"),
           _listing(title="Backend Engineer Remote US", locations=["Remote - US"], cities=[], country="US",
                    workplace="remote", remote_scope=["US"]),
           _listing(title="Backend Engineer Remote EMEA", locations=["Remote (EMEA)"], cities=[], country=None,
                    workplace="remote", remote_scope=["EMEA"]),
           _listing(title="Backend Engineer Remote Anywhere", locations=["Remote"], cities=[], country=None,
                    workplace="remote", remote_scope=["*"]))
    india = _register(jobs)
    make_resume(jobs, india)
    assert set(_feed(jobs, india)) == {"Backend Engineer Bengaluru", "Backend Engineer Remote Anywhere"}

    us = _register(jobs)
    make_resume(jobs, us)
    assert jobs.patch("/v1/auth/me/region", headers=us, json={"country": "US"}).status_code == 200
    assert set(_feed(jobs, us)) == {"Backend Engineer Austin", "Backend Engineer Remote US",
                                    "Backend Engineer Remote Anywhere"}
    feed = jobs.get("/v1/jobs/feed", headers=us).json()
    assert {p["id"] for p in feed["portals"]} == {"linkedin", "indeed", "google"}  # no Naukri in the US
    assert "www.indeed.com" in next(p["url"] for p in feed["portals"] if p["id"] == "indeed")

    uk = _register(jobs)
    make_resume(jobs, uk)
    jobs.patch("/v1/auth/me/region", headers=uk, json={"country": "GB"})
    assert set(_feed(jobs, uk)) == {"Backend Engineer London", "Backend Engineer Remote EMEA",
                                    "Backend Engineer Remote Anywhere"}
    in_london = _feed(jobs, uk, q="backend london")  # a city search still shows remote roles open there
    assert "Backend Engineer London" in in_london and "Backend Engineer Austin" not in in_london

    profile = jobs.get("/v1/jobs/profile", headers=us).json()
    assert profile["cities"][:3] == ["Anywhere", "New York", "San Francisco"]
    assert "naukri" not in profile["portals"] and "linkedin" in profile["portals"]
    assert jobs.get("/v1/jobs/profile", headers=india).json()["cities"][:2] == ["India", "Bengaluru"]


# ---- company boards for the other countries ----------------------------------------------------------------------


def _fetch(src: Source, key: str, seen: list[httpx.Request]) -> list[Posting]:
    async def go() -> list[Posting]:
        async with FeedClient(allowed_hosts(), fx.transport(seen)) as http:
            return await src.fetch(http, key, set())

    return asyncio.run(go())


def test_smartrecruiters_is_asked_for_india_as_before_then_one_country_at_a_time(
        monkeypatch: pytest.MonkeyPatch) -> None:
    src = source_named("smartrecruiters")
    assert src is not None
    tokens = [b.token for b in boards("smartrecruiters")]
    keys = src.keys()
    assert keys[:len(tokens)] == tokens  # India's keys first, as they always were
    assert {f"servicenow:{c}" for c in ("US", "GB", "CA", "DE", "AU")} <= set(keys)
    assert not any(k.startswith(("swiggy:", "PHONEPELIMITED:", "ixigo:")) for k in keys)  # India-first: India only

    seen: list[httpx.Request] = []
    us = _fetch(src, "servicenow:US", seen)
    assert [r.url.params["country"] for r in seen if r.url.path.endswith("/postings")] == ["us"]
    assert len(us) == 1 and us[0].board == "servicenow:US" and us[0].company == "ServiceNow"
    row = normalize(us[0])
    assert row is not None and (row["country"], row["cities"], row["locations"]) == (
        "US", ["Santa Clara"], ["Santa Clara, CA, United States"])
    assert "ServiceNow makes" in row["description"]  # its text, read with a second call like India's
    seen.clear()
    india = _fetch(src, "servicenow", seen)
    assert [r.url.params["country"] for r in seen if r.url.path.endswith("/postings")] == ["in"]
    assert {p.board for p in india} == {"servicenow"} and india[0].locations == ["Bengaluru, KA, India"]
    seen.clear()
    assert _fetch(src, "servicenow:GB", seen) == [] and len(seen) == 1  # nothing there: one small call
    monkeypatch.setattr(get_settings(), "jobs_board_countries", "IE")
    assert {k.partition(":")[2] for k in src.keys()} == {"", "IE"}


def test_board_countries_are_checked_at_startup() -> None:
    assert Settings(ORBIT_JOBS_BOARD_COUNTRIES="us, gb,IN,us").jobs_board_countries == "US,GB"  # India: always
    with pytest.raises(ValueError):
        Settings(ORBIT_JOBS_BOARD_COUNTRIES="USA,UK")


def test_the_built_in_boards_are_each_listed_once() -> None:
    counts = Counter((b.ats, b.token.lower()) for b in DEFAULT_BOARDS)
    assert [key for key, n in counts.items() if n > 1] == []


def test_greenhouse_pay_ranges_are_the_posts_pay() -> None:
    from orbit_api.job_portal.companies import Board
    from orbit_api.job_portal.sources import greenhouse

    board = Board("greenhouse", fx.WORLD_BOARD, "Anthropic", False)
    posts = {p.title: p for j in fx.greenhouse_world()["jobs"] if (p := greenhouse.parse_job(j, board))}
    assert posts["Software Engineer, Backend"].salary == "$223k – $290k a year"
    assert posts["Backend Engineer"].salary == "£110k – £150k a year"
    assert posts["Backend Engineer, Developer Platform"].salary == "CAD 170k – CAD 210k a year"
    assert posts["Software Engineering Intern"].salary == "$50 – $60 an hour"
    assert pay_of([]) is None and pay_of(None) is None and pay_of([{"min_cents": None, "max_cents": "x"}]) is None
    # Open in India too: a dollar range is the US pay, not India's, so India's cards show only a rupee range.
    also_india = {**fx.greenhouse_world()["jobs"][0], "location": {"name": "Remote, India; Remote, United Kingdom"}}
    in_dollars = greenhouse.parse_job(also_india, board)
    in_rupees = greenhouse.parse_job({**also_india, "pay_input_ranges": [
        {"min_cents": 400_000_000, "max_cents": 600_000_000, "currency_type": "INR", "title": "Annual"}]}, board)
    assert in_dollars and in_dollars.salary is None and in_rupees and in_rupees.salary == "₹40L – ₹60L a year"
    assert normalize(next(p for p in posts.values() if p.title == "Backend Engineer"))["country"] == "GB"  # type: ignore[index]


def test_boards_hiring_abroad_reach_those_feeds_and_india_keeps_its_own(jobs: TestClient) -> None:  # noqa: F811
    gh, sr = source_named("greenhouse"), source_named("smartrecruiters")
    assert gh is not None and sr is not None

    def fetch(src: Source, keys: list[str]) -> None:
        run(jobs, refresh.refresh_source, src, keys=keys, delay_s=0, client_transport=fx.transport())

    def feed(h: dict[str, str]) -> list[tuple[str, str, str, int]]:
        ranking.clear_cache()
        r = jobs.get("/v1/jobs/feed", headers=h)
        assert r.status_code == 200, r.text
        return [(j["id"], j["title"], j["company"], j["match"]["score"]) for j in r.json()["items"]]

    fetch(gh, ["groww"])
    fetch(sr, ["swiggy"])
    india = _register(jobs)
    make_resume(jobs, india)
    before = feed(india)
    assert {t for _, t, _, _ in before} == {"Backend Engineer - Payments", "Backend Engineer II"}
    # What's read for everyone else: a board hiring in the US, the UK and Canada, and SmartRecruiters' other
    # countries.
    assert fx.WORLD_BOARD in gh.keys()
    fetch(gh, [fx.WORLD_BOARD])
    fetch(sr, [k for k in sr.keys() if k.startswith("servicenow:")])
    assert feed(india) == before

    def user_in(country: str) -> dict[str, str]:
        h = _register(jobs)
        make_resume(jobs, h)
        assert jobs.patch("/v1/auth/me/region", headers=h, json={"country": country}).status_code == 200
        return h

    us = user_in("US")
    found = {(t, c) for _, t, c, _ in feed(us)}
    assert {("Software Engineer, Backend", "Anthropic"), ("Backend Engineer, Platform", "Anthropic"),
            ("Senior Backend Engineer", "Anthropic"), ("Senior Backend Engineer", "ServiceNow")} <= found
    assert not {t for t, _ in found} & {"Backend Engineer - Payments", "Backend Engineer II", "Backend Engineer"}
    assert {t for _, t, _, _ in feed(user_in("GB"))} == {"Backend Engineer"}  # London's
    assert {t for _, t, _, _ in feed(user_in("CA"))} == {"Backend Engineer, Developer Platform"}  # Toronto's

    # Offer AI's market and LinkedIn AI's keywords read the same posts for the US.
    pay = jobs.get("/v1/offers/pay", headers=us, params={"role": "Backend Engineer"}).json()
    assert (pay["currency"], pay["count"]) == ("USD", 3) and 230_000 <= pay["median"] <= 275_000

    async def keywords() -> tuple[list[str], int]:
        async with sessionmaker()() as db:
            return await market_keywords(db, "Backend Engineer", "US")

    words, posts = run(jobs, keywords)
    assert posts >= 3 and {"Kubernetes", "Kafka"} <= set(words)


def test_searches_links_and_the_search_box_follow_the_country() -> None:
    prefs = JobPrefs(titles=["Backend Engineer"], locations=["London"])
    q = search_queries(prefs, country="GB")[0]
    assert (q.what, q.where, q.country) == ("backend engineer", "London", "GB")
    assert q.key() == "backend engineer|London|7|GB" and SearchQuery.from_key(q.key()) == q
    india = search_queries(JobPrefs(titles=["Backend Engineer"]), country="IN")[0]
    assert india.key() == "backend engineer|India|7" and SearchQuery.from_key(india.key()).country == "IN"
    assert search_queries(JobPrefs(titles=["Backend Engineer"], locations=["London"]), country="US")[0].where \
        == "Anywhere"  # London isn't in the US
    assert JobPrefs(locations=["anywhere in germany", "nyc"]).locations == ["Anywhere", "New York"]

    links = {p.id: p.url for p in portal_links(keywords="Data Analyst", city=None, posted_within=7,
                                               workplace=["remote", "hybrid", "onsite"], level=None, years=None,
                                               country="DE")}
    assert set(links) == {"linkedin", "indeed", "wellfound", "google"} and "de.indeed.com" in links["indeed"]
    assert "location=Germany" in links["linkedin"] and "geoId" not in links["linkedin"]
    assert "naukri" in portals_for("IN") and "naukri" not in portals_for("DE")

    assert parse_search("backend nyc remote", "US").locations == ["New York"]
    assert parse_search("phoenix developer", "IN").keywords == "phoenix developer"  # not a place here
    assert parse_search("phoenix developer", "US").locations == []  # the framework, not the city
    assert parse_search("phoenix developer", "US").keywords == "phoenix developer"
    assert parse_search("backend in phoenix", "US").locations == ["Phoenix"]
    assert parse_search("reading specialist", "GB").keywords == "reading specialist"
    assert parse_search("jobs in reading", "GB").locations == ["Reading"]
    assert parse_search("python anywhere", "GB").locations == ["Anywhere"]


def test_the_migration_adds_and_removes_remote_scope(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "world.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def columns() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute("pragma table_info(job_listings)")}

    alembic("upgrade", "head")
    assert "remote_scope" in columns()
    alembic("downgrade", "f5c7e9a1b3d4")
    assert "remote_scope" not in columns()
    alembic("upgrade", "head")


def test_without_a_saved_country_the_edge_decides_then_india(jobs: TestClient) -> None:  # noqa: F811
    import os

    insert(jobs, _listing(title="Backend Engineer Bengaluru"),
           _listing(title="Backend Engineer Austin", locations=["Austin, TX"], cities=["Austin"], country="US"))
    h = _register(jobs)
    make_resume(jobs, h)
    seen_in_us = {**h, "X-Orbit-Proxy-Secret": os.environ["ORBIT_PROXY_SECRET"], "X-Orbit-Client-Country": "US"}
    assert _feed(jobs, seen_in_us) == ["Backend Engineer Austin"]
    profile = jobs.get("/v1/jobs/profile", headers=seen_in_us).json()
    assert profile["cities"][:2] == ["Anywhere", "New York"] and "naukri" not in profile["portals"]
    # Nothing to go on (the desktop app, or a country the Worker didn't vouch for): India, as it always was.
    assert _feed(jobs, h) == ["Backend Engineer Bengaluru"]
    assert _feed(jobs, {**h, "X-Orbit-Client-Country": "US"}) == ["Backend Engineer Bengaluru"]
    profile = jobs.get("/v1/jobs/profile", headers=h).json()
    assert profile["cities"][:2] == ["India", "Bengaluru"] and "naukri" in profile["portals"]
    # A saved country wins over where the request came from.
    assert jobs.patch("/v1/auth/me/region", headers=h, json={"country": "IN"}).status_code == 200
    assert _feed(jobs, seen_in_us) == ["Backend Engineer Bengaluru"]


def test_the_search_box_says_entry_level_outside_india() -> None:
    assert parse_search("fresher python jobs", "IN").understood == ["Fresher"]
    assert parse_search("fresher python jobs").understood == ["Fresher"]  # no country: India's word, as always
    for q in ("fresher python jobs", "entry level python jobs"):
        parsed = parse_search(q, "US")
        assert parsed.understood == ["Entry level"] and parsed.level == "fresher" and parsed.keywords == "python"
