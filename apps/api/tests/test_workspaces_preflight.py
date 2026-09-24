import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.test_api import _doc, _register

SETUP = {"name": "Google — Senior Security Engineer", "company": "Google", "role": "Senior Security Engineer",
         "session_type": "interview", "length": "standard", "style": "story", "auto_answer": True}


def test_workspace_crud_and_ownership(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    resume = _doc(client, h, "resume_sample")
    ws = client.post("/v1/workspaces", headers=h, json={**SETUP, "document_ids": [resume]})
    assert ws.status_code == 201, ws.text
    wid = ws.json()["id"]
    assert ws.json()["document_ids"] == [resume] and ws.json()["session_count"] == 0

    # someone else's document can't be attached; someone else can't see or edit it
    theirs = _doc(client, other, "jd_sample")
    assert client.post("/v1/workspaces", headers=h, json={**SETUP, "document_ids": [theirs]}).status_code == 404
    assert client.get(f"/v1/workspaces/{wid}", headers=other).status_code == 404
    assert client.put(f"/v1/workspaces/{wid}", headers=other, json=SETUP).status_code == 404
    assert client.get("/v1/workspaces", headers=other).json() == []

    upd = client.put(f"/v1/workspaces/{wid}", headers=h, json={**SETUP, "name": "Google SWE", "document_ids": []})
    assert upd.json()["name"] == "Google SWE" and upd.json()["document_ids"] == []
    assert client.post("/v1/workspaces", headers=h, json={**SETUP, "session_type": "bogus"}).status_code == 422


def test_session_from_workspace_uses_its_documents_and_survives_deletion(client: TestClient) -> None:
    h = _register(client)
    resume, jd = _doc(client, h, "resume_sample"), _doc(client, h, "jd_sample")
    wid = client.post("/v1/workspaces", headers=h, json={**SETUP, "document_ids": [resume, jd]}).json()["id"]
    s = client.post("/v1/sessions", headers=h, json={"title": "From setup", "workspace_id": wid})
    assert s.status_code == 201, s.text
    assert sorted(s.json()["document_ids"]) == sorted([resume, jd]) and s.json()["workspace_id"] == wid
    listed = client.get("/v1/workspaces", headers=h).json()
    assert listed[0]["id"] == wid and listed[0]["session_count"] == 1 and listed[0]["last_used_at"]
    # explicit documents win over the workspace's
    s2 = client.post("/v1/sessions", headers=h, json={"title": "x", "workspace_id": wid, "document_ids": [jd]})
    assert s2.json()["document_ids"] == [jd]
    # a workspace id that isn't yours is rejected
    other = _register(client)
    assert client.post("/v1/sessions", headers=other, json={"title": "x", "workspace_id": wid}).status_code == 404

    assert client.delete(f"/v1/workspaces/{wid}", headers=h).status_code == 204
    kept = client.get(f"/v1/sessions/{s.json()['id']}", headers=h).json()["session"]
    assert kept["workspace_id"] is None and sorted(kept["document_ids"]) == sorted([resume, jd])


def test_preflight_reports_demo_providers_and_allowance(client: TestClient) -> None:
    from orbit_api import preflight

    preflight._cache.clear()
    h = _register(client)
    out = client.get("/v1/preflight", headers=h).json()
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["server"]["status"] == "ok"
    assert checks["llm"]["status"] == "warn" and "Demo" in checks["llm"]["detail"] and checks["llm"]["fix"]
    assert checks["stt"]["status"] == "warn"
    assert checks["vision"]["status"] == "ok"
    assert checks["minutes"]["status"] in ("ok", "warn")
    assert out["ok"] is True  # warnings never block
    assert client.get("/v1/preflight").status_code == 401


def test_preflight_explains_a_failing_ai_and_an_outdated_app(client: TestClient,
                                                             monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import preflight
    from orbit_api.providers.llm.base import LLMError

    class Broken:
        name = "deepseek"

        async def generate(self, _req: Any) -> Any:
            raise LLMError("http_401", "bad key")

        def supports_vision(self) -> bool:
            return True

    async def latest() -> str:
        return "9.9.9"

    preflight._cache.clear()
    monkeypatch.setattr(preflight, "get_llm_provider", lambda: Broken())
    monkeypatch.setattr(preflight, "_latest_version", latest)
    h = _register(client)
    out = client.get("/v1/preflight?app_version=0.1.8", headers=h).json()
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["llm"]["status"] == "fail" and "rejected" in checks["llm"]["fix"]
    assert checks["app"]["status"] == "warn" and "9.9.9" in checks["app"]["detail"]
    assert out["ok"] is False
    preflight._cache.clear()


def test_preflight_fails_when_out_of_live_minutes(client: TestClient) -> None:
    from orbit_api import preflight
    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    preflight._cache.clear()
    _register(client)  # never the dev-mode first user
    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]

    async def burn() -> None:
        async with sessionmaker()() as db:
            db.add(UsageEvent(user_id=uid, metric="live_seconds", quantity=31 * 60,
                              idempotency_key=f"t:{uuid.uuid4()}"))
            await db.commit()

    assert client.portal is not None
    client.portal.call(burn)
    checks = {c["id"]: c for c in client.get("/v1/preflight", headers=h).json()["checks"]}
    assert checks["minutes"]["status"] == "fail" and checks["minutes"]["fix"]


def test_preflight_never_claims_up_to_date_when_it_cannot_check(client: TestClient,
                                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import preflight

    async def unknown() -> None:
        return None

    preflight._cache.clear()
    monkeypatch.setattr(preflight, "_latest_version", unknown)
    h = _register(client)
    app = {c["id"]: c for c in client.get("/v1/preflight?app_version=0.1.8", headers=h).json()["checks"]}["app"]
    assert app["status"] == "ok" and "couldn't check" in app["detail"] and "up to date" not in app["detail"]
