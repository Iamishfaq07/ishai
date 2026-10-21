"""Promises to keep (to-dos on Today) and the "Tell me about yourself" pitch for one job."""
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.autoapply_helpers import make_resume
from tests.test_api import _register
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import _listing, insert, jobs  # noqa: F401  (the fixture)


def _job(client: TestClient, h: dict[str, str], company: str = "Northstar") -> str:
    (listing,) = insert(client, _listing(company=company))
    return str(client.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing}).json()["id"])


def test_commitments_are_owned_dated_and_appear_on_today_until_done(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    entry = _job(jobs, h)
    soon = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    later = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    a = jobs.post(f"/v1/jobs/tracker/{entry}/commitments", headers=h,
                  json={"text": "Send my GitHub link", "due_at": soon})
    assert a.status_code == 201, a.text
    jobs.post(f"/v1/jobs/tracker/{entry}/commitments", headers=h, json={"text": "Send references", "due_at": later})
    jobs.post(f"/v1/jobs/tracker/{entry}/commitments", headers=h, json={"text": "Undated note"})
    again = jobs.post(f"/v1/jobs/tracker/{entry}/commitments", headers=h, json={"text": "Send my GitHub link "})
    assert again.json()["id"] == a.json()["id"]  # an open promise isn't duplicated
    today = [i for i in jobs.get("/v1/jobs/actions", headers=h).json()["items"] if i.get("rule") == "commitment"]
    assert [i["detail"] for i in today] == ["You said you would: Send my GitHub link"]  # within 7 days only
    cid = a.json()["id"]
    done = jobs.patch(f"/v1/jobs/tracker/{entry}/commitments/{cid}", headers=h, json={"done": True})
    assert done.status_code == 200 and done.json()["done_at"]
    assert not [i for i in jobs.get("/v1/jobs/actions", headers=h).json()["items"] if i.get("rule") == "commitment"]
    listed = jobs.get(f"/v1/jobs/tracker/{entry}/commitments", headers=h).json()
    assert len(listed) == 3 and listed[-1]["done_at"]  # done ones sort last
    other = _register(jobs)
    assert jobs.get(f"/v1/jobs/tracker/{entry}/commitments", headers=other).status_code == 404
    path = f"/v1/jobs/tracker/{entry}/commitments/{cid}"
    assert jobs.patch(path, headers=other, json={"done": False}).status_code == 404
    assert jobs.delete(f"/v1/jobs/tracker/{entry}/commitments/{cid}", headers=h).status_code == 204
    exported = jobs.get("/v1/auth/me/export", headers=h).json()
    assert len(exported["job_search"]["commitments"]) == 2


def test_pitch_has_three_lengths_and_never_invents_a_number(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    entry = _job(jobs, h)
    assert jobs.post(f"/v1/jobs/tracker/{entry}/pitch", headers=h).status_code == 409  # no resume yet
    make_resume(jobs, h)
    r = jobs.post(f"/v1/jobs/tracker/{entry}/pitch", headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["short"] and out["standard"] and out["long"] and out["hooks"]
    assert "7 million" not in out["short"] and "[number] million" in out["short"]  # 7 isn't in the resume
    assert out["words"]["long"] > out["words"]["short"]
