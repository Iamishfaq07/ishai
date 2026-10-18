"""Orbit for Business under concurrency: 20 requests at once that collide on a unique constraint get a clean answer,
never a 500 (the Postgres verification of PR #400). Run against Postgres with ORBIT_TEST_DATABASE_URL; on SQLite they
check the same answers. The TestClient re-raises a server exception, so a 500 fails the test outright."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.business import rules
from orbit_api.models import BizApplication, BizCompany, BizScorecard, Resume
from tests.business_helpers import (
    apply_signed_out,
    auth,
    db_call,
    make_client,
    new_company,
    new_job,
    register,
    tag,
    uid,
)

N = 20


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    gen = make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")
    c = next(gen)
    yield c
    gen.close()


def together(fn: Any, n: int = N) -> list[Any]:
    barrier = Barrier(n)

    def one(i: int) -> Any:
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(one, range(n)))


def count(client: TestClient, query: Any) -> int:
    async def go(db: Any) -> int:
        return int(await db.scalar(query) or 0)

    return int(db_call(client, go))


def test_concurrent_signed_out_applies_with_one_email(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    email = f"race-{tag()}@example.com"
    codes = together(lambda i: apply_signed_out(client, job["id"], email if i % 2 else email.upper()))
    assert all(r.status_code == 200 and r.json()["status"] == "applied" for r in codes), [r.text for r in codes]
    assert count(client, select(func.count()).select_from(BizApplication).where(
        BizApplication.job_id == job["id"])) == 1


def test_concurrent_one_click_applies(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    cand = register(client, f"kiran-{tag()}@example.com", "Kiran Rao")

    async def resume(db: Any) -> str:
        r = Resume(user_id=uid(cand), title="Mine", design={}, data={
            "basics": {"name": "Kiran Rao"}, "skills": [{"name": "Backend", "items": ["Python"]}]})
        db.add(r)
        await db.flush()
        return str(r.id)

    rid = db_call(client, resume)
    body = {"resume_id": rid, "answers": [{"question_id": "auth", "answer": "yes"},
                                          {"question_id": "years", "answer": "6"}],
            "consent": True, "notice_version": rules.NOTICE_VERSION}
    rs = together(lambda i: client.post(f"/v1/business/apply/{job['id']}", headers=auth(cand), json=body))
    statuses = [r.json()["status"] for r in rs]
    assert all(r.status_code == 200 for r in rs) and statuses.count("applied") == 1, statuses
    assert set(statuses) == {"applied", "already_applied"}
    assert count(client, select(func.count()).select_from(BizApplication).where(
        BizApplication.job_id == job["id"])) == 1


def test_concurrent_companies_with_one_name(client: TestClient) -> None:
    name = f"Samename {tag()}"
    owners = [register(client, f"o{i}-{tag()}@example.com") for i in range(N)]
    rs = together(lambda i: client.post("/v1/business/companies", headers=auth(owners[i]),
                                        json={"name": name, "website": f"https://co{i}-{tag()}.com"}))
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert len({r.json()["slug"] for r in rs}) == N
    assert count(client, select(func.count()).select_from(BizCompany).where(BizCompany.name == name)) == N


def test_concurrent_jobs_with_one_title(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rs = together(lambda i: client.post(f"/v1/business/companies/{cid}/jobs", headers=auth(owner),
                                        json={"title": "Backend Engineer"}))
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert len({r.json()["slug"] for r in rs}) == N


def test_concurrent_scorecard_submits(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"sc-{tag()}@example.com").raise_for_status()
    app_id = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/applications",
                        headers=auth(owner)).json()["items"][0]["id"]
    rs = together(lambda i: client.post(f"/v1/business/companies/{cid}/applications/{app_id}/scorecards",
                                        headers=auth(owner), json={
                                            "stage_id": "interview", "ratings": [{"criterion": "Python", "score": 3}],
                                            "notes": f"take {i}", "recommendation": "hire"}))
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert count(client, select(func.count()).select_from(BizScorecard).where(
        BizScorecard.application_id == app_id)) == 1
