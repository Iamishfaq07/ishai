"""Recruiter first look for one job, and the opt-in "tailor each job I save" workflow rule."""
from fastapi.testclient import TestClient

from tests.autoapply_helpers import make_resume
from tests.test_api import _register
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import _listing, insert, jobs  # noqa: F401  (the fixture)


def _rules(client: TestClient, h: dict[str, str], **values: object) -> None:
    current = client.get("/v1/jobs/playbook", headers=h).json()
    revision = current.pop("revision")
    r = client.put("/v1/jobs/playbook", headers=h, json={**current, "base_revision": revision, **values})
    assert r.status_code == 200, r.text


def test_first_look_places_the_jobs_skills_and_never_invents_a_number(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    make_resume(jobs, h)
    (listing,) = insert(jobs, _listing(company="Northstar", keywords=["Python", "PostgreSQL", "Docker", "Kubernetes"]))
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing}).json()["id"]
    r = jobs.post(f"/v1/jobs/tracker/{entry}/first-look", headers=h, json={})
    assert r.status_code == 200, r.text
    out = r.json()
    where = {s["skill"]: s["where"] for s in out["skills"]}
    # Python and PostgreSQL are in the summary/first role/first skills; Kubernetes is nowhere on the resume.
    assert where["Python"] == "top" and where["PostgreSQL"] == "top" and where["Kubernetes"] == "missing"
    assert "99" not in out["summary"] and "[number]" in out["summary"]  # the mock's 99 isn't in the resume
    assert out["impression"] and out["resume_title"] == "Master CV" and "Backend Engineer" in out["top_text"]
    other = _register(jobs)
    _verify(jobs, _me(jobs, other)["id"])
    assert jobs.post(f"/v1/jobs/tracker/{entry}/first-look", headers=other, json={}).status_code == 404


def test_first_look_needs_a_resume(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    (listing,) = insert(jobs, _listing(company="Acme"))
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing}).json()["id"]
    assert jobs.post(f"/v1/jobs/tracker/{entry}/first-look", headers=h, json={}).status_code == 409


def test_tailor_on_save_is_opt_in_and_queues_once_per_new_job(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    make_resume(jobs, h)
    a, b = insert(jobs, _listing(company="Northstar"), _listing(company="Razorpay"))
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": a})
    assert jobs.get("/v1/resumes/tailor-queue", headers=h).json() == []  # off by default
    _rules(jobs, h, auto_tailor=True)
    assert jobs.get("/v1/jobs/playbook", headers=h).json()["auto_tailor"] is True
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": b})
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": b, "status": "applied"})  # already tracked
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": a, "status": "applied"})  # tracked before the rule
    items = jobs.get("/v1/resumes/tailor-queue", headers=h).json()
    assert [i["label"] for i in items] == ["Backend Engineer · Razorpay"]
