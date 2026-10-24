from fastapi.testclient import TestClient

from tests.test_career_workspace import account

PLAN = {"currentRole": "Support", "targetRole": "Analyst", "motivation": "Data work", "requirements": [
    {"id": "sql", "requirement": "Write SQL", "evidence": "", "state": "practising",
     "nextAction": "Build query", "due": ""}]}


def test_checkpoints_are_owned_immutable_exported_and_explicitly_deleted(client: TestClient) -> None:
    h, other = account(client), account(client)
    plan_path = "/v1/career/workspace/transition"
    history = "/v1/career/transition/checkpoints"
    assert client.post(history, headers=h, json={"revision": 1, "note": "First week"}).status_code == 409
    assert client.put(plan_path, headers=h, json={"revision": 0, "data": PLAN}).status_code == 200
    assert client.post(history, headers=h, json={"revision": 2, "note": "Wrong version"}).status_code == 409
    assert client.post(history, headers=h, json={"revision": 1, "note": "   "}).status_code == 422
    captured = client.post(history, headers=h, json={"revision": 1, "note": "First week"})
    assert captured.status_code == 201, captured.text
    identity = captured.json()["id"]
    assert client.post(history, headers=h, json={"revision": 1, "note": "Duplicate"}).status_code == 409
    changed = {**PLAN, "targetRole": "Backend developer", "requirements": []}
    assert client.put(plan_path, headers=h, json={"revision": 1, "data": changed}).status_code == 200
    rows = client.get(history, headers=h).json()
    assert rows[0]["plan"] == PLAN and rows[0]["revision"] == 1
    assert client.get(history, headers=other).json() == []
    assert client.delete(f"{history}/{identity}", headers=other).status_code == 404
    exported = client.get("/v1/auth/me/export", headers=h).json()["career_workspace_states"]
    checkpoint = next(row for row in exported if row["kind"] == "transition_checkpoints")
    assert checkpoint["data"][0]["note"] == "First week"
    assert client.delete(f"{history}/{identity}", headers=h).status_code == 204
    assert client.get(history, headers=h).json() == []
