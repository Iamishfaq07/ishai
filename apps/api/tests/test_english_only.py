"""Orbit is English only: sessions and saved setups are pinned to English whatever a client sends."""

from fastapi.testclient import TestClient

from tests.test_api import _register


def test_sessions_and_setups_are_english_only(client: TestClient) -> None:
    h = _register(client)
    s = client.post("/v1/sessions", headers=h, json={"title": "x", "language": "hi", "answer_language": "fr"})
    assert s.status_code == 201, s.text
    assert s.json()["language"] == "en" and s.json()["answer_language"] is None

    ws = client.post("/v1/workspaces", headers=h, json={
        "name": "Acme", "language": "es", "answer_language": "de", "document_ids": []}).json()
    assert ws["language"] == "en" and ws["answer_language"] is None
    updated = client.put(f"/v1/workspaces/{ws['id']}", headers=h, json={
        "name": "Acme", "language": "ja", "document_ids": []}).json()
    assert updated["language"] == "en"
