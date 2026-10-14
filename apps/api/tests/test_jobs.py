"""Jobs (orbit_api/job_portal): every source's parser on recorded answers, the cache and its refresh (stores, prunes,
backs off, single quota), ranking and filters, dedupe, the search box, "search on" links, the AI profile and fit
check (mock LLM, grounding, daily caps), tailor / prepare, the tracker and its ownership, and the migration.

Nothing here reaches the network: sources are fetched through tests/jobs_fixtures.transport (httpx.MockTransport).
"""

import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal import fit as fitcheck
from orbit_api.job_portal import ranking, refresh
from orbit_api.job_portal import routes as job_routes
from orbit_api.job_portal.companies import Board, parse_boards
from orbit_api.job_portal.http import FeedClient, RateLimited, SourceError
from orbit_api.job_portal.portals import portal_links
from orbit_api.job_portal.postings import (
    Posting,
    dedupe_key,
    experience_of,
    find_cities,
    listing_id,
    normalize,
    remote_region,
    snippet_of,
    text_of,
)
from orbit_api.job_portal.profile import from_resume, parse_profile, plain_title, years_of_experience
from orbit_api.job_portal.search_parse import parse_search
from orbit_api.job_portal.skills import SkillMatcher, listing_keywords
from orbit_api.job_portal.sources import allowed_hosts, enabled_sources, source_named
from orbit_api.job_portal.sources import ashby as ashby_src
from orbit_api.job_portal.sources import greenhouse as gh_src
from orbit_api.job_portal.sources import jobicy as jobicy_src
from orbit_api.job_portal.sources import lever as lever_src
from orbit_api.job_portal.sources import remoteok as rok_src
from orbit_api.job_portal.sources.adzuna import parse_job as adzuna_job
from orbit_api.job_portal.sources.base import SearchQuery
from orbit_api.job_portal.sources.jsearch import parse_job as jsearch_job
from orbit_api.models import JobApplication, JobFitCheck, JobListing, JobSourceState, ProviderRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.resumes.schema import Basics, Experience, ResumeData, SkillGroup
from tests import jobs_fixtures as fx
from tests.test_api import _register

GROWW = Board("greenhouse", "groww", "Groww")
FAMPAY = Board("lever", "fampay", "FamPay")
ATLAN = Board("ashby", "atlan", "Atlan")


def backend_resume(years: int = 3, city: str = "Bengaluru") -> ResumeData:
    start = datetime.now(UTC).year - years
    return ResumeData(
        basics=Basics(name="Arjun Rao", headline="Backend Engineer", location=f"{city}, Karnataka",
                      summary="Backend engineer building Python and Go services on Kubernetes."),
        experience=[Experience(title="Backend Engineer", company="PayNest", location=city,
                               start=f"Jan {start}", current=True, bullets=[
                                   "Built Go microservices on Kubernetes (EKS) handling 2M transactions a day",
                                   "Cut p95 latency from 900 ms to 250 ms with Redis caching and PostgreSQL tuning",
                                   "Moved batch jobs to Kafka consumers; wrote Terraform modules for AWS"])],
        skills=[SkillGroup(name="Languages", items=["Python", "Go", "SQL"]),
                SkillGroup(name="Platform", items=["Kubernetes", "Docker", "AWS", "Terraform", "Kafka", "Redis",
                                                   "PostgreSQL", "gRPC", "FastAPI"])])


def run(client: TestClient, fn: Any, *args: Any, **kw: Any) -> Any:
    return client.portal.call(lambda: fn(*args, **kw))  # type: ignore[union-attr]


async def _clear_jobs() -> None:
    async with sessionmaker()() as db:
        for model in (JobListing, JobSourceState, JobFitCheck):
            await db.execute(delete(model))
        await db.commit()


@pytest.fixture
def jobs(client: TestClient) -> Iterator[TestClient]:
    """The app with an empty job cache, and no ranked feed or public numbers remembered from another test."""
    run(client, _clear_jobs)
    ranking.clear_cache()
    job_routes.clear_stats_cache()
    yield client
    ranking.clear_cache()
    job_routes.clear_stats_cache()


def _listing(**kw: Any) -> JobListing:
    now = datetime.now(UTC)
    base: dict[str, Any] = dict(source="greenhouse", external_id=uuid.uuid4().hex, board="test", company="Acme",
                                title="Backend Engineer", locations=["Bengaluru, India"], cities=["Bengaluru"],
                                country="IN", workplace="onsite", employment_type="full_time", level=None,
                                exp_min=None, exp_max=None, posted_at=now - timedelta(hours=3),
                                url="https://example.com/jobs/1", apply_url="https://example.com/jobs/1/apply",
                                snippet="Build backend services.", description="Build backend services in Go.",
                                salary=None, keywords=["Go", "Python", "Kubernetes", "Kafka", "Java"], text_hash="x",
                                fetched_at=now)
    base.update(kw)
    base.setdefault("id", listing_id(base["source"], base["external_id"]))
    base.setdefault("dedupe_key", dedupe_key(base["company"], base["title"], base["cities"], base["workplace"]))
    return JobListing(**base)


def insert(client: TestClient, *rows: JobListing) -> list[str]:
    async def go() -> None:
        async with sessionmaker()() as db:
            db.add_all(rows)
            await db.commit()

    run(client, go)
    return [r.id for r in rows]


def make_resume(client: TestClient, h: dict[str, str], data: ResumeData | None = None) -> str:
    r = client.post("/v1/resumes", headers=h, json={"title": "My CV",
                                                    "data": (data or backend_resume()).model_dump(mode="json")})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


# ---- parsing each source ---------------------------------------------------------------------------------------------


def test_greenhouse_posts_are_decoded_placed_by_country_and_only_recent_ones_kept() -> None:
    posts = [p for j in fx.greenhouse()["jobs"] if (p := gh_src.parse_job(j, GROWW))]
    assert [p.title for p in posts] == ["Backend Engineer - Payments", "Assistant Manager - Internal Audit",
                                        "Senior Backend Engineer", "Data Engineer"]
    backend = posts[0]
    assert backend.company == "Groww" and "<" not in backend.description and "What you'll do" in backend.description
    assert "&lt;" not in backend.description and "Kubernetes" in backend.description
    rows = [r for p in posts if (r := normalize(p))]
    # Data Engineer was posted 45 days ago: too old to list. San Francisco's is kept, for people applying in the US.
    assert [r["title"] for r in rows] == ["Backend Engineer - Payments", "Assistant Manager - Internal Audit",
                                          "Senior Backend Engineer"]
    assert rows[2]["country"] == "US" and rows[2]["cities"] == ["San Francisco"] and rows[2]["remote_scope"] is None
    row = rows[0]
    assert row["cities"] == ["Bengaluru"] and row["country"] == "IN" and (row["exp_min"], row["exp_max"]) == (3, 5)
    assert row["snippet"].startswith("Design and build backend services")  # the role, not the company blurb
    assert rows[1]["employment_type"] == "full_time"


def test_lever_posts_join_their_lists_and_keep_workplace_salary_and_country() -> None:
    posts = [p for j in fx.lever() if (p := lever_src.parse_job(j, FAMPAY))]
    assert len(posts) == 3
    london = next(p for p in posts if p.title == "Account Executive")
    assert normalize(london)["country"] == "GB"  # type: ignore[index]
    sde = posts[0]
    assert sde.workplace == "hybrid" and sde.country == "IN" and sde.employment_type == "full_time"
    assert "Run Kubernetes clusters" in sde.description and "2-4 years" in sde.description
    assert sde.salary == "₹24L – ₹36L a year"
    row = normalize(sde)
    assert row is not None and row["level"] == "mid" and row["apply_url"].endswith("/apply")


def test_ashby_posts_skip_unlisted_ones_and_read_remote_and_internships() -> None:
    posts = [p for j in fx.ashby()["jobs"] if (p := ashby_src.parse_job(j, ATLAN))]
    assert [p.title for p in posts] == ["Senior Security Engineer - Corporate Security", "Software Engineering Intern"]
    assert posts[0].workplace == "remote" and posts[0].salary == "₹40L – ₹60L"
    assert posts[1].employment_type == "internship"
    assert normalize(posts[1])["level"] == "fresher"  # type: ignore[index]


def test_smartrecruiters_reads_text_for_new_posts_and_keeps_cached_text_for_known_ones() -> None:
    src = source_named("smartrecruiters")
    assert src is not None
    swiggy = Board("smartrecruiters", "swiggy", "Swiggy")

    async def fetch(known: set[str]) -> list[Posting]:
        async with FeedClient(allowed_hosts(), fx.transport(seen)) as http:
            from orbit_api.job_portal import companies

            real = companies.boards
            companies_boards = lambda ats=None: [swiggy]  # noqa: E731
            try:
                src_mod = sys.modules[src.__module__]
                src_mod.boards = companies_boards  # type: ignore[attr-defined]
                return await src.fetch(http, "swiggy", known)
            finally:
                src_mod.boards = real  # type: ignore[attr-defined]

    seen: list[httpx.Request] = []
    posts = asyncio.run(fetch(set()))
    assert len(posts) == 2 and all(not p.partial for p in posts)
    assert posts[0].company == "Swiggy" and posts[0].workplace == "hybrid"
    assert posts[0].description.startswith("Job Description\nBuild order services")  # the role before the blurb
    assert posts[0].url.endswith("-backend-engineer-ii")
    assert sum(1 for r in seen if r.url.path.endswith("/postings")) == 1 and len(seen) == 3
    seen.clear()
    posts = asyncio.run(fetch({"744000153719375", "744000153719376"}))
    assert len(seen) == 1 and all(p.partial for p in posts)  # no second call for posts already read
    assert posts[1].level is None  # "executive" in India is a junior title: not read as a level


def test_remote_feeds_credit_their_source_and_say_who_each_job_is_open_to() -> None:
    rok = [p for j in fx.remoteok()[1:] if (p := rok_src.parse_job(j))]
    assert [p.title for p in rok] == ["Platform Engineer", "Backend Engineer"]
    assert normalize(rok[0])["remote_scope"] == ["*"]  # type: ignore[index]
    assert normalize(rok[1])["remote_scope"] == ["US"]  # type: ignore[index]  # Boston: for people in the US
    assert rok[0].url.startswith("https://remoteok.com/remote-jobs/") and "–" in rok[0].description
    assert "Please mention" not in rok[0].description and "RMjQ" not in rok[0].description
    assert normalize(rok[0]) is not None
    jobicy = [r for j in fx.jobicy("apac")["jobs"] if (p := jobicy_src.parse_job(j, "apac")) and (r := normalize(p))]
    assert [r["title"] for r in jobicy][:1] == ["Platform Engineer"]
    assert [r["remote_scope"] for r in jobicy][1:] == [["AU"]]  # Australia only
    assert jobicy[0]["url"] == "https://jobicy.com/jobs/1546-apac-platform" == jobicy[0]["apply_url"]
    for sid in ("himalayas", "remoteok", "jobicy"):
        src = source_named(sid)
        assert src is not None and src.attribution is not None and src.attribution.url.startswith("https://")


def test_himalayas_searches_by_title_for_jobs_open_to_india() -> None:
    src = source_named("himalayas")
    assert src is not None
    seen: list[httpx.Request] = []

    async def go() -> list[Posting]:
        async with FeedClient(allowed_hosts(), fx.transport(seen)) as http:
            return await src.search(http, SearchQuery("backend engineer", "India", 7))

    posts = asyncio.run(go())
    assert len(posts) == 2 and all(p.open_to == ["IN"] and p.workplace == "remote" for p in posts)
    assert parse_qs(urlsplit(str(seen[0].url)).query) == {"q": ["backend engineer"], "country": ["IN"],
                                                          "sort": ["recent"], "page": ["1"]}
    assert posts[1].locations == ["Remote (India)"] and normalize(posts[1])["country"] == "IN"  # type: ignore[index]


def test_adzuna_and_jsearch_parse_and_link_through_their_own_or_the_employers_url() -> None:
    a = adzuna_job(fx.adzuna()["results"][0], "backend developer|Bengaluru|7")
    assert a is not None and a.title == "Backend Developer" and a.url.startswith("https://www.adzuna.in/land/")
    assert normalize(a)["cities"] == ["Bengaluru"]  # type: ignore[index]
    j = jsearch_job(fx.jsearch()["data"][0], "q")
    assert j is not None and j.apply_url == "https://careers.zerodha.com/backend-go"  # the direct option wins


def test_adzuna_and_jsearch_are_off_without_keys_and_on_with_them(monkeypatch: pytest.MonkeyPatch) -> None:
    ids = {s.id for s in enabled_sources()}
    assert "adzuna" not in ids and "jsearch" not in ids
    assert {"greenhouse", "lever", "ashby", "smartrecruiters", "himalayas", "remoteok", "jobicy"} <= ids
    s = get_settings()
    monkeypatch.setattr(s, "adzuna_app_id", "id")
    monkeypatch.setattr(s, "adzuna_app_key", __import__("pydantic").SecretStr("key"))
    monkeypatch.setattr(s, "jsearch_key", __import__("pydantic").SecretStr("key"))
    monkeypatch.setattr(s, "jobs_sources_off", "remoteok")
    ids = {x.id for x in enabled_sources()}
    assert {"adzuna", "jsearch"} <= ids and "remoteok" not in ids


def test_the_feed_client_only_calls_job_source_hosts_and_backs_off_on_429() -> None:
    async def go(url: str, fail: dict[str, int] | None = None) -> Any:
        async with FeedClient(allowed_hosts(), fx.transport(fail=fail)) as http:
            return await http.get_json(url)

    for url in ("https://169.254.169.254/latest/meta-data", "http://boards-api.greenhouse.io/v1/boards/x/jobs",
                "https://evil.example/jobs"):
        with pytest.raises(SourceError):
            asyncio.run(go(url))
    with pytest.raises(RateLimited) as limited:
        asyncio.run(go("https://remoteok.com/api", {"remoteok.com": 429}))
    assert limited.value.retry_after_s == 120


# ---- reading posts ------------------------------------------------------------------------------------------------


def test_places_remote_regions_and_experience_are_read_the_way_indian_posts_write_them() -> None:
    assert find_cities("Bangalore / Gurgaon, Haryana") == ["Bengaluru", "Gurugram"]
    assert find_cities("Columbus, IN") == []
    assert remote_region("Remote - India") == "india" and remote_region("Remote (APAC)") == "open"
    assert remote_region("Remote - US only") == "elsewhere" and remote_region("Remote") is None
    assert experience_of("SDE 2 - Platform", "") == ("mid", None, None)
    assert experience_of("Backend Engineer", "You have 3-5 years of experience")[1:] == (3, 5)
    assert experience_of("Staff Engineer", "5+ years")[1] == 7  # staff is well past senior, whatever it says
    assert experience_of("Graduate Engineer Trainee", "")[0] == "fresher"
    assert text_of("&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;") == "Hi & bye"
    assert len(snippet_of("word " * 300)) <= 501


def test_listing_keywords_are_skills_not_boilerplate_or_the_companys_name() -> None:
    kw = listing_keywords("Backend Engineer", "CRED is hiring. You'll work with Python, Kafka and Kubernetes on AWS. "
                                              "Great communication. CTC 30 LPA. Experience with Spring Boot.", "CRED")
    assert {"Python", "Kafka", "Kubernetes", "AWS", "Spring Boot"} <= set(kw)
    assert not {"CRED", "CTC", "LPA", "Communication"} & set(kw)


def test_skills_read_the_same_on_every_card_once_each_and_not_the_companys_own_products() -> None:
    kw = listing_keywords("SDE 2 Infra", "Run CI/CD for FamCard. You know GOLANG or Go, Ci/Cd, JAVA and "
                                         "Postgres / PostgreSQL. Experience with Kubernetes (k8s). Recruiting "
                                         "and compliance teams. Subject to AEDT notices.", "FamPay")
    assert "CI/CD" in kw and "Ci/Cd" not in kw and "Java" in kw and "JAVA" not in kw
    assert kw.count("Go") == 1 and "Golang" not in kw and "GOLANG" not in kw  # synonyms are one skill
    assert sum(k in ("PostgreSQL", "Postgres") for k in kw) == 1 and "k8s" not in kw
    assert not {"FamCard", "AEDT", "Recruiting", "Compliance"} & set(kw)
    # A company whose first word is an everyday one doesn't lose the skills that start with it.
    assert "Databricks" in listing_keywords("Data Engineer", "PySpark on Databricks and Airflow.", "Data Axle")
    # "Go" on a resume counts only as the language, written as such.
    assert SkillMatcher("Built Go services", []).has("Golang")
    assert not SkillMatcher("Ready to go live with the team", []).has("Go")


# ---- the cache and its refresh ---------------------------------------------------------------------------------------


def _states(client: TestClient) -> dict[tuple[str, str], JobSourceState]:
    async def go() -> dict[tuple[str, str], JobSourceState]:
        async with sessionmaker()() as db:
            return {(s.source, s.key): s for s in (await db.scalars(select(JobSourceState))).all()}

    return run(client, go)  # type: ignore[no-any-return]


def _stored(client: TestClient, source: str) -> list[JobListing]:
    async def go() -> list[JobListing]:
        async with sessionmaker()() as db:
            return list((await db.scalars(select(JobListing).where(JobListing.source == source))).all())

    return run(client, go)  # type: ignore[no-any-return]


def test_a_board_refresh_stores_its_posts_and_drops_the_ones_taken_down(jobs: TestClient,
                                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    src = source_named("greenhouse")
    assert src is not None
    monkeypatch.setattr(gh_src, "boards", lambda ats=None: [GROWW])
    n = run(jobs, refresh.refresh_source, src, keys=["groww"], delay_s=0, client_transport=fx.transport())
    assert n == 3
    stored = {r.title: r for r in _stored(jobs, "greenhouse")}
    assert set(stored) == {"Backend Engineer - Payments", "Assistant Manager - Internal Audit",
                           "Senior Backend Engineer"}
    assert {"Go", "Python", "Kubernetes", "Kafka"} <= set(stored["Backend Engineer - Payments"].keywords)
    assert _states(jobs)[("greenhouse", "groww")].last_success_at is not None
    # The audit job is taken down: the next fetch removes it.
    trimmed = fx.greenhouse()
    trimmed["jobs"] = trimmed["jobs"][:1]
    run(jobs, refresh.refresh_source, src, keys=["groww"], delay_s=0,
        client_transport=fx.transport(override={"boards-api.greenhouse.io": trimmed}))
    assert [r.title for r in _stored(jobs, "greenhouse")] == ["Backend Engineer - Payments"]


def test_boards_are_fetched_at_most_two_at_a_time_across_sources(jobs: TestClient) -> None:
    running = peak = 0

    class Slow:
        def __init__(self, source_id: str) -> None:
            self.id = source_id

        async def fetch(self, http: Any, key: str, known: set[str]) -> list[Posting]:
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.05)
            running -= 1
            return []

    async def first_refresh_of_everything() -> None:
        async with FeedClient(allowed_hosts(), fx.transport()) as http:
            await asyncio.gather(*(refresh._refresh_board(Slow(s), http, "board")  # type: ignore[arg-type]
                                   for s in ("greenhouse", "lever", "ashby", "smartrecruiters", "remoteok")))

    run(jobs, first_refresh_of_everything)
    assert peak == refresh.BOARD_SLOTS == 2


def test_a_failed_or_rate_limited_fetch_backs_off_and_keeps_the_cache(jobs: TestClient,
                                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    src = source_named("greenhouse")
    assert src is not None
    monkeypatch.setattr(gh_src, "boards", lambda ats=None: [GROWW])
    run(jobs, refresh.refresh_source, src, keys=["groww"], delay_s=0, client_transport=fx.transport())
    run(jobs, refresh.refresh_source, src, keys=["groww"], delay_s=0,
        client_transport=fx.transport(fail={"boards-api.greenhouse.io": 500}))
    state = _states(jobs)[("greenhouse", "groww")]
    assert state.failures == 1 and "HTTP 500" in (state.last_error or "") and state.retry_after is not None
    assert len(_stored(jobs, "greenhouse")) == 3  # what was cached is still served
    assert not refresh.due(state, src.ttl, datetime.now(UTC))  # backing off
    run(jobs, refresh.refresh_source, src, keys=["groww"], delay_s=0,
        client_transport=fx.transport(fail={"boards-api.greenhouse.io": 429}))
    state = _states(jobs)[("greenhouse", "groww")]
    retry = refresh.aware(state.retry_after)
    assert state.failures == 2 and retry is not None and retry - datetime.now(UTC) < timedelta(seconds=125)


def test_a_partial_listing_keeps_the_text_already_cached(jobs: TestClient) -> None:
    posting = Posting(source="smartrecruiters", external_id="1", board="swiggy", company="Swiggy",
                      title="Backend Engineer II", url="https://jobs.smartrecruiters.com/Swiggy/1-backend",
                      apply_url="https://jobs.smartrecruiters.com/Swiggy/1-backend?oga=true",
                      posted_at=fx.ago(hours=2), locations=["Bengaluru, KA, India"],
                      description="Build order services in Go with Kafka.")
    run(jobs, refresh._ingest, "smartrecruiters", "swiggy", [posting])
    bare = Posting(**{**posting.__dict__, "description": "", "partial": True,
                      "url": "https://jobs.smartrecruiters.com/Swiggy/1", "apply_url": "https://jobs.smartrecruiters.com/Swiggy/1"})
    run(jobs, refresh._ingest, "smartrecruiters", "swiggy", [bare])
    row = _stored(jobs, "smartrecruiters")[0]
    assert row.description.startswith("Build order services") and row.url.endswith("1-backend")
    assert "Kafka" in row.keywords


def test_search_sources_are_shared_and_stop_at_90_percent_of_their_quota(jobs: TestClient,
                                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "adzuna_app_id", "id")
    monkeypatch.setattr(s, "adzuna_app_key", __import__("pydantic").SecretStr("key"))
    adzuna = source_named("adzuna")
    assert adzuna is not None
    seen: list[httpx.Request] = []
    query = SearchQuery("backend developer", "Bengaluru", 7)
    run(jobs, refresh.refresh_searches, adzuna, [query, query], client_transport=fx.transport(seen))
    assert len(seen) == 1 and seen[0].url.params["where"] == "Bengaluru"
    assert [r.title for r in _stored(jobs, "adzuna")] == ["Backend Developer"]
    run(jobs, refresh.refresh_searches, adzuna, [query], client_transport=fx.transport(seen))
    assert len(seen) == 1  # fresh: nobody calls Adzuna again for the same search
    quota = _states(jobs)[("adzuna", refresh.QUOTA_KEY)]
    assert quota.day_calls == 1 and quota.month_calls == 1

    async def fill(day: int, month: int) -> None:
        async with sessionmaker()() as db:
            row = await db.scalar(select(JobSourceState).where(JobSourceState.source == "adzuna",
                                                               JobSourceState.key == refresh.QUOTA_KEY))
            assert row is not None
            row.day_calls, row.month_calls = day, month
            await db.commit()

    async def take() -> bool:
        async with sessionmaker()() as db:
            return await refresh.take_quota(db, adzuna, 1)

    run(jobs, fill, 224, 0)
    assert run(jobs, take) is True  # the 225th of 250 is the last one under 90%
    assert run(jobs, take) is False
    run(jobs, fill, 0, 2_250)
    assert run(jobs, take) is False  # the month's 90% too
    jsearch = source_named("jsearch")
    assert jsearch is not None
    monkeypatch.setattr(s, "jsearch_monthly_budget", 0)

    async def take_jsearch() -> bool:
        async with sessionmaker()() as db:
            return await refresh.take_quota(db, jsearch, 1)

    assert run(jobs, take_jsearch) is False  # a budget of 0 is no calls at all


def test_the_feed_never_waits_for_a_refresh_and_refreshes_each_source_once(jobs: TestClient,
                                                                           monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def slow(source: Any, **_: Any) -> int:
        calls.append(source.id)
        await asyncio.sleep(0.2)
        return 0

    monkeypatch.setattr(get_settings(), "jobs_refresh", True)
    monkeypatch.setattr(refresh, "refresh_source", slow)
    monkeypatch.setattr(refresh, "refresh_searches", lambda *a, **k: asyncio.sleep(0.2))
    h = _register(jobs)
    for _ in range(3):
        r = jobs.get("/v1/jobs/feed", headers=h)
        assert r.status_code == 200 and r.json()["refreshing"] is True
    boards = sorted(set(calls))
    assert boards == sorted(calls) and "greenhouse" in boards  # one background refresh per source, not three
    run(jobs, asyncio.sleep, 0.3)


# ---- ranking ------------------------------------------------------------------------------------------------------


def _row(**kw: Any) -> ranking.Row:
    return ranking.row_of(_listing(**kw))


def _search(**kw: Any) -> ranking.Search:
    base: dict[str, Any] = dict(titles=["Backend Engineer", "Software Engineer"], skills=["Go", "Python"],
                                locations=["Bengaluru"], workplace=["remote", "hybrid", "onsite"], level="mid",
                                years=3.0, job_types=[], days=7)
    base.update(kw)
    return ranking.Search(**base)


MATCHER = SkillMatcher("Python Go Kubernetes Kafka PostgreSQL Redis AWS Docker Terraform", ["Go", "Python"])


def test_ranking_puts_the_closest_role_first_and_leaves_out_unrelated_ones() -> None:
    rows = [_row(title="Backend Engineer - Payments", keywords=["Go", "Kubernetes", "Kafka", "Java"]),
            _row(title="Software Engineer II", keywords=["Java", "Spring", "Kafka"]),
            _row(title="Accountant", keywords=["Tally", "GST", "Excel"]),
            _row(title="Backend Engineering Manager", keywords=["Go", "Kubernetes"]),
            _row(title="Android Engineer", keywords=["Kotlin", "Android"])]
    out = ranking.rank(rows, _search(), MATCHER)
    titles = [next(r.title for r in rows if r.id == m.id) for m in out]
    assert titles[0] == "Backend Engineer - Payments" and "Accountant" not in titles
    assert titles.index("Software Engineer II") < titles.index("Backend Engineering Manager")
    best = out[0]
    assert best.matched == ["Go", "Kubernetes", "Kafka"] and best.missing == ["Java"] and 70 <= best.score <= 99


def test_filters_place_work_mode_recency_type_seniority_sources_and_exclusions() -> None:
    old = datetime.now(UTC) - timedelta(days=10)
    rows = {
        "here": _row(title="Backend Engineer"),
        "pune": _row(title="Backend Engineer", company="P", cities=["Pune"], locations=["Pune"]),
        "remote": _row(title="Backend Engineer", company="R", workplace="remote", cities=[], country=None),
        "old": _row(title="Backend Engineer", company="O", posted_at=old),
        "intern": _row(title="Backend Engineering Intern", company="I", employment_type="internship"),
        "staff": _row(title="Staff Backend Engineer", company="S", exp_min=7, level="senior"),
        "lever": _row(title="Backend Engineer", company="L", source="lever"),
        "crypto": _row(title="Backend Engineer", company="Crypto Inc"),
    }
    by_id = {r.id: k for k, r in rows.items()}

    def shown(**kw: Any) -> set[str]:
        return {by_id[m.id] for m in ranking.rank(rows.values(), _search(**kw), MATCHER)}

    assert shown() == {"here", "remote", "lever", "crypto"}
    assert shown(workplace=["remote"]) == {"remote"}
    assert shown(locations=["Pune"]) >= {"pune", "remote"} and "here" not in shown(locations=["Pune"])
    assert shown(locations=["India"]) >= {"here", "pune"}
    assert "old" in shown(days=30)
    assert "intern" in shown(level="fresher", years=0.5) and "staff" not in shown(level="fresher", years=0.5)
    assert "staff" in shown(level="senior", years=8)
    assert "lever" not in shown(sources_off=["lever"])
    assert "crypto" not in shown(exclude=["crypto"])


def test_a_post_asking_for_skills_the_resume_has_none_of_isnt_a_match() -> None:
    sap = _row(title="SAP ABAP & Backend Developer", keywords=["SAP", "ABAP", "OData", "RICEF", "CDS"])
    thin = _row(title="Backend Software Engineer", company="B", keywords=["System Design"])
    out = {m.id for m in ranking.rank([sap, thin], _search(), MATCHER)}
    assert sap.id not in out and thin.id in out  # a post that says little is still judged by its title
    # Without a resume (nothing to compare), or when the user searched for it, it's shown.
    assert sap.id in {m.id for m in ranking.rank([sap], _search(skills=[]), SkillMatcher("", []))}
    assert sap.id in {m.id for m in ranking.rank([sap], _search(keywords="abap"), MATCHER)}


def test_one_companys_many_openings_dont_fill_the_first_page() -> None:
    agency = [_row(title=f"Backend Engineer {n}", company="Xperteez", external_id=f"x{n}") for n in range(6)]
    others = [_row(title="Backend Engineer", company=c, keywords=["Go", "Python", "Kafka"]) for c in ("P", "Q")]
    out = ranking.rank([*agency, *others], _search(), MATCHER)
    first = [m.company_key for m in out[:4]]
    assert first.count("xperteez") <= 2 and {"p", "q"} <= set(first)
    newest = ranking.rank([*agency, *others], _search(), MATCHER, sort="newest")  # (not spread)
    assert {m.id: m.score for m in out} == {m.id: m.score for m in newest}  # only the order moves, not the scores


def test_remote_posts_titled_for_another_language_market_and_pictographs_are_tidied() -> None:
    base = Posting(source="himalayas", external_id="1", board="q", company="XK", title="DESARROLLADOR BACKEND JAVA",
                   url="https://himalayas.app/j/1", apply_url="https://himalayas.app/j/1", posted_at=fx.ago(hours=1),
                   locations=["Remote (worldwide)"], workplace="remote", open_to_india=True)
    assert normalize(base) is None
    tidy = normalize(Posting(**{**base.__dict__, "title": "🌎 Backend Java Developer - Remote"}))
    assert tidy is not None and tidy["title"] == "Backend Java Developer - Remote"


def test_the_same_job_twice_is_shown_once_from_the_companys_own_board() -> None:
    feed_copy = _row(source="himalayas", title="Backend Developer", company="Groww Pvt Ltd", workplace="remote",
                     cities=[], country="IN")
    own = _row(source="greenhouse", title="Backend Engineer", company="Groww", workplace="remote", cities=[])
    assert feed_copy.dedupe_key == own.dedupe_key
    out = ranking.rank([feed_copy, own], _search(), MATCHER)
    assert [m.id for m in out] == [own.id]


def test_newest_first_sorts_by_date_among_the_matches() -> None:
    a = _row(title="Software Engineer", company="A", posted_at=datetime.now(UTC) - timedelta(hours=1))
    b = _row(title="Backend Engineer", company="B", posted_at=datetime.now(UTC) - timedelta(days=2))
    assert ranking.rank([a, b], _search(), MATCHER)[0].id == b.id
    assert ranking.rank([a, b], _search(), MATCHER, sort="newest")[0].id == a.id


def test_the_search_box_is_read_into_filters_and_keywords() -> None:
    p = parse_search("remote React jobs in Bangalore, 2 years")
    assert (p.keywords, p.workplace, p.locations, p.years) == ("react", ["remote"], ["Bengaluru"], 2.0)
    assert p.understood == ["Remote", "2 years", "Bengaluru"]
    p = parse_search("python internships in pune posted today")
    assert p.job_types == ["internship"] and p.level == "fresher" and p.posted_within == 1 and p.keywords == "python"
    p = parse_search("golang jobs in the last 30 days, gurgaon or noida")
    assert (p.keywords, p.posted_within, p.locations) == ("golang", 30, ["Gurugram", "Noida"])
    # "contract" in a title is the job, not a filter that hides every full-time role.
    titled = parse_search("smart contract engineer")
    assert titled.job_types == [] and titled.keywords == "smart contract engineer"
    hired = parse_search("freelance react on contract")
    assert hired.job_types == ["contract"] and hired.keywords == "react"
    # And the word is not thrown away when matching, or "contract engineer" would be every engineer.
    smart = _row(title="Smart Contract Engineer", keywords=["Solidity"])
    plain = _row(title="Software Engineer", keywords=["Java"])
    found = ranking.rank([smart, plain], _search(keywords="smart contract", titles=[], skills=[]), MATCHER)
    assert [m.id for m in found] == [smart.id]
    react = _row(title="Frontend Engineer", keywords=["React", "TypeScript"], workplace="remote", cities=[])
    other = _row(title="Backend Engineer", company="X", workplace="remote", cities=[])
    out = ranking.rank([react, other], _search(keywords="react", workplace=["remote"]), MATCHER)
    assert [m.id for m in out] == [react.id]


# ---- "search on" links -------------------------------------------------------------------------------------------


def test_portal_links_open_each_sites_own_prefilled_search() -> None:
    links = {p.id: p.url for p in portal_links(keywords="Python Developer", city="Bengaluru", posted_within=1,
                                               workplace=["remote", "hybrid"], level="mid", years=3)}
    assert links["linkedin"] == ("https://www.linkedin.com/jobs/search/?keywords=Python+Developer&sortBy=DD"
                                 "&f_TPR=r86400&location=Bengaluru%2C+India&f_WT=2%2C3&f_E=3%2C4")
    assert links["naukri"] == ("https://www.naukri.com/python-developer-jobs-in-bangalore?k=Python+Developer"
                               "&l=bangalore&experience=3&jobAge=1&wfhType=2&wfhType=3")
    assert links["indeed"] == "https://in.indeed.com/jobs?q=Python+Developer&l=Bengaluru&sort=date&fromage=1"
    assert links["foundit"] == ("https://www.foundit.in/srp/results?query=Python+Developer&locations=Bengaluru"
                                "&jobFreshness=1&experienceRanges=2~5")
    assert links["instahyre"] == "https://www.instahyre.com/python-developer-jobs-in-bangalore/"
    assert links["cutshort"] == "https://cutshort.io/jobs/python-developer-jobs-in-bangalore-bengaluru"
    assert links["hirist"] == "https://www.hirist.tech/k/python-developer-jobs-in-bangalore"
    assert links["internshala"] == "https://internshala.com/jobs/python-django-jobs-in-bangalore/"
    assert links["wellfound"] == "https://wellfound.com/role/l/python-developer/bangalore"
    assert links["google"] == "https://www.google.com/search?q=Python+Developer+jobs+in+Bengaluru&udm=8"
    india = {p.id: p.url for p in portal_links(keywords="Marine Biologist Field Lead", city=None,
                                               posted_within=30, workplace=["remote"], level="fresher", years=None,
                                               portals=["linkedin", "internshala", "wellfound", "indeed"])}
    assert list(india) == ["linkedin", "indeed", "wellfound", "internshala"]  # chosen ones, display order
    assert "geoId=102713980" in india["linkedin"] and "f_TPR=r2592000" in india["linkedin"]
    assert india["indeed"] == "https://in.indeed.com/jobs?q=Marine+Biologist+Field+Lead&l=Remote&sort=date"
    assert india["internshala"] == "https://internshala.com/internships/"  # no category fits: the plain list
    assert india["wellfound"] == "https://wellfound.com/location/india"  # a long title has no role page


# ---- the AI: profile from a resume -----------------------------------------------------------------------------------


def test_years_and_a_profile_without_the_ai_come_from_the_resume_itself() -> None:
    data = backend_resume(years=3)
    assert 2.5 <= years_of_experience(data) <= 3.9
    s = from_resume(data)
    assert s.titles == ["Backend Engineer"] and s.skills[:3] == ["Python", "Go", "SQL"] and s.locations == ["Bengaluru"]
    assert s.level in ("junior", "mid") and s.by == "resume"
    assert plain_title("Senior Backend Engineer (Payments) at Acme") == "Backend Engineer"


def test_the_ais_profile_keeps_only_skills_the_resume_shows() -> None:
    answer = json.dumps({"titles": ["Senior Backend Engineer", "Platform Engineer", "Go Developer"],
                         "seniority": "mid", "skills": ["Go", "Kubernetes", "Rust", "Java", "Kafka"],
                         "locations": ["Bangalore"]})
    s = parse_profile(answer, backend_resume())
    assert s.titles == ["Backend Engineer", "Platform Engineer", "Go Developer"] and s.by == "ai"
    assert "Rust" not in s.skills and "Java" not in s.skills and s.skills[:3] == ["Go", "Kubernetes", "Kafka"]
    assert s.locations == ["Bengaluru"] and s.level == "mid"


def test_profile_suggest_fills_the_profile_caches_per_resume_and_has_a_daily_cap(
        jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _register(jobs)
    assert jobs.post("/v1/jobs/profile/suggest", headers=h, json={}).status_code == 422  # no resume yet
    rid = make_resume(jobs, h)
    before = jobs.get("/v1/jobs/profile", headers=h).json()
    assert before["saved"] is False and before["prefs"]["titles"] == ["Backend Engineer"]  # from the resume
    r = jobs.post("/v1/jobs/profile/suggest", headers=h, json={"resume_id": rid})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["saved"] is True and p["suggested"]["by"] == "ai" and p["resume"]["id"] == rid
    assert p["prefs"]["titles"][0] == "Backend Engineer" and "Kubernetes" in p["prefs"]["skills"]
    assert p["prefs"]["locations"] == ["Bengaluru"] and p["ai_left"] == 4

    def ai_calls() -> int:
        async def go() -> int:
            async with sessionmaker()() as db:
                return int(await db.scalar(select(func.count()).select_from(ProviderRequest).where(
                    ProviderRequest.request_type == "job_profile")) or 0)
        return run(jobs, go)  # type: ignore[no-any-return]

    calls = ai_calls()
    again = jobs.post("/v1/jobs/profile/suggest", headers=h, json={})
    assert again.status_code == 200 and ai_calls() == calls  # same resume content: cached, no AI call
    monkeypatch.setattr(get_settings(), "jobs_profile_daily", 1)
    data = backend_resume()
    data.skills[0].items.append("Rust")
    assert jobs.put(f"/v1/resumes/{rid}", headers=h, json={"title": "My CV", "data": data.model_dump(mode="json")})\
        .status_code == 200
    capped = jobs.post("/v1/jobs/profile/suggest", headers=h, json={}).json()
    assert ai_calls() == calls and capped["suggested"]["by"] == "resume" and "today" in capped["note"]
    assert "Rust" in capped["prefs"]["skills"]  # still filled from the resume, without the AI


def test_the_profile_can_be_edited_and_is_validated(jobs: TestClient) -> None:
    h = _register(jobs)
    prefs = {"titles": ["  Data Analyst ", "data analyst", "Business Analyst"], "skills": ["SQL", "Excel"],
             "locations": ["bangalore", "anywhere in india"], "workplace": ["remote"], "level": "junior",
             "years": 1.5, "job_types": ["full_time"], "posted_within": 3, "sources_off": ["remoteok", "nope"],
             "portals": ["naukri", "linkedin", "bogus"], "exclude": ["sales"]}
    r = jobs.put("/v1/jobs/profile", headers=h, json={"prefs": prefs})
    assert r.status_code == 200, r.text
    saved = r.json()["prefs"]
    assert saved["titles"] == ["Data Analyst", "Business Analyst"] and saved["locations"] == ["Bengaluru", "India"]
    assert saved["sources_off"] == ["remoteok"] and saved["portals"] == ["naukri", "linkedin"]
    assert jobs.put("/v1/jobs/profile", headers=h, json={"prefs": {**prefs, "posted_within": 5}}).status_code == 422
    assert jobs.put("/v1/jobs/profile", headers=h, json={"prefs": {}, "resume_id": str(uuid.uuid4())}).status_code \
        == 404


# ---- the feed endpoint --------------------------------------------------------------------------------------------


def test_the_feed_ranks_cached_jobs_for_the_resume_with_attribution_and_portal_links(jobs: TestClient) -> None:
    h = _register(jobs)
    make_resume(jobs, h)
    ids = insert(jobs,
                 _listing(title="Backend Engineer - Payments", company="Groww"),
                 _listing(source="himalayas", title="Senior Software Engineer (Python)", company="Opinov8",
                          workplace="remote", cities=[], country=None, locations=["Remote (worldwide)"],
                          url="https://himalayas.app/companies/opinov8/jobs/sse", keywords=["Python", "AWS"]),
                 _listing(source="remoteok", title="Accountant", company="Numbers", workplace="remote", cities=[],
                          keywords=["Tally"]))
    r = jobs.get("/v1/jobs/feed", headers=h)
    assert r.status_code == 200, r.text
    feed = r.json()
    assert [j["id"] for j in feed["items"]] == ids[:2] and feed["total"] == 2 and feed["has_more"] is False
    first, second = feed["items"]
    assert first["direct"] is True and first["attribution"] is None
    assert first["match"]["matched"][:3] == ["Go", "Python", "Kubernetes"] and first["match"]["missing"] == ["Java"]
    assert second["attribution"] == {"label": "Himalayas", "url": "https://himalayas.app", "large": False}
    assert {p["id"] for p in feed["portals"]} == {"linkedin", "naukri", "indeed", "foundit", "instahyre", "google"}
    assert "keywords=Backend+Engineer" in feed["portals"][0]["url"] and feed["refreshing"] is False
    searched = jobs.get("/v1/jobs/feed", headers=h, params={"q": "remote python jobs"}).json()
    assert [j["id"] for j in searched["items"]] == [ids[1]] and searched["understood"] == ["Remote"]
    assert "keywords=python" in searched["portals"][0]["url"]
    assert jobs.get("/v1/jobs/feed", headers=h, params={"page_size": 1}).json()["has_more"] is True
    assert jobs.get("/v1/jobs/feed", headers=h, params={"sort": "random"}).status_code == 422


def test_without_a_resume_the_feed_still_browses_and_says_so(jobs: TestClient) -> None:
    h = _register(jobs)
    insert(jobs, _listing(title="Backend Engineer"))
    feed = jobs.get("/v1/jobs/feed", headers=h).json()
    assert feed["resume"] is None and feed["has_profile"] is False and len(feed["items"]) == 1


# ---- the AI: fit check -----------------------------------------------------------------------------------------------


def test_a_fit_check_is_grounded_in_the_resume() -> None:
    answer = json.dumps({
        "verdict": "Strong", "summary": "You fit well.",
        "why": ["You built Go microservices on Kubernetes at PayNest, which this Groww role asks for.",
                "You led Rust rewrites of their ledger.", "You grew revenue by 45%."],
        "gaps": ["The post asks for Java."],
        "tweaks": [{"change": "Lead with your Kafka work.", "why": "The post mentions Kafka twice."},
                   {"change": "Add Spring Boot to your skills.", "why": "The post wants it."},
                   {"change": "Add Java if you have used it.", "why": "It's a must-have."}]})
    job = {"title": "Backend Engineer", "company": "Groww", "location": "Bengaluru",
           "text": "Go, Kubernetes, Kafka, Java and Spring Boot."}
    check = fitcheck.parse_fit(answer, backend_resume(), job, score=80, matched=["Go", "Kubernetes"])
    assert check.why == ["You built Go microservices on Kubernetes at PayNest, which this Groww role asks for."]
    assert [t.change for t in check.tweaks] == ["Lead with your Kafka work.", "Add Java if you have used it."]
    assert check.verdict == "Strong"
    weak = fitcheck.parse_fit(answer, backend_resume(), job, score=30, matched=[])
    assert weak.verdict == "Good"  # "Strong" for a post the resume barely touches is lowered


def test_fit_checks_are_free_cached_and_capped_per_day(jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _register(jobs)
    a, b, c = insert(jobs, _listing(title="Backend Engineer"), _listing(title="Platform Engineer", company="B"),
                     _listing(title="Go Developer", company="C"))
    assert jobs.post(f"/v1/jobs/listings/{a}/fit", headers=h).status_code == 422  # no resume yet
    make_resume(jobs, h)
    monkeypatch.setattr(get_settings(), "jobs_fit_daily", 2)
    first = jobs.post(f"/v1/jobs/listings/{a}/fit", headers=h)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["cached"] is False and body["left"] == 1 and body["check"]["verdict"] == "Good"
    assert body["check"]["why"] and "Java" in body["check"]["gaps"][0]  # the mock names the first missing skill
    repeat = jobs.post(f"/v1/jobs/listings/{a}/fit", headers=h).json()
    assert repeat["cached"] is True and repeat["left"] == 1  # the same job and resume: free, instant
    assert jobs.post(f"/v1/jobs/listings/{b}/fit", headers=h).json()["left"] == 0
    capped = jobs.post(f"/v1/jobs/listings/{c}/fit", headers=h)
    assert capped.status_code == 429 and capped.json()["detail"]["code"] == "fit_check_limit"
    detail = jobs.get(f"/v1/jobs/listings/{a}", headers=h).json()
    assert detail["fit"]["verdict"] == "Good" and detail["job"]["match"]["score"] > 0
    assert jobs.post(f"/v1/jobs/listings/{uuid.uuid4()}/fit", headers=h).status_code == 404


def test_the_admin_has_no_daily_fit_check_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_signup_approval import _client

    email = f"jobs-admin-{uuid.uuid4().hex[:6]}@example.com"
    with pytest.MonkeyPatch.context() as mp:
        gen = _client(mp, ORBIT_ADMIN_EMAIL=email)
        c = next(gen)
        try:
            r = c.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            c.cookies.clear()
            make_resume(c, h)
            monkeypatch.setattr(get_settings(), "jobs_fit_daily", 0)
            lid = insert(c, _listing(title="Backend Engineer", company=f"Admin {uuid.uuid4().hex[:4]}"))[0]
            r = c.post(f"/v1/jobs/listings/{lid}/fit", headers=h)
            assert r.status_code == 200 and r.json()["left"] is None, r.text
        finally:
            gen.close()
    get_settings.cache_clear()


def test_a_down_ai_is_a_503_and_spends_nothing(jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.llm.base import LLMError

    class Down(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            raise LLMError("down", "provider down", retryable=True)

    h = _register(jobs)
    make_resume(jobs, h)
    lid = insert(jobs, _listing(title="Backend Engineer"))[0]
    monkeypatch.setattr(job_routes, "get_llm_provider", lambda: Down())
    assert jobs.post(f"/v1/jobs/listings/{lid}/fit", headers=h).status_code == 503
    profile = jobs.post("/v1/jobs/profile/suggest", headers=h, json={}).json()
    assert profile["suggested"]["by"] == "resume" and "couldn't" in profile["note"]  # falls back, never fails


# ---- tailor and prepare ----------------------------------------------------------------------------------------------


def test_tailor_makes_a_copy_aimed_at_the_job_and_tracks_it(jobs: TestClient) -> None:
    h = _register(jobs)
    rid = make_resume(jobs, h)
    lid = insert(jobs, _listing(title="Backend Engineer", company="Groww", description="Go and Kafka. " * 80))[0]
    r = jobs.post(f"/v1/jobs/listings/{lid}/tailor", headers=h, json={})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["resume_id"] != rid and out["note"] is None and out["title"] == "My CV · Groww"
    copy = jobs.get(f"/v1/resumes/{out['resume_id']}", headers=h).json()
    assert copy["job_text"].startswith("Backend Engineer\nGroww · Bengaluru\nOriginal post: https://")
    assert "Go and Kafka." in copy["job_text"]
    assert jobs.get(f"/v1/resumes/{rid}", headers=h).json()["job_text"] == ""  # the original is untouched
    tracked = jobs.get("/v1/jobs/tracker", headers=h).json()
    assert [(t["listing_id"], t["status"], t["resume_id"]) for t in tracked] == [(lid, "saved", out["resume_id"])]


def test_tailoring_a_snippet_only_job_reads_the_full_post_or_says_it_cant(jobs: TestClient,
                                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.prep import job_link

    h = _register(jobs)
    make_resume(jobs, h)
    short, other = insert(jobs, _listing(source="adzuna", title="Backend Developer", description="Short snippet."),
                          _listing(source="adzuna", title="Go Developer", company="Z", description="Snippet."))

    async def fetched(url: str) -> job_link.JobPosting:
        if "fail" in url:
            raise job_link.JobLinkError("nope")
        return job_link.JobPosting(url=url, title="Backend Developer", company="Acme", text="Full post text. " * 40)

    monkeypatch.setattr(job_link, "fetch_job_posting", fetched)
    ok = jobs.post(f"/v1/jobs/listings/{short}/tailor", headers=h, json={}).json()
    assert ok["note"] is None
    assert "Full post text." in jobs.get(f"/v1/resumes/{ok['resume_id']}", headers=h).json()["job_text"]

    async def fail_url() -> None:
        async with sessionmaker()() as db:
            row = await db.get(JobListing, other)
            assert row is not None
            row.url = "https://www.adzuna.in/land/fail"
            await db.commit()

    run(jobs, fail_url)
    note = jobs.post(f"/v1/jobs/listings/{other}/tailor", headers=h, json={}).json()["note"]
    assert note and "short summary" in note


def test_prepare_saves_the_job_description_once_for_practice(jobs: TestClient) -> None:
    h = _register(jobs)
    lid = insert(jobs, _listing(title="Backend Engineer", company="Groww", description="Go and Kafka. " * 80))[0]
    r = jobs.post(f"/v1/jobs/listings/{lid}/prepare", headers=h)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["reused"] is False and first["title"] == "Backend Engineer — Groww"
    docs = jobs.get("/v1/documents", headers=h).json()
    assert docs[0]["id"] == first["document_id"] and docs[0]["kind"] == "job_description"  # newest: Practice's default
    again = jobs.post(f"/v1/jobs/listings/{lid}/prepare", headers=h).json()
    assert again == {**first, "reused": True}
    assert len(jobs.get("/v1/documents", headers=h).json()) == 1


# ---- the tracker ----------------------------------------------------------------------------------------------------


def test_the_tracker_saves_moves_notes_and_deletes_and_is_private(jobs: TestClient) -> None:
    h, other = _register(jobs), _register(jobs)
    lid = insert(jobs, _listing(title="Backend Engineer", company="Groww"))[0]
    saved = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid})
    assert saved.status_code == 201 and saved.json()["status"] == "saved" and saved.json()["applied_at"] is None
    entry = saved.json()["id"]
    applied = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid, "status": "applied"}).json()
    assert applied["id"] == entry and applied["status"] == "applied" and applied["applied_at"]
    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    moved = jobs.patch(f"/v1/jobs/tracker/{entry}", headers=h,
                       json={"status": "interviewing", "notes": "Round 1 with the payments team", "next_at": when})
    assert moved.status_code == 200 and moved.json()["status"] == "interviewing" and moved.json()["next_at"]
    cleared = jobs.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"clear_applied": True, "clear_next": True})
    assert cleared.status_code == 200 and cleared.json()["applied_at"] is None and cleared.json()["next_at"] is None
    feed = jobs.get("/v1/jobs/feed", headers=h).json()
    assert feed["items"][0]["tracked"] == {"id": entry, "status": "interviewing"}
    # Someone else sees none of it and can't touch it.
    assert jobs.get("/v1/jobs/tracker", headers=other).json() == []
    for method, kw in (("PATCH", {"json": {"status": "rejected"}}), ("DELETE", {})):
        assert jobs.request(method, f"/v1/jobs/tracker/{entry}", headers=other, **kw).status_code == 404
    assert jobs.get("/v1/jobs/feed", headers=other).json()["items"][0]["tracked"] is None
    assert jobs.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"status": "hired"}).status_code == 422
    # The listing ages out of the cache: the entry stays, from its own copy.
    run(jobs, _clear_jobs)
    kept = jobs.get("/v1/jobs/tracker", headers=h).json()
    assert kept[0]["title"] == "Backend Engineer" and kept[0]["live"] is False
    assert jobs.delete(f"/v1/jobs/tracker/{entry}", headers=h).status_code == 204
    assert jobs.get("/v1/jobs/tracker", headers=h).json() == []


def test_deleting_the_account_deletes_its_job_search(jobs: TestClient) -> None:
    email = f"jobs-del-{uuid.uuid4().hex[:6]}@example.com"
    r = jobs.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    jobs.cookies.clear()
    make_resume(jobs, h)
    lid = insert(jobs, _listing(title="Backend Engineer"))[0]
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid})
    jobs.post(f"/v1/jobs/listings/{lid}/fit", headers=h)
    jobs.post("/v1/jobs/profile/suggest", headers=h, json={})
    export = jobs.get("/v1/auth/me/export", headers=h).json()
    assert export["job_search"]["profile"]["prefs"]["titles"] and len(export["job_search"]["tracker"]) == 1
    assert len(export["job_search"]["fit_checks"]) == 1
    assert jobs.request("DELETE", "/v1/auth/me", headers=h, json={"password": "correct horse battery"}).status_code \
        == 204

    async def left() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(JobApplication)
                                       .where(JobApplication.listing_id == lid)) or 0)

    assert run(jobs, left) == 0


# ---- configuration and the migration --------------------------------------------------------------------------------


def test_the_public_numbers_count_fresh_jobs_and_say_whats_free_without_a_session(
        jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(UTC)
    insert(jobs, _listing(company="Groww"), _listing(company="Groww", title="Site Reliability Engineer"),
           _listing(company="CRED"), _listing(company="Old Co", posted_at=now - timedelta(days=20)))
    monkeypatch.setattr(get_settings(), "jobs_fit_daily", 12)
    monkeypatch.setattr(get_settings(), "jobs_profile_daily", 4)
    jobs.cookies.clear()
    body = jobs.get("/v1/jobs/stats").json()
    assert (body["jobs"], body["companies"], body["days"]) == (3, 2, 7)  # the 20-day-old post isn't fresh
    assert (body["fit_daily"], body["profile_daily"]) == (12, 4)
    assert "Himalayas" in body["feeds"] and "Greenhouse" not in body["feeds"]  # boards are the companies' own
    # Worked out at most every few minutes, whoever asks.
    insert(jobs, _listing(company="Meesho"))
    assert jobs.get("/v1/jobs/stats").json()["jobs"] == 3
    job_routes.clear_stats_cache()
    assert jobs.get("/v1/jobs/stats").json()["companies"] == 3


def test_company_boards_can_be_added_and_taken_off_and_bad_entries_fail_at_startup() -> None:
    boards = parse_boards(json.dumps([{"ats": "lever", "token": "acme", "company": "Acme"},
                                      {"ats": "greenhouse", "token": "stripe", "off": True}]))
    keys = {(b.ats, b.token) for b in boards}
    assert ("lever", "acme") in keys and ("greenhouse", "stripe") not in keys and ("ashby", "sarvam") in keys
    for bad in ('{"ats": "lever"}', '[{"ats": "workday", "token": "x", "company": "X"}]',
                '[{"ats": "lever", "token": "../etc", "company": "X"}]', '[{"ats": "lever", "token": "x"}]'):
        with pytest.raises(ValueError):
            parse_boards(bad)


def test_the_migration_upgrades_and_downgrades_cleanly(tmp_path: Path) -> None:
    db = tmp_path / "migrate.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def tables() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    jobs_tables = {"job_listings", "job_source_state", "job_search_profiles", "job_applications", "job_fit_checks"}
    alembic("upgrade", "head")
    assert jobs_tables <= tables()
    alembic("downgrade", "cd1a7385ee32")  # the revision before the jobs tables (later ones sit on top of it)
    assert not jobs_tables & tables() and "resumes" in tables()
    alembic("upgrade", "head")
    assert jobs_tables <= tables()
