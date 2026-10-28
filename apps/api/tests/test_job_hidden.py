"""Discover's "Not interested": a hidden job, or a hidden company, stays out of the feed until it's brought back."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, make_resume  # noqa: F401 - shared pytest fixture


def _feed_ids(client: TestClient, h: dict[str, str]) -> list[str]:
    r = client.get("/v1/jobs/feed", headers=h)
    assert r.status_code == 200, r.text
    return [j["id"] for j in r.json()["items"]]


def test_a_hidden_job_leaves_the_feed_and_comes_back(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    make_resume(jobs, h)
    first, second = insert(jobs, _listing(company="Groww", title="Backend Engineer - Payments"),
                           _listing(company="Zepto", title="Backend Engineer"))
    assert set(_feed_ids(jobs, h)) == {first, second}

    r = jobs.post("/v1/jobs/hidden", headers=h, json={"listing_id": first})
    assert r.status_code == 200, r.text
    assert [(i["kind"], i["value"], i["label"]) for i in r.json()["items"]] == [
        ("job", first, "Backend Engineer - Payments · Groww")]
    assert _feed_ids(jobs, h) == [second]
    # Hiding it again changes nothing.
    assert len(jobs.post("/v1/jobs/hidden", headers=h, json={"listing_id": first}).json()["items"]) == 1

    assert jobs.delete("/v1/jobs/hidden", headers=h, params={"kind": "job", "value": first}).status_code == 204
    assert set(_feed_ids(jobs, h)) == {first, second}
    assert jobs.get("/v1/jobs/hidden", headers=h).json()["items"] == []


def test_a_hidden_company_hides_all_its_jobs_however_it_is_written(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    make_resume(jobs, h)
    a, b, other = insert(jobs, _listing(company="Acme Technologies Pvt Ltd", title="Backend Engineer"),
                         _listing(company="Acme", title="Platform Engineer", source="lever"),
                         _listing(company="Zepto", title="Backend Engineer"))
    r = jobs.post("/v1/jobs/hidden", headers=h, json={"listing_id": a, "company": True})
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["kind"] == "company" and item["value"] == "acme" and item["label"] == "Acme Technologies Pvt Ltd"
    assert _feed_ids(jobs, h) == [other]
    assert jobs.delete("/v1/jobs/hidden", headers=h, params={"kind": "company", "value": "acme"}).status_code == 204
    assert set(_feed_ids(jobs, h)) == {a, b, other}


def test_hidden_jobs_are_each_accounts_own(jobs: TestClient) -> None:  # noqa: F811
    a, b = _register(jobs), _register(jobs)
    make_resume(jobs, a)
    make_resume(jobs, b)
    (job,) = insert(jobs, _listing(company="Groww"))
    assert jobs.post("/v1/jobs/hidden", headers=a, json={"listing_id": job}).status_code == 200
    assert _feed_ids(jobs, a) == []
    assert _feed_ids(jobs, b) == [job]
    assert jobs.get("/v1/jobs/hidden", headers=b).json()["items"] == []
    # B can't bring back what A hid (it only ever touches B's own list).
    assert jobs.delete("/v1/jobs/hidden", headers=b, params={"kind": "job", "value": job}).status_code == 204
    assert _feed_ids(jobs, a) == []
    assert jobs.post("/v1/jobs/hidden", headers=a, json={"listing_id": "jnope"}).status_code == 404
