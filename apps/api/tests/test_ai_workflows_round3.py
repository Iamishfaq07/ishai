"""Interview debrief from the candidate's notes, and skills the whole shortlist asks for."""
from fastapi.testclient import TestClient

from tests.test_api import _register
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import _listing, insert, jobs  # noqa: F401  (the fixture)


def _track(client: TestClient, h: dict[str, str], listing_id: str) -> str:
    r = client.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing_id})
    assert r.status_code in (200, 201), r.text
    return str(r.json()["id"])


def test_shortlist_skill_gaps_count_asks_across_jobs_and_check_the_resume(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    assert jobs.put("/v1/jobs/profile", headers=h, json={"prefs": {"titles": ["Backend Engineer"],
        "skills": ["Python", "Go"], "locations": [], "posted_within": 30}}).status_code == 200
    a, b, c = insert(jobs, _listing(company="Northstar", keywords=["Go", "Kubernetes", "Kafka"]),
                     _listing(company="Razorpay", keywords=["Python", "Kubernetes"]),
                     _listing(company="Old", keywords=["Kubernetes", "Rust"]))
    for listing in (a, b):
        _track(jobs, h, listing)
    closed = _track(jobs, h, c)
    jobs.patch(f"/v1/jobs/tracker/{closed}", headers=h, json={"status": "rejected"})
    out = jobs.get("/v1/jobs/skill-gaps", headers=h).json()
    missing = {m["skill"]: m["jobs"] for m in out["missing"]}
    shown = {m["skill"]: m["jobs"] for m in out["shown"]}
    assert out["jobs"] == 2 and missing.get("Kubernetes") == 2 and missing.get("Kafka") == 1
    assert "Go" in shown and "Python" in shown and "Rust" not in missing  # the closed job doesn't count
    assert out["missing"][0]["skill"] == "Kubernetes" and len(out["missing"][0]["examples"]) == 2
    assert 0 < out["coverage"] < 100
    other = _register(jobs)
    assert jobs.get("/v1/jobs/skill-gaps", headers=other).json()["jobs"] == 0


def test_interview_debrief_reads_only_the_notes_and_saves_nothing_by_itself(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    (listing,) = insert(jobs, _listing(company="Northstar"))
    entry = _track(jobs, h, listing)
    notes = "They asked about a production incident and a rate limiter design. I promised to send my project link."
    r = jobs.post(f"/v1/jobs/tracker/{entry}/debrief", headers=h, json={"notes": notes})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["questions"] and out["questions"][0]["went"] in ("strong", "okay", "weak", "unsure")
    assert out["promises"] and out["stories"][0]["competencies"] == ["ownership"]
    assert jobs.get("/v1/stories", headers=h).json() == []  # drafts only: the candidate saves what they keep
    assert jobs.post(f"/v1/jobs/tracker/{entry}/debrief", headers=h, json={"notes": "too short"}).status_code == 422
    assert jobs.post(f"/v1/jobs/tracker/{entry}/debrief", headers=h,
                     json={"notes": notes, "round_id": "nope"}).status_code == 404
    other = _register(jobs)
    _verify(jobs, _me(jobs, other)["id"])
    assert jobs.post(f"/v1/jobs/tracker/{entry}/debrief", headers=other, json={"notes": notes}).status_code == 404
