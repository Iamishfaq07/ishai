"""Explicit, version-bound review and independent master/job sources across accounts."""
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.business_helpers import auth, make_client, register, tag

PATH = "/v1/jobs/launchpad/identity"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def resume(client: TestClient, h: dict[str, str], title: str = "Master source") -> dict[str, Any]:
    response = client.post("/v1/resumes", headers=h, json={"title": title, "data": {
        "basics": {"name": "Robin Park", "email": "private@example.com", "headline": "Graduate developer"},
        "skills": [{"items": ["Python"]}], "projects": [{"name": "Library project", "description": "My own project"}],
    }})
    assert response.status_code == 201, response.text
    return dict(response.json())


def read(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    response = client.get(PATH, headers=h)
    assert response.status_code == 200, response.text
    return dict(response.json())


def change(client: TestClient, h: dict[str, str], source: dict[str, Any], r: dict[str, Any], action: str,
           **extra: Any) -> Any:
    return client.put(PATH, headers=h, json={"version": source["version"], "action": action,
        "resume_id": r["id"], "resume_revision": r["revision"], **extra})


def account(client: TestClient) -> dict[str, str]:
    return auth(register(client, f"identity-{tag()}@example.com"))


def test_no_newest_resume_promotion_or_implicit_review(client: TestClient) -> None:
    h = account(client)
    first = resume(client, h)
    resume(client, h, "Newer job draft")
    initial = read(client, h)
    assert initial["master"] is None and initial["review"] == "not_selected"
    selected = change(client, h, initial, first, "select")
    assert selected.status_code == 200, selected.text
    state = selected.json()
    assert state["master"]["id"] == first["id"] and state["review"] == "needs_review"
    assert state["search_uses_master"] and state["skills"] == ["Python"]
    confirmed = change(client, h, state, first, "approve")
    assert confirmed.status_code == 200 and confirmed.json()["review"] == "reviewed"
    assert confirmed.json()["reviewed_at"]
    assert client.get(f"/v1/resumes/{first['id']}", headers=h).json()["data"] == first["data"]


def test_foreign_ids_and_stale_identity_cannot_mutate_selection(client: TestClient) -> None:
    h, other = account(client), account(client)
    mine, theirs = resume(client, h), resume(client, other)
    current = read(client, h)
    assert change(client, h, current, theirs, "select").status_code == 404
    assert all(item["id"] != theirs["id"] for item in current["resumes"])
    selected = change(client, h, current, mine, "select").json()
    assert change(client, h, current, mine, "approve").status_code == 409
    assert read(client, h)["review"] == "needs_review"
    assert change(client, h, selected, {**mine, "revision": 100}, "approve").status_code == 409


def test_master_review_invalidates_after_edit_and_revoke(client: TestClient) -> None:
    h = account(client)
    original = resume(client, h)
    selected = change(client, h, read(client, h), original, "select").json()
    approved = change(client, h, selected, original, "approve").json()
    assert approved["review"] == "reviewed"
    edited = client.put(f"/v1/resumes/{original['id']}", headers=h,
                        json={**original, "data": {**original["data"], "skills": []}})
    assert edited.status_code == 200, edited.text
    current = read(client, h)
    assert current["review"] == "needs_review" and current["skills"] == []
    assert change(client, h, approved, original, "approve").status_code == 409
    fresh = edited.json()
    again = change(client, h, current, fresh, "approve").json()
    revoked = change(client, h, again, fresh, "revoke")
    assert revoked.status_code == 200 and revoked.json()["review"] == "needs_review"


def test_search_selection_does_not_redefine_master_and_deleted_master_is_explicit(client: TestClient) -> None:
    h = account(client)
    base, search = resume(client, h), resume(client, h, "Search alternate")
    selected = change(client, h, read(client, h), base, "select").json()
    change(client, h, selected, base, "approve")
    saved = client.put("/v1/jobs/profile", headers=h,
                       json={"resume_id": search["id"], "prefs": {"titles": ["Developer"]}})
    assert saved.status_code == 200, saved.text
    current = read(client, h)
    assert current["master"]["id"] == base["id"] and current["review"] == "reviewed"
    assert not current["search_uses_master"] and current["target_roles"] == ["Developer"]
    assert client.delete(f"/v1/resumes/{base['id']}", headers=h).status_code == 204
    assert read(client, h)["review"] == "missing"


@pytest.mark.parametrize("via_interview", [False, True])
def test_master_and_two_job_resumes_remain_independent(client: TestClient, via_interview: bool) -> None:
    h = account(client)
    base = resume(client, h)
    selected = change(client, h, read(client, h), base, "select").json()
    change(client, h, selected, base, "approve")
    jobs = [client.post("/v1/jobs/tracker/manual", headers=h,
            json={"company": company, "title": "Developer"}).json()["id"] for company in ("One", "Two")]
    # An older job description attached to the selected CV must not leak to either new job.
    saved_base = client.get(f"/v1/resumes/{base['id']}", headers=h).json()
    changed = client.put(f"/v1/resumes/{base['id']}", headers=h,
                         json={**saved_base, "job_text": "Private requirements of a different employer",
                               "cover_letter": "Dear other employer — this letter belongs to a different application."})
    assert changed.status_code == 200
    latest = changed.json()
    assert change(client, h, read(client, h), latest, "approve").status_code == 200
    linked = []
    for job in jobs:
        path = f"/v1/jobs/tracker/{job}/{'interview' if via_interview else 'mission/resume'}"
        response = client.put(path, headers=h, json={"resume_id": base["id"]})
        assert response.status_code == 200, response.text
        linked.append(client.get(f"/v1/jobs/tracker/{job}/mission", headers=h).json()["resume"]["id"])
    assert len({base["id"], *linked}) == 3
    copy = client.get(f"/v1/resumes/{linked[0]}", headers=h).json()
    assert copy["prep_context"]["source_resume_id"] == base["id"]
    assert copy["job_text"] == "" and copy["cover_letter"] == ""
    edited = client.put(f"/v1/resumes/{linked[0]}", headers=h,
                        json={**copy, "data": {**copy["data"], "skills": []}})
    assert edited.status_code == 200, edited.text
    assert client.get(f"/v1/resumes/{base['id']}", headers=h).json()["data"] == base["data"]
    assert client.get(f"/v1/resumes/{linked[1]}", headers=h).json()["data"] == base["data"]
    assert read(client, h)["review"] == "reviewed"


def test_job_resume_requires_an_explicit_independent_master_copy(client: TestClient) -> None:
    h = account(client)
    original = resume(client, h)
    job = client.post("/v1/jobs/tracker/manual", headers=h, json={"company": "One", "title": "Dev"}).json()["id"]
    assert client.put(f"/v1/jobs/tracker/{job}/mission/resume", headers=h,
                      json={"resume_id": original["id"]}).status_code == 200
    current = read(client, h)
    assert change(client, h, current, original, "select").status_code == 409
    response = change(client, h, current, original, "select", independent_copy=True)
    assert response.status_code == 200, response.text
    selected = response.json()
    assert selected["master"]["id"] != original["id"] and selected["review"] == "needs_review"
    assert client.get(f"/v1/jobs/tracker/{job}/mission", headers=h).json()["resume"]["id"] == original["id"]


def test_approval_metadata_is_exported_and_not_borrowed_by_another_account(client: TestClient) -> None:
    h = account(client)
    original = resume(client, h)
    selected = change(client, h, read(client, h), original, "select").json()
    change(client, h, selected, original, "approve")
    export = client.get("/v1/auth/me/export", headers=h)
    assert export.status_code == 200, export.text
    assert export.json()["job_search"]["profile"]["career_identity"]["resume_id"] == original["id"]
    assert read(client, account(client))["master"] is None


def test_account_deletion_removes_identity_metadata_and_its_source(client: TestClient) -> None:
    from orbit_api.models import JobSearchProfile, Resume
    from tests.business_helpers import db_call

    h = account(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    original = resume(client, h)
    selected = change(client, h, read(client, h), original, "select").json()
    assert change(client, h, selected, original, "approve").status_code == 200
    deleted = client.request("DELETE", "/v1/auth/me", headers=h, json={"password": "correct horse battery"})
    assert deleted.status_code == 204, deleted.text

    async def remaining(db: Any) -> tuple[Any, Any]:
        return await db.get(JobSearchProfile, uid), await db.get(Resume, original["id"])

    assert db_call(client, remaining) == (None, None)
    assert client.get(PATH, headers=h).status_code == 401


def test_legacy_shared_resume_is_flagged_before_explicit_copy(client: TestClient) -> None:
    from orbit_api.models import JobApplication
    from tests.business_helpers import db_call

    h = account(client)
    original = resume(client, h)
    jobs = [client.post("/v1/jobs/tracker/manual", headers=h,
            json={"company": company, "title": "Developer"}).json()["id"] for company in ("Legacy A", "Legacy B")]

    async def legacy(db: Any) -> None:
        for job in jobs:
            row = await db.get(JobApplication, job)
            row.resume_id = original["id"]

    db_call(client, legacy)
    path = f"/v1/jobs/tracker/{jobs[0]}/mission"
    assert client.get(path, headers=h).json()["resume_requires_copy"] is True
    copied = client.put(f"{path}/resume", headers=h, json={"resume_id": original["id"]})
    assert copied.status_code == 200, copied.text
    assert copied.json()["resume"]["id"] != original["id"]
    assert copied.json()["resume_requires_copy"] is False
    other = client.get(f"/v1/jobs/tracker/{jobs[1]}/mission", headers=h).json()
    assert other["resume"]["id"] == original["id"] and other["resume_requires_copy"] is False
