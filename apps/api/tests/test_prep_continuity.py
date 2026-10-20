"""Rescheduling retains recorded work without silently completing new tasks or changing candidate claims."""
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.job_portal.plan import plan_for
from orbit_api.models import JobApplication, JobFitCheck, JobPlanCheck, ProviderRequest, User
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def setup(client: TestClient, days: int | None = 4) -> tuple[dict[str, str], str]:
    user = register(client, f"prep-{tag()}@example.com")
    body: dict[str, Any] = {"title": "Graduate engineer", "company": "Example", "status": "interviewing"}
    if days is not None:
        body["next_at"] = (datetime.now(UTC) + timedelta(days=days)).isoformat()
    result = client.post("/v1/jobs/tracker/manual", headers=auth(user), json=body)
    assert result.status_code == 201, result.text
    return user, str(result.json()["id"])


def read(client: TestClient, user: dict[str, str], entry: str, offset: int = 0) -> dict[str, Any]:
    result = client.get(f"/v1/jobs/tracker/{entry}/plan?tz_offset={offset}&rehearsal=true", headers=auth(user))
    assert result.status_code == 200, result.text
    return dict(result.json())


def tick(client: TestClient, user: dict[str, str], entry: str, key: str, **extra: Any) -> Any:
    return client.put(f"/v1/jobs/tracker/{entry}/plan/checks/{key}?rehearsal=true", headers=auth(user),
                      json={"done": True, **extra})


def test_reschedule_keeps_exact_history_and_requires_review_to_reuse_matching_work(client: TestClient) -> None:
    user, entry = setup(client)
    before = read(client, user, entry)
    research = before["days"][0]["items"][0]
    assert research["kind"] == "research"
    saved = tick(client, user, entry, research["key"])
    assert saved.status_code == 200, saved.text
    completion = saved.json()["completed"][0]
    assert completion["title"] == research["title"]
    assert datetime.fromisoformat(completion["interview_at"]) == datetime.fromisoformat(before["interview_at"])
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user),
        json={"next_at": (datetime.now(UTC) + timedelta(days=8)).isoformat()}).status_code == 200
    moved = read(client, user, entry)
    assert moved["done"] == 0 and moved["completed"] == [completion]
    task = moved["days"][0]["items"][0]
    assert task["key"] != research["key"] and len(task["key"]) <= 64
    assert task["prior_completion"]["id"] == completion["id"]
    assert tick(client, user, entry, research["key"]).status_code == 404
    reused = tick(client, user, entry, task["key"], reuse_from=completion["id"])
    assert reused.status_code == 200, reused.text
    assert reused.json()["done"] == 1 and reused.json()["completed_total"] == 2
    assert reused.json()["completed"][0]["reused"] is True
    assert tick(client, user, entry, task["key"], reuse_from=completion["id"]).json()["completed_total"] == 2
    exported = client.get("/v1/auth/me/export", headers=auth(user)).json()["job_search"]["prep_plan_ticks"]
    assert len(exported) == 2 and any(row["task_data"]["reused_from"] == completion["id"] for row in exported)


def test_matching_is_owned_and_never_reuses_repeated_practice_or_changed_requirements(client: TestClient) -> None:
    user, entry = setup(client)
    other, other_entry = setup(client)
    first = read(client, user, entry)["days"][0]["items"]
    assert tick(client, user, entry, first[0]["key"]).status_code == 200
    own_id = read(client, user, entry)["completed"][0]["id"]
    foreign_task = read(client, other, other_entry)["days"][0]["items"][0]
    assert tick(client, other, other_entry, foreign_task["key"], reuse_from=own_id).status_code == 409
    assert client.get(f"/v1/jobs/tracker/{entry}/plan", headers=auth(other)).status_code == 404
    assert tick(client, other, entry, first[0]["key"]).status_code == 404
    mock = next(item for day in read(client, user, entry)["days"] for item in day["items"] if item["kind"] == "mock")
    assert tick(client, user, entry, mock["key"], reuse_from=own_id).status_code == 409
    assert tick(client, user, entry, first[0]["key"], reuse_from=own_id, done=False).status_code == 422
    assert tick(client, user, entry, first[0]["key"], done=1).status_code == 422

    async def fit(db: Any, requirement: str) -> None:
        job = await db.get(JobApplication, entry)
        db.add(JobFitCheck(user_id=uid(user), listing_id=job.listing_id, resume_hash=tag() * 8,
                          result={"gaps": [requirement]}))
    db_call(client, lambda db: fit(db, "Explain SQL query plans"))
    gap = next(item for day in read(client, user, entry)["days"] for item in day["items"] if item["kind"] == "gap")
    assert tick(client, user, entry, gap["key"]).status_code == 200
    db_call(client, lambda db: fit(db, "Explain a different requirement"))
    changed = next(item for day in read(client, user, entry)["days"] for item in day["items"] if item["kind"] == "gap")
    assert changed["key"] != gap["key"] and changed["done"] is False and changed["prior_completion"] is None
    assert tick(client, user, entry, gap["key"]).status_code == 404


def test_same_day_time_change_and_legacy_records_never_silently_complete_a_new_plan(client: TestClient) -> None:
    user, entry = setup(client)
    before = read(client, user, entry)
    task = before["days"][0]["items"][0]
    assert tick(client, user, entry, task["key"]).status_code == 200
    async def legacy(db: Any) -> None:
        db.add(JobPlanCheck(user_id=uid(user), application_id=entry, item_key="2026-10-01:gap:0"))
    db_call(client, legacy)
    at = datetime.fromisoformat(before["interview_at"]) + timedelta(minutes=1)
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user),
                        json={"next_at": at.isoformat()}).status_code == 200
    after = read(client, user, entry)
    assert after["done"] == 0 and after["completed_total"] == 2
    assert any(row["legacy"] and "details were not saved" in row["title"] for row in after["completed"])
    legacy_id = next(row["id"] for row in after["completed"] if row["legacy"])
    assert tick(client, user, entry, after["days"][0]["items"][0]["key"], reuse_from=legacy_id).status_code == 409


def test_no_date_past_date_closed_jobs_and_new_day_keep_history_without_side_effects(client: TestClient) -> None:
    user, entry = setup(client, None)
    rehearsal = read(client, user, entry)
    assert rehearsal["mode"] == "rehearsal" and rehearsal["interview_at"] is None
    assert len(rehearsal["days"]) == 3 and all(day["days_before"] is None for day in rehearsal["days"])
    assert not any(item["kind"] in ("warmup", "logistics") for day in rehearsal["days"] for item in day["items"])
    assert tick(client, user, entry, rehearsal["days"][0]["items"][0]["key"]).status_code == 200
    async def future(db: Any) -> Any:
        job = await db.get(JobApplication, entry)
        account = await db.get(User, uid(user))
        return await plan_for(db, account, job, now=datetime.now(UTC) + timedelta(days=1))
    tomorrow = db_call(client, future)
    assert tomorrow.completed_total == 1 and tomorrow.done == 0
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user),
        json={"next_at": (datetime.now(UTC) - timedelta(days=3)).isoformat()}).status_code == 200
    assert read(client, user, entry)["mode"] == "rehearsal"
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"status": "hired"}).status_code == 200
    closed = read(client, user, entry)
    assert closed["mode"] == "closed" and closed["days"] == [] and closed["completed_total"] == 1
    async def requests(db: Any) -> list[Any]:
        return list(await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == uid(user))))
    assert db_call(client, requests) == []
    assert client.delete(f"/v1/jobs/tracker/{entry}", headers=auth(user)).status_code == 204
    async def completions(db: Any) -> list[Any]:
        return list(await db.scalars(select(JobPlanCheck).where(JobPlanCheck.application_id == entry)))
    assert db_call(client, completions) == []


def test_completion_snapshot_is_exported_and_deleted_with_account_without_sending_history_to_coach(
    client: TestClient,
) -> None:
    user, entry = setup(client)
    task = read(client, user, entry)["days"][0]["items"][0]
    assert tick(client, user, entry, task["key"]).status_code == 200
    async def historic(db: Any) -> None:
        db.add(JobPlanCheck(user_id=uid(user), application_id=entry, item_key="old-history",
            task_data={"kind": "gap", "title": "Private historical task", "detail": "Private history detail"}))
    db_call(client, historic)
    source = client.get(f"/v1/jobs/tracker/{entry}/coach", headers=auth(user))
    assert source.status_code == 200 and "Private" not in source.text
    exported = client.get("/v1/auth/me/export", headers=auth(user))
    assert "Private historical task" in exported.text and "Private history detail" in exported.text
    response = client.request("DELETE", "/v1/auth/me", headers=auth(user), json={"password": "correct horse battery"})
    assert response.status_code == 204, response.text
    async def records(db: Any) -> list[Any]:
        return list(await db.scalars(select(JobPlanCheck).where(JobPlanCheck.user_id == uid(user))))
    assert db_call(client, records) == []
