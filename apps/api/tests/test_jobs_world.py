"""Jobs AI worldwide: posts kept from every country, each user's feed for the country they apply in (India first),
remote posts by who they're open to, and search links, cities and searches for that country."""

from typing import Any

from fastapi.testclient import TestClient

from orbit_api.job_portal import geo
from orbit_api.job_portal.portals import portal_links, portals_for
from orbit_api.job_portal.postings import Posting, normalize
from orbit_api.job_portal.profile import JobPrefs, search_queries
from orbit_api.job_portal.search_parse import parse_search
from orbit_api.job_portal.sources.base import SearchQuery
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, make_resume  # noqa: F401  (the fixture)


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
