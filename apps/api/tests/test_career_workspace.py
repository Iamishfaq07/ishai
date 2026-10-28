"""Account ownership, compare-and-swap and export of personal career progress."""
import uuid

from fastapi.testclient import TestClient


def account(client: TestClient) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": f"workspace-{uuid.uuid4().hex}@example.com",
                                            "password": "a strong workspace password"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_state_is_owned_versioned_and_exported(client: TestClient) -> None:
    first, other = account(client), account(client)
    path = "/v1/career/workspace/readiness"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=first).json()["revision"] == 0
    data = [{"skill": "SQL", "evidence": []}]
    assert client.put(path, headers=first, json={"revision": 0, "data": data}).json()["revision"] == 1
    assert client.get(path, headers=other).json()["data"] is None
    assert client.put(path, headers=first, json={"revision": 0, "data": []}).status_code == 409
    assert client.put(path, headers=first, json={"revision": 1, "data": []}).json()["revision"] == 2
    assert client.put(path, headers=first, json={"revision": 1, "data": data}).status_code == 409
    exported = client.get("/v1/auth/me/export", headers=first)
    assert exported.status_code == 200
    assert exported.json()["career_workspace_states"][0]["revision"] == 2


def test_state_rejects_unknown_kind_wrong_shape_and_large_payload(client: TestClient) -> None:
    h = account(client)
    assert client.put("/v1/career/workspace/arbitrary", headers=h,
                      json={"revision": 0, "data": {}}).status_code == 422
    assert client.put("/v1/career/workspace/readiness", headers=h,
                      json={"revision": 0, "data": {}}).status_code == 422
    assert client.put("/v1/career/workspace/campus", headers=h,
                      json={"revision": 0, "data": {"large": "x" * 129000}}).status_code == 422


def test_nested_workspace_contracts_cannot_store_unreadable_data(client: TestClient) -> None:
    h = account(client)
    invalid = [{"skill": "SQL", "evidence": [{"at": "not-a-timestamp", "score": 3,
                                             "kind": "self", "note": ""}]}]
    assert client.put("/v1/career/workspace/readiness", headers=h,
                      json={"revision": 0, "data": invalid}).status_code == 422
    assert client.put("/v1/career/workspace/campus", headers=h,
                      json={"revision": 0, "data": {"marks": None, "drives": []}}).status_code == 422
    assert client.put("/v1/career/workspace/projects", headers=h,
                      json={"revision": 0, "data": {"work": {"unknown": {}}}}).status_code == 422
    assert client.get("/v1/career/workspace/readiness", headers=h).json()["revision"] == 0


def test_transition_plan_requires_evidence_and_preserves_account_boundaries(client: TestClient) -> None:
    h, other = account(client), account(client)
    path = "/v1/career/workspace/transition"
    row = {"id": "sql", "requirement": "SQL", "evidence": "", "nextAction": "Build cohort query",
           "due": "2026-11-01", "state": "demonstrated"}
    plan = {"currentRole": "Support", "targetRole": "Analyst", "motivation": "Data work", "requirements": [row]}
    assert client.put(path, headers=h, json={"revision": 0, "data": plan}).status_code == 422
    row["state"] = "practising"
    assert client.put(path, headers=h, json={"revision": 0, "data": plan}).status_code == 200
    assert client.get(path, headers=other).json()["data"] is None
    assert client.get(path, headers=h).json()["data"]["targetRole"] == "Analyst"
    row["due"] = "2026-99-99"
    assert client.put(path, headers=h, json={"revision": 1, "data": plan}).status_code == 422


def test_writing_tools_save_private_validated_drafts(client: TestClient) -> None:
    first, other = account(client), account(client)
    drafts = {
        "tool_star": {"question": "A difficult decision", "answer": "My private answer"},
        "tool_bullets": {"did": "Built reports", "result": "Faster review", "measure": "2 hours", "pasted": "Original"},
        "tool_gap": {"reason": "health", "from": "2024", "to": "2025", "during": "", "role": "Analyst"},
    }
    for kind, data in drafts.items():
        path = f"/v1/career/workspace/{kind}"
        saved = client.put(path, headers=first, json={"revision": 0, "data": data})
        assert saved.status_code == 200, saved.text
        assert client.get(path, headers=first).json()["data"] == data
        assert client.get(path, headers=other).json()["data"] is None
        assert client.put(path, headers=first, json={"revision": 0, "data": data}).status_code == 409
        assert client.put(path, headers=first, json={"revision": 1, "data": {**data, "unknown": 1}}).status_code == 422
    for kind, bad in [("tool_star", {"question": "Q", "answer": "x" * 20001}),
                      ("tool_gap", {**drafts["tool_gap"], "reason": "unknown"}),
                      ("tool_bullets", {**drafts["tool_bullets"], "did": None})]:
        assert client.put(f"/v1/career/workspace/{kind}", headers=first,
                          json={"revision": 1, "data": bad}).status_code == 422
    exported = client.get("/v1/auth/me/export", headers=first).json()["career_workspace_states"]
    assert {row["kind"] for row in exported} == set(drafts)
