"""Interview prep plan: built from records to the interview day, rebuilt when the date moves, ticks belong to one
plan, and nothing crosses accounts."""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient

from orbit_api.job_portal.plan import MAX_DAYS, build_plan
from tests.test_api import _register

TODAY = date(2026, 10, 16)


def test_a_plan_runs_to_the_interview_day_and_ends_light() -> None:
    days = build_plan(TODAY, TODAY + timedelta(days=4), ["Kubernetes", "System design"], queue_due=2, stories=1)
    assert [d.days_before for d in days] == [4, 3, 2, 1, 0]
    assert days[0].items[0].kind == "research"  # the first day starts by reading the post again
    kinds = [i.kind for d in days for i in d.items]
    assert kinds.count("gap") == 2 and kinds.count("story") == 2  # until there are three stories
    assert [i.kind for i in days[-1].items] == ["warmup", "logistics", "review"]
    assert all(len(d.items) <= 3 for d in days)
    keys = [i.key for d in days for i in d.items]
    assert len(set(keys)) == len(keys) and keys[0].startswith("2026-10-16:")


def test_far_interviews_start_two_weeks_before_and_past_ones_have_none() -> None:
    days = build_plan(TODAY, TODAY + timedelta(days=40), [], 0, 5)
    assert len(days) == MAX_DAYS and days[0].date == TODAY + timedelta(days=40 - MAX_DAYS + 1)
    assert build_plan(TODAY, TODAY - timedelta(days=1), [], 0, 0) == []
    today_only = build_plan(TODAY, TODAY, [], 0, 0)
    assert len(today_only) == 1 and today_only[0].days_before == 0


def _entry(client: TestClient, h: dict[str, str], days: int | None, status: str = "interviewing") -> str:
    body: dict[str, object] = {"company": "Hooli", "title": f"Engineer {uuid.uuid4().hex[:6]}", "status": status}
    if days is not None:
        body["next_at"] = (datetime.now(UTC) + timedelta(days=days)).isoformat()
    r = client.post("/v1/jobs/tracker/manual", headers=h, json=body)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_no_date_no_plan(client: TestClient) -> None:
    h = _register(client)
    p = client.get(f"/v1/jobs/tracker/{_entry(client, h, None)}/plan", headers=h).json()
    assert p["days"] == [] and p["interview_at"] is None
    saved = _entry(client, h, 3, status="saved")  # a saved job's date is a follow-up, not an interview
    assert client.get(f"/v1/jobs/tracker/{saved}/plan", headers=h).json()["days"] == []


def test_ticking_off_and_a_moved_date(client: TestClient) -> None:
    h = _register(client)
    eid = _entry(client, h, 3)
    plan = client.get(f"/v1/jobs/tracker/{eid}/plan", headers=h).json()
    assert plan["days_left"] in (3, 4) and plan["total"] > 0 and plan["done"] == 0
    key = plan["days"][0]["items"][0]["key"]
    after = client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{key}", headers=h, json={"done": True}).json()
    assert after["done"] == 1 and after["days"][0]["items"][0]["done"] is True
    again = client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{key}", headers=h, json={"done": True})
    assert again.status_code == 200 and again.json()["done"] == 1  # idempotent
    assert client.put(f"/v1/jobs/tracker/{eid}/plan/checks/1999-01-01:mock:0", headers=h,
                      json={"done": True}).status_code == 404
    undone = client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{key}", headers=h, json={"done": False}).json()
    assert undone["done"] == 0
    # The old interview day's warm-up, ticked: when the interview moves, that day is no longer the interview day.
    warmup = plan["days"][-1]["items"][0]
    assert warmup["kind"] == "warmup"
    client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{warmup['key']}", headers=h, json={"done": True})
    # The interview moves a week: a new plan, its own ticks.
    moved = (datetime.now(UTC) + timedelta(days=10)).isoformat()
    assert client.patch(f"/v1/jobs/tracker/{eid}", headers=h, json={"next_at": moved}).status_code == 200
    plan = client.get(f"/v1/jobs/tracker/{eid}/plan", headers=h).json()
    assert plan["days_left"] in (10, 11) and plan["done"] == 0
    assert warmup["key"] not in {i["key"] for d in plan["days"] for i in d["items"]}


def test_plans_are_private_and_exported(client: TestClient) -> None:
    a, b = _register(client), _register(client)
    eid = _entry(client, a, 2)
    key = client.get(f"/v1/jobs/tracker/{eid}/plan", headers=a).json()["days"][0]["items"][0]["key"]
    assert client.get(f"/v1/jobs/tracker/{eid}/plan", headers=b).status_code == 404
    assert client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{key}", headers=b, json={"done": True}).status_code == 404
    client.put(f"/v1/jobs/tracker/{eid}/plan/checks/{key}", headers=a, json={"done": True})
    assert len(client.get("/v1/auth/me/export", headers=a).json()["job_search"]["prep_plan_ticks"]) == 1
    assert client.get("/v1/auth/me/export", headers=b).json()["job_search"]["prep_plan_ticks"] == []
