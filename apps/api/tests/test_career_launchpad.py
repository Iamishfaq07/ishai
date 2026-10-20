"""The candidate controls setup; AI cannot invent its evidence or save search settings."""
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import Resume
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, make_client, register, tag


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def account(client: TestClient, *, resume: bool = True) -> tuple[dict[str, str], str | None]:
    user = register(client, f"launch-{tag()}@example.com")
    rid = None
    if resume:
        response = client.post("/v1/resumes", headers=auth(user), json={"title": "Student resume", "data": {
            "basics": {"name": "Private name", "email": "private@example.com", "phone": "1234567890"},
            "skills": [{"items": ["Python", "SQL"]}],
            "projects": [{"name": "Library search", "description": "Built a search tool for college books"}],
            "education": [{"degree": "BSc", "field": "Computer science"}],
        }})
        assert response.status_code == 201, response.text
        rid = response.json()["id"]
    return user, rid


def source(client: TestClient, user: dict[str, str], rid: str | None = None) -> dict[str, Any]:
    response = client.get("/v1/jobs/launchpad", headers=auth(user), params={"resume_id": rid} if rid else {})
    assert response.status_code == 200, response.text
    return dict(response.json())


def body(context: dict[str, Any], **patch: Any) -> dict[str, Any]:
    return {"version": context["version"], "resume_id": context["resume_id"], "stage": "fresher", **patch}


def test_context_is_owned_read_only_and_omits_contact_details(client: TestClient) -> None:
    user, rid = account(client)
    other, _ = account(client)
    current = source(client, user)
    assert current["resume_id"] == rid and current["resumes"] == [{"id": rid, "title": "Student resume"}]
    assert "Python" in [f["text"] for f in current["facts"]]
    assert "private@example.com" not in json.dumps(current)
    assert "Private name" not in json.dumps(current)
    assert client.get("/v1/jobs/profile", headers=auth(user)).json()["saved"] is False
    assert client.get("/v1/jobs/launchpad", headers=auth(other), params={"resume_id": rid}).status_code == 404
    assert client.post("/v1/jobs/launchpad/ideas", headers=auth(other),
        json=body(current)).status_code == 404
    assert client.post("/v1/jobs/launchpad/search", headers=auth(other),
        json=body(current, title="Engineer")).status_code == 404
    assert client.get("/v1/jobs/launchpad").status_code == 401


def test_fresher_search_works_without_resume_and_replay_conflicts(client: TestClient) -> None:
    user, _ = account(client, resume=False)
    current = source(client, user)
    assert not current["facts"] and not current["resumes"]
    payload = body(current, title="Graduate engineer", include_internships=True)
    response = client.post("/v1/jobs/launchpad/search", headers=auth(user), json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()
    prefs = saved["profile"]["prefs"]
    assert prefs["titles"] == ["Graduate engineer"]
    assert prefs["level"] == "fresher" and prefs["years"] == 0
    assert prefs["job_types"] == ["full_time", "internship"]
    assert saved["context"]["version"] != current["version"]
    assert client.post("/v1/jobs/launchpad/search", headers=auth(user), json=payload).status_code == 409
    assert client.post("/v1/jobs/launchpad/ideas", headers=auth(user),
        json=body(saved["context"])).status_code == 422


def test_search_preserves_unrelated_filters_and_career_change_years(client: TestClient) -> None:
    user, rid = account(client)
    prefs = source(client, user)["prefs"]
    prefs.update(titles=["Old title"], skills=["SQL"], locations=["London"], level="senior", years=7,
        workplace=["remote"], job_types=["contract"], posted_within=30, exclude=["agency"], needs_sponsorship=True)
    assert client.put("/v1/jobs/profile", headers=auth(user),
                      json={"prefs": prefs, "resume_id": rid}).status_code == 200
    current = source(client, user)
    response = client.post("/v1/jobs/launchpad/search", headers=auth(user), json=body(current,
        title="Data analyst", stage="change", include_internships=True))
    assert response.status_code == 200, response.text
    actual = response.json()["profile"]["prefs"]
    for key in ("skills", "locations", "level", "years", "workplace", "posted_within", "exclude", "needs_sponsorship"):
        assert actual[key] == prefs[key], key
    assert actual["job_types"] == ["contract", "internship"]
    assert actual["titles"] == ["Data analyst"]
    fresh = response.json()["context"]
    again = client.post("/v1/jobs/launchpad/search", headers=auth(user),
        json=body(fresh, title="Junior analyst", include_internships=False))
    assert again.json()["profile"]["prefs"]["job_types"] == ["full_time"]


def test_ai_is_grounded_and_does_not_save_preferences(client: TestClient) -> None:
    user, _ = account(client)
    current = source(client, user)
    result = client.post("/v1/jobs/launchpad/ideas", headers=auth(user), json=body(current, target="Junior developer"))
    assert result.status_code == 200, result.text
    idea = result.json()["roles"][0]
    assert result.json()["source"] == "mock"
    assert idea["title"] == "Junior developer" and idea["source_quote"] == "Python"
    assert source(client, user) == current


@pytest.mark.parametrize("bad", ["quote", "id", "duplicate", "malformed"])
def test_invalid_ai_output_is_rejected_and_failures_consume_budget(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, bad: str,
) -> None:
    user, _ = account(client)
    current = source(client, user)
    idea = {"title": "Graduate engineer", "fact_id": "0", "source_quote": "Python",
        "reason": "Explore a role using your real project skills.", "experiment": "Build a small documented example.",
        "check": "Demonstrate the example to a peer."}
    if bad == "id":
        idea["fact_id"] = "unknown"
    if bad == "quote":
        idea["source_quote"] = "Ten years at Acme"
    output = "no json" if bad == "malformed" else json.dumps({"roles": [idea, idea] if bad == "duplicate" else [idea]})
    mock = MockLLMProvider(script=[output] * 6)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    for _ in range(5):
        assert client.post("/v1/jobs/launchpad/ideas", headers=auth(user), json=body(current)).status_code == 502
    assert client.post("/v1/jobs/launchpad/ideas", headers=auth(user), json=body(current)).status_code == 429
    assert len(mock.requests) == 5 and source(client, user) == current


def test_resume_change_during_ai_and_stale_search_are_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, rid = account(client)
    current = source(client, user)

    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                row = await db.get(Resume, rid)
                assert row
                row.data = {**row.data, "skills": [{"items": ["Java"]}]}
                await db.commit()
            return await super().generate(request)

    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    assert client.post("/v1/jobs/launchpad/ideas", headers=auth(user), json=body(current)).status_code == 409
    assert client.post("/v1/jobs/launchpad/search", headers=auth(user),
        json=body(current, title="Engineer")).status_code == 409


def test_concurrent_searches_only_accept_one_version(client: TestClient) -> None:
    user, _ = account(client)
    payload = body(source(client, user), title="Graduate engineer")

    def save(_: int) -> int:
        return client.post("/v1/jobs/launchpad/search", headers=auth(user), json=payload).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, range(2))) == [200, 409]


def test_hidden_sections_are_not_ai_evidence() -> None:
    from orbit_api.job_portal.launchpad import resume_facts
    assert resume_facts({"hidden": ["skills"], "skills": [{"items": ["Secret skill"]}]}) == []


def test_many_skills_do_not_hide_projects_or_education() -> None:
    from orbit_api.job_portal.launchpad import resume_facts
    facts = resume_facts({"skills": [{"items": [f"Skill {i}" for i in range(40)]}],
        "projects": [{"name": "Community garden", "description": "Organised a volunteer planting day"}],
        "education": [{"degree": "BA", "field": "Design"}]})
    assert len([f for f in facts if f["label"] == "Skill"]) == 10
    assert {"Community garden", "Design"} <= {f["text"] for f in facts}


@pytest.mark.parametrize("types,internships,expected", [
    ([], True, ["full_time", "part_time", "contract", "internship"]),
    (["internship"], False, ["full_time", "part_time", "contract"]),
    (["contract", "internship"], False, ["contract"]),
])
def test_internship_toggle_preserves_other_types(types: list[str], internships: bool, expected: list[str]) -> None:
    from orbit_api.job_portal.launchpad import SearchIn, search_prefs
    from orbit_api.job_portal.profile import JobPrefs
    prefs = JobPrefs.model_validate({"job_types": types, "level": "senior", "years": 8})
    updated = search_prefs(prefs, SearchIn(version="a" * 64, stage="experienced", title="Designer",
                                         include_internships=internships))
    assert updated.job_types == expected and updated.years == 8 and updated.level == "senior"
