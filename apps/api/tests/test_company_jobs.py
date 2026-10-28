"""Open jobs at a company for its public guide: no account, public post fields only, matched by name and alias."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from orbit_api.job_portal import company_jobs
from tests.test_jobs import _listing, insert, jobs  # noqa: F401 - shared pytest fixture


def test_a_guide_lists_its_companys_recent_jobs_without_an_account(jobs: TestClient) -> None:  # noqa: F811
    company_jobs.clear_cache()
    old = datetime.now(UTC) - timedelta(days=90)
    insert(jobs,
           _listing(company="Tata Motors Limited", title="Graduate Engineer Trainee"),
           _listing(company="Tata Motors", title="Graduate Engineer Trainee", source="lever"),  # the same job
           _listing(company="Tata Motors", title="Plant Quality Engineer"),
           _listing(company="Tata Motors", title="Old role", posted_at=old),
           _listing(company="Tata Steel", title="Graduate Engineer Trainee"))
    r = jobs.get("/v1/public/companies/tata-motors/jobs")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["company"] == "Tata Motors" and out["total"] == 2
    assert sorted(j["title"] for j in out["items"]) == ["Graduate Engineer Trainee", "Plant Quality Engineer"]
    first = out["items"][0]
    assert set(first) == {"title", "place", "posted_at", "apply_url", "source_label", "direct", "credit"}
    assert jobs.get("/v1/public/companies/not-a-company/jobs").status_code == 404
