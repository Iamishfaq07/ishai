"""Preflight: blockers vs warnings (brief §15) and an honest Deepgram check (§16)."""

import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from orbit_api import preflight
from orbit_api.preflight import Check


def _checks(**statuses: str) -> list[Check]:
    return [Check(id=i, label=i, status=s, detail="") for i, s in statuses.items()]  # type: ignore[arg-type]


def test_only_failing_blockers_block() -> None:
    out = preflight._finish(_checks(server="ok", llm="ok", stt="ok", vision="warn", screenshots="warn", app="warn"))
    assert out.ok and out.blockers == 0
    assert {c.id: c.severity for c in out.checks}["vision"] == "warning"
    out = preflight._finish(_checks(server="ok", llm="fail", stt="fail", minutes="ok"))
    assert not out.ok and out.blockers == 2 and all(c.severity == "blocker" for c in out.checks)
    assert preflight._finish(_checks(llm="warn")).ok  # a slow AI is a warning, not a blocker


def test_endpoint_reports_severity(client: TestClient) -> None:
    r = client.post("/v1/auth/register", json={"email": f"pf-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "preflight password 1"})
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    body = client.get("/v1/preflight", headers=h).json()
    assert "blockers" in body and all(c["severity"] in ("blocker", "warning") for c in body["checks"])
    sev = {c["id"]: c["severity"] for c in body["checks"]}
    assert sev["server"] == "blocker" and sev["llm"] == "blocker" and sev.get("vision", "warning") == "warning"


class _Cfg:
    stt_provider = "deepgram"
    deepgram_api_key = "k"
    deepgram_model = "nova-3"


_REAL_CLIENT = httpx.AsyncClient


def _projects(status: int) -> Any:
    def make(*a: Any, **k: Any) -> httpx.AsyncClient:
        return _REAL_CLIENT(transport=httpx.MockTransport(lambda r: httpx.Response(status, json={})))

    return make


@pytest.mark.parametrize(("handshake", "status", "detail"), [
    ((420, None), "ok", "Streaming transcription verified"),
    ((5000, "HTTP 400"), "fail", "account reachable, but live streaming failed (HTTP 400)"),
    ((6000, "TimeoutError"), "fail", "live streaming failed (TimeoutError)"),
])
async def test_deepgram_check_distinguishes_account_from_streaming(
        monkeypatch: pytest.MonkeyPatch, handshake: tuple[int, str | None], status: str, detail: str) -> None:
    monkeypatch.setattr(preflight, "get_effective_config", lambda: _Cfg())
    monkeypatch.setattr(preflight.httpx, "AsyncClient", _projects(200))

    async def fake_handshake(key: str, model: str) -> tuple[int, str | None]:
        return handshake

    monkeypatch.setattr(preflight, "_deepgram_stream_handshake", fake_handshake)
    c = await preflight._stt_check()
    assert c.status == status and detail in c.detail


async def test_deepgram_account_problems_are_named(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(preflight, "get_effective_config", lambda: _Cfg())
    for code, text in ((401, "key was rejected"), (402, "out of credit"), (503, "streaming not verified")):
        monkeypatch.setattr(preflight.httpx, "AsyncClient", _projects(code))
        assert text in (await preflight._stt_check()).detail
