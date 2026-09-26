"""Large JSON responses are gzipped; auth responses (tokens next to user input) never are."""

from fastapi.testclient import TestClient

from tests.test_api import _register


def test_large_responses_are_gzipped_but_auth_is_not(client: TestClient) -> None:
    h = _register(client)
    for i in range(12):  # enough sessions for a >1 kB list
        client.post("/v1/sessions", headers=h, json={"title": f"Interview number {i}"})
    listed = client.get("/v1/sessions", headers={**h, "Accept-Encoding": "gzip"})
    assert listed.status_code == 200 and listed.headers.get("content-encoding") == "gzip"
    assert len(listed.json()) == 12  # still readable after decompression

    small = client.get("/v1/auth/config", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers
    me = client.get("/v1/auth/me", headers={**h, "Accept-Encoding": "gzip"})
    assert me.status_code == 200 and "content-encoding" not in me.headers
