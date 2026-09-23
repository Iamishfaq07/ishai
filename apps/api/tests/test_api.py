"""Integration + E2E through the real HTTP/WebSocket stack with mock STT/LLM (spec §73, §82)."""

import json
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

FIXTURES = Path(__file__).parent / "fixtures"


def _register(client: TestClient) -> dict[str, str]:
    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
    assert r.status_code == 201, r.text
    client.cookies.clear()  # use Bearer auth like the desktop app, so users don't bleed between calls
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _doc(client: TestClient, h: dict[str, str], name: str) -> str:
    body = json.loads((FIXTURES / f"{name}.json").read_text())
    r = client.post("/v1/documents/text", json=body, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "ready" and r.json()["chunk_count"] > 0
    return str(r.json()["id"])


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["providers"] == {"llm": "mock", "stt": "mock"}
    assert r.headers["x-content-type-options"] == "nosniff"


def test_auth_flow(client: TestClient) -> None:
    email = f"a-{uuid.uuid4().hex[:6]}@example.com"
    assert client.post("/v1/auth/register", json={"email": email, "password": "short"}).status_code == 422
    assert client.post("/v1/auth/register", json={"email": email, "password": "long enough pw"}).status_code == 201
    assert client.post("/v1/auth/register", json={"email": email, "password": "long enough pw"}).status_code == 409
    client.cookies.clear()
    assert client.get("/v1/auth/me").status_code == 401
    assert client.post("/v1/auth/login", json={"email": email, "password": "wrong password"}).status_code == 401
    r = client.post("/v1/auth/login", json={"email": email, "password": "long enough pw"})
    assert r.status_code == 200 and "orbit_session" in r.cookies
    assert client.get("/v1/auth/me").json()["email"] == email  # cookie auth (web)
    client.cookies.clear()
    assert client.get("/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_document_upload_validation_and_ownership(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/documents", headers=h, data={"kind": "notes"},
                    files={"file": ("notes.txt", b"Project notes\n\nWe migrated to Kafka in 2023.", "text/plain")})
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]
    fake_pdf = client.post("/v1/documents", headers=h, data={"kind": "resume"},
                           files={"file": ("cv.pdf", b"not a pdf at all", "application/pdf")})
    assert fake_pdf.status_code == 422
    exe = client.post("/v1/documents", headers=h, data={"kind": "other"},
                      files={"file": ("x.exe", b"MZ....", "application/octet-stream")})
    assert exe.status_code == 422

    other = _register(client)
    assert client.delete(f"/v1/documents/{doc_id}", headers=other).status_code == 404
    assert client.post("/v1/sessions", headers=other,
                       json={"title": "x", "document_ids": [doc_id]}).status_code == 404
    assert client.delete(f"/v1/documents/{doc_id}", headers=h).status_code == 204


def test_free_plan_document_quota(client: TestClient) -> None:
    h = _register(client)
    for i in range(3):
        assert client.post("/v1/documents/text", headers=h,
                           json={"title": f"n{i}", "kind": "notes", "text": "x" * 40}).status_code == 201
    r = client.post("/v1/documents/text", headers=h, json={"title": "n4", "kind": "notes", "text": "x" * 40})
    assert r.status_code == 402


def test_ws_rejects_bad_ticket_and_other_users_session(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "t"}).json()["id"]
    other = _register(client)
    assert client.post(f"/v1/sessions/{sid}/live-ticket", headers=other).status_code == 404
    assert client.get(f"/v1/sessions/{sid}", headers=other).status_code == 404
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket=forged") as ws:
            ws.receive_text()
        raise AssertionError("forged ticket accepted")
    except WebSocketDisconnect as e:
        assert e.code == 4001


def _collect(ws: Any, until: Any, timeout_s: float = 20) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        ev = json.loads(ws.receive_text())
        events.append(ev)
        if until(events):
            return events
    raise AssertionError(f"timed out; got {[e['type'] for e in events]}")


def test_core_acceptance_flow(client: TestClient) -> None:
    """Spec §82: resume+JD → interview → auto question → grounded streamed answer → follow-up → end → history."""
    h = _register(client)
    resume, jd = _doc(client, h, "resume_sample"), _doc(client, h, "jd_sample")
    sid = client.post("/v1/sessions", headers=h, json={
        "title": "AppSec interview", "type": "interview", "role": "Senior AppSec Engineer",
        "document_ids": [resume, jd]}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]

    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        events = _collect(ws, lambda ev: sum(e["type"] == "answer.completed" for e in ev) >= 2)

        types = [e["type"] for e in events]
        detected = [e["data"] for e in events if e["type"] == "question.detected"]
        # fillers ("Okay.", "Interesting.", "Thanks for joining today.") never triggered
        assert [d["text"] for d in detected] == ["Tell me about yourself.", "What was your biggest challenge there?"]
        assert detected[0]["type"] == "resume" and not detected[0]["is_follow_up"]
        assert detected[1]["is_follow_up"]
        assert "transcript.partial" in types and "transcript.final" in types
        assert types.index("answer.started") < types.index("answer.chunk") < types.index("answer.completed")

        completed = [e["data"] for e in events if e["type"] == "answer.completed"]
        first = completed[0]["answer"]
        assert first["talking_points"] and first["question"] == "Tell me about yourself."
        assert any(c.startswith("resume:") for c in first["context_used"])  # grounded in resume
        assert completed[0]["latency"]["first_token_ms"] is not None
        states = [e["data"]["state"] for e in events if e["type"] == "state.changed"]
        for s in ("speech_detected", "question_detected", "generating", "streaming", "answer_complete",
                  "follow_up_detected"):
            assert s in states, (s, states)

        # manual answer + chat share the live context
        ws.send_text(json.dumps({"type": "chat.message", "data": {"text": "make this shorter"}}))
        chat = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        started = next(e["data"] for e in chat if e["type"] == "answer.started")
        assert started["source"] == "chat"

        ws.send_text(json.dumps({"type": "not.a.thing", "data": {}}))
        err = _collect(ws, lambda ev: any(e["type"] == "error" for e in ev))
        assert err[-1]["data"]["code"] == "unknown_event"

        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))

    detail = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert detail["session"]["status"] == "ended"
    assert detail["session"]["question_count"] == 2
    speakers = {t["speaker"] for t in detail["turns"]}
    assert speakers == {"interviewer", "candidate"}
    assert len(detail["answers"]) >= 2
    assert detail["summary"]["questions_asked"][0] == "Tell me about yourself."
    md = client.get(f"/v1/sessions/{sid}/export.md", headers=h)
    assert md.status_code == 200 and "Tell me about yourself." in md.text
    usage = client.get("/v1/usage", headers=h).json()
    assert usage["plan"] == "free" and usage["live_minutes_limit"] == 30
    assert client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).status_code == 409


def test_privacy_toggle_skips_transcript_storage(client: TestClient) -> None:
    h = _register(client)
    assert client.patch("/v1/auth/me/privacy", headers=h, json={"store_transcripts": False}).status_code == 200
    sid = client.post("/v1/sessions", headers=h, json={"title": "private"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "meeting", "speed": 25}}))
        _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["turns"] == []


def test_delete_account_cascades(client: TestClient) -> None:
    h = _register(client)
    _doc(client, h, "resume_sample")
    assert client.delete("/v1/auth/me", headers=h).status_code == 204
    assert client.get("/v1/documents", headers=h).status_code == 401


def test_network_drop_does_not_end_session_and_client_can_reconnect(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "flaky wifi"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
    # socket dropped without session.end → still resumable, no report yet
    detail = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert detail["session"]["status"] == "live" and detail["summary"] is None

    # a used ticket can't be replayed
    try:
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
            ws.receive_text()
        raise AssertionError("ticket replay accepted")
    except WebSocketDisconnect as e:
        assert e.code == 4001

    ticket2 = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket2}") as ws:
        ws.send_text(json.dumps({"type": "session.start", "data": {"settings": {"length": "short"}}}))
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    detail = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert detail["session"]["status"] == "ended" and detail["summary"] is not None
    assert "duration_seconds" in detail["session"]

    ticket3 = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h)
    assert ticket3.status_code == 409  # ended sessions are closed for good


def test_rest_end_generates_report_for_detached_session(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "closed from history page"}).json()["id"]
    assert client.post(f"/v1/sessions/{sid}/end", headers=h).json()["status"] == "ended"
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["summary"] is not None
