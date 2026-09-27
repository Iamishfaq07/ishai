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


def test_document_edit_rechunks_and_enforces_ownership(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/documents/text", headers=h,
                    json={"title": "JD", "kind": "job_description", "text": "Backend role. " + "Python. " * 10})
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]

    # Text docs are editable and round-trip their source text.
    got = client.get(f"/v1/documents/{doc_id}/text", headers=h)
    assert got.status_code == 200
    assert got.json()["editable"] is True and "Python" in got.json()["text"]

    # Editing content re-chunks (status stays ready, chunks recomputed) and edits title/kind.
    new_text = "Senior data engineering role. " + "Spark and Airflow. " * 12
    patched = client.patch(f"/v1/documents/{doc_id}", headers=h,
                           json={"title": "Data JD", "kind": "notes", "text": new_text})
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "Data JD" and patched.json()["kind"] == "notes"
    assert patched.json()["status"] == "ready" and patched.json()["chunk_count"] > 0
    assert "Spark" in client.get(f"/v1/documents/{doc_id}/text", headers=h).json()["text"]

    # Another user can neither read nor edit it (same 404 as "not found").
    other = _register(client)
    assert client.get(f"/v1/documents/{doc_id}/text", headers=other).status_code == 404
    assert client.patch(f"/v1/documents/{doc_id}", headers=other, json={"title": "hijack"}).status_code == 404


def test_session_cookie_policy(monkeypatch: Any) -> None:
    # The web app reaches the API through its own /api proxy (first-party), so production uses SameSite=Lax;
    # Secure. SameSite=None stays available for a web app that calls the API cross-site.
    from types import SimpleNamespace

    from orbit_api.auth import routes

    def env(name: str, samesite: str = "lax") -> None:
        monkeypatch.setattr(routes, "get_settings", lambda: SimpleNamespace(env=name, cookie_samesite=samesite))

    env("production")
    assert routes._cookie_policy() == (True, "lax")
    env("production", "none")
    assert routes._cookie_policy() == (True, "none")
    env("development")
    assert routes._cookie_policy() == (False, "lax")
    env("development", "none")
    assert routes._cookie_policy() == (True, "none")  # browsers reject SameSite=None without Secure


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

    detail = _wait_report(client, h, sid)
    assert detail["session"]["status"] == "ended" and detail["session"]["report_status"] == "ready"
    assert detail["session"]["question_count"] == 2
    # the batched list endpoint agrees with the per-session detail
    other = client.post("/v1/sessions", headers=h, json={"title": "empty"}).json()["id"]
    listed = {s["id"]: s for s in client.get("/v1/sessions", headers=h).json()}
    assert listed[sid]["question_count"] == 2 and sorted(listed[sid]["document_ids"]) == sorted([resume, jd])
    assert listed[other]["question_count"] == 0 and listed[other]["document_ids"] == []
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
    detail = _wait_report(client, h, sid)
    assert detail["session"]["status"] == "ended" and detail["summary"] is not None
    assert "duration_seconds" in detail["session"]

    ticket3 = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h)
    assert ticket3.status_code == 409  # ended sessions are closed for good


def _wait_report(client: TestClient, h: dict[str, str], sid: str, timeout_s: float = 10) -> dict[str, Any]:
    """Reports are a durable background job: poll the session until the job has written it."""
    deadline = time.monotonic() + timeout_s
    while True:
        detail: dict[str, Any] = client.get(f"/v1/sessions/{sid}", headers=h).json()
        if detail["session"]["report_status"] in ("ready", "failed") or time.monotonic() > deadline:
            return detail
        time.sleep(0.05)


def test_rest_end_generates_report_for_detached_session(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "closed from history page"}).json()["id"]
    ended = client.post(f"/v1/sessions/{sid}/end", headers=h).json()
    assert ended["status"] == "ended" and ended["report_status"] == "pending"  # returns without waiting
    detail = _wait_report(client, h, sid)
    assert detail["session"]["report_status"] == "ready" and detail["summary"] is not None
    # ending again is a no-op: no second report job
    assert client.post(f"/v1/sessions/{sid}/end", headers=h).json()["report_status"] == "ready"


def test_ending_a_live_session_does_not_wait_for_the_report(client: TestClient, monkeypatch: Any) -> None:
    import asyncio
    import threading

    from orbit_api.sessions import report

    release = threading.Event()  # set from the test thread; the app runs in the TestClient's loop thread
    real = report.generate_report

    async def slow_report(session_id: str) -> dict[str, Any]:
        for _ in range(100):  # a report that takes "forever" (until released)
            if release.is_set():
                break
            await asyncio.sleep(0.05)
        return await real(session_id)

    monkeypatch.setattr(report, "generate_report", slow_report)
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "quick exit"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        t0 = time.monotonic()
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
        assert time.monotonic() - t0 < 2  # session.ended arrives before the report exists
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["report_status"] == "pending"
    release.set()
    assert _wait_report(client, h, sid)["session"]["report_status"] == "ready"


def _live(client: TestClient, h: dict[str, str], sid: str) -> Any:
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    return client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}")


def _close_code(ws: Any) -> int:
    from starlette.websockets import WebSocketDisconnect

    try:
        while True:
            ws.receive_text()
    except WebSocketDisconnect as e:
        return int(e.code)


def test_live_socket_takeover_and_one_live_session_per_account(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    from orbit_api.auth.security import issue_ticket

    h = _register(client)
    a, b = (client.post("/v1/sessions", headers=h, json={"title": t}).json()["id"] for t in ("Acme loop", "b"))
    with _live(client, h, a) as ws_a:
        _collect(ws_a, lambda ev: any(e["type"] == "session.started" for e in ev))
        # rejoining the same session elsewhere takes it over; the old socket gets a terminal 4010
        with _live(client, h, a) as ws_a2:
            _collect(ws_a2, lambda ev: any(e["type"] == "session.started" for e in ev))
            assert _close_code(ws_a) == 4010

            # a second live session is refused at the ticket, before any audio/LLM spend, naming the running one
            r = client.post(f"/v1/sessions/{b}/live-ticket", headers=h)
            assert r.status_code == 409
            detail = r.json()["detail"]
            assert detail["code"] == "live_session_active" and detail["session_id"] == a
            assert detail["title"] == "Acme loop"
            # the socket check is a backstop for a ticket minted some other way
            me = client.get("/v1/auth/me", headers=h).json()["id"]
            try:
                with client.websocket_connect(f"/v1/sessions/{b}/live?ticket={issue_ticket(me, b)}") as ws_b:
                    ws_b.receive_text()
                raise AssertionError("second live session accepted")
            except WebSocketDisconnect as e:
                assert e.code == 4029

            # "End it and use this one": ending the running session over HTTP stops its socket too
            assert client.post(f"/v1/sessions/{a}/end", headers=h).status_code == 200
            _collect(ws_a2, lambda ev: any(e["type"] == "session.ended" for e in ev))
            assert _close_code(ws_a2) == 4009
        with _live(client, h, b) as ws_b:  # the slot is free
            _collect(ws_b, lambda ev: any(e["type"] == "session.started" for e in ev))


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_screenshot_is_answered_over_the_live_socket(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "coding", "type": "coding"}).json()["id"]
    files = {"image": ("shot.png", PNG, "image/png")}
    # not live yet → nothing to stream the answer to
    assert client.post(f"/v1/sessions/{sid}/screenshots", headers=h, files=files).status_code == 409
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        bad = client.post(f"/v1/sessions/{sid}/screenshots", headers=h,
                          files={"image": ("x.png", b"not an image", "image/png")})
        assert bad.status_code == 415
        r = client.post(f"/v1/sessions/{sid}/screenshots", headers=h, files=files)
        assert r.status_code == 202 and r.json()["screenshot_id"]
        events = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        detected = next(e["data"] for e in events if e["type"] == "question.detected")
        started = next(e["data"] for e in events if e["type"] == "answer.started")
        assert detected["question_id"] == r.json()["screenshot_id"] and "Screenshot" in detected["text"]
        assert started["source"] == "screenshot"
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    assert client.get("/v1/usage", headers=h).json()["screenshots_used"] == 1



def test_abandoned_sessions_are_ended_and_reported(client: TestClient) -> None:
    """A session closed without End (tab closed, app quit) doesn't stay "live" forever: once it has had no
    connection and no activity for ORBIT_ABANDONED_SESSION_MIN, the sweep ends it and writes its report."""
    from datetime import UTC, datetime, timedelta

    from orbit_api.sessions.cleanup import end_abandoned_sessions

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "left open"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["status"] == "live"

    assert client.portal is not None
    run = client.portal.call  # the app's own event loop (its DB engine lives there)
    # Not idle long enough yet: left alone (a dropped connection must still be resumable).
    assert run(end_abandoned_sessions, datetime.now(UTC)) == 0
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["status"] == "live"

    # Past the cutoff: ended as if End were pressed, with its report.
    assert run(end_abandoned_sessions, datetime.now(UTC) + timedelta(hours=2)) >= 1
    detail = _wait_report(client, h, sid)
    assert detail["session"]["status"] == "ended" and detail["session"]["ended_at"] is not None
    assert detail["session"]["report_status"] == "ready"
    assert client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).status_code == 409
