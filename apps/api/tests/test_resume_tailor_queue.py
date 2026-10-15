"""The tailoring queue (resumes/tailor_queue.py): one resume tailored to several jobs in the background, each a new
resume with its job post, fixed by the same AI pass as "Fix everything", one credit each, checked up front."""

import time
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import ResumeData, ResumeDesign
from tests.test_api import _register
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401 (the fixture)
from tests.test_jobs import _listing, insert, jobs  # noqa: F401 (the fixture)
from tests.test_resume_autofix import weak, welcome  # noqa: F401 (the fixture)

POST = ("Backend Engineer at Razorpay\nWe're hiring a backend engineer to build payment services in Go with "
        "Kubernetes, Kafka and PostgreSQL. You'll own APIs end to end and work with product and support teams.")
POST_2 = ("Support Operations Lead at Freshworks\nLead a team of support agents, own Zendesk workflows and macros, "
          "report on SLAs and customer satisfaction, and work with product on escalations.")


def _resume(client: TestClient, h: dict[str, str], data: ResumeData | None = None) -> str:
    body = {"title": "My CV", "data": (data or weak()).model_dump(mode="json")}
    r = client.post("/v1/resumes", headers=h, json=body)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def _wait(client: TestClient, h: dict[str, str], n: int, timeout: float = 30) -> list[dict[str, Any]]:
    end = time.time() + timeout
    while time.time() < end:
        items = client.get("/v1/resumes/tailor-queue", headers=h).json()
        if len(items) >= n and all(i["status"] in ("done", "failed") for i in items[:n]):
            return items
        time.sleep(0.2)
    raise AssertionError(f"queue didn't finish: {items}")


def test_a_resume_is_tailored_to_each_job_in_the_background(client: TestClient) -> None:
    h = _register(client)
    rid = _resume(client, h)
    two = {"jobs": [{"job_text": POST}, {"job_text": POST_2, "label": "Freshworks"}]}
    r = client.post(f"/v1/resumes/{rid}/tailor-queue", headers=h, json=two)
    assert r.status_code == 202, r.text
    assert [i["label"] for i in r.json()] == ["Backend Engineer at Razorpay", "Freshworks"]
    assert all(i["status"] == "queued" for i in r.json())
    items = _wait(client, h, 2)
    for item in items:
        assert item["status"] == "done", item
        res = item["result"]
        made = client.get(f"/v1/resumes/{res['resume_id']}", headers=h).json()
        assert made["title"] == f"My CV · {item['label']}" and made["job_text"].strip()
        assert res["score_after"] >= res["score_before"] and res["changes"] > 0
        data = ResumeData.model_validate(made["data"])
        assert score_resume(data, ResumeDesign(), made["job_text"]).score == res["score_after"]
    # The original is left as it was.
    assert client.get(f"/v1/resumes/{rid}", headers=h).json()["title"] == "My CV"
    # A finished item can be cleared from the list; its resume stays.
    first = items[0]
    assert client.delete(f"/v1/resumes/tailor-queue/{first['id']}", headers=h).status_code == 204
    assert client.get(f"/v1/resumes/{first['result']['resume_id']}", headers=h).status_code == 200
    assert first["id"] not in {i["id"] for i in client.get("/v1/resumes/tailor-queue", headers=h).json()}


def test_it_is_yours_only_and_checks_what_it_is_given(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    rid = _resume(client, h)
    url, one = f"/v1/resumes/{rid}/tailor-queue", {"jobs": [{"job_text": POST}]}
    assert client.post(url, headers=other, json=one).status_code == 404
    assert client.post(url, headers=h, json={"jobs": [{"job_text": "Too short"}]}).status_code == 422
    assert client.post(url, headers=h, json={"jobs": []}).status_code == 422
    assert client.post(url, headers=h, json={"jobs": [{"job_text": POST}] * 11}).status_code == 422
    item = client.post(url, headers=h, json=one).json()[0]
    assert client.get("/v1/resumes/tailor-queue", headers=other).json() == []
    assert client.delete(f"/v1/resumes/tailor-queue/{item['id']}", headers=other).status_code == 404
    _wait(client, h, 1)


def test_each_job_costs_one_credit_checked_before_it_queues(client: TestClient, welcome: None) -> None:  # noqa: F811
    h = _signup(client, _new_ip())  # one welcome credit
    rid = _resume(client, h)
    url, one = f"/v1/resumes/{rid}/tailor-queue", {"jobs": [{"job_text": POST}]}
    assert client.post(url, headers=h, json={"jobs": [{"job_text": POST}, {"job_text": POST_2}]}).status_code == 402
    assert client.post(url, headers=h, json=one).status_code == 202
    item = _wait(client, h, 1)[0]
    assert item["status"] == "done", item
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0
    # Out of credits now: nothing more queues.
    assert client.post(url, headers=h, json=one).status_code == 402


def test_a_saved_job_goes_on_the_tracker_with_its_tailored_resume(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    rid = _resume(jobs, h)
    (lid,) = insert(jobs, _listing(title="Support Lead", company="Freshworks",
                                   description=POST_2 + " " + "Details about the team and the role. " * 20))
    saved = {"jobs": [{"listing_id": lid, "label": "Freshworks"}]}
    r = jobs.post(f"/v1/resumes/{rid}/tailor-queue", headers=h, json=saved)
    assert r.status_code == 202, r.text
    item = _wait(jobs, h, 1)[0]
    assert item["status"] == "done", item
    tracked = {t["listing_id"]: t for t in jobs.get("/v1/jobs/tracker", headers=h).json()}
    assert tracked[lid]["resume_id"] == item["result"]["resume_id"]
    made = jobs.get(f"/v1/resumes/{item['result']['resume_id']}", headers=h).json()
    assert "Freshworks" in made["job_text"]
