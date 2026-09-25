"""User data controls (brief §41–§43): report retry, transcript deletion, full export, verified email change."""

import json
import re
import uuid
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.providers.email import DevOutbox, get_email_sender
from tests.test_api import _collect, _live, _wait_report

PW = "data controls password 1"


def _user(c: TestClient) -> tuple[str, dict[str, str]]:
    email = f"dc-{uuid.uuid4().hex[:8]}@example.com"
    r = c.post("/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201
    c.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mail(to: str, path: str) -> str:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    m = next(x for x in reversed(sender.sent) if x.to == to and path in x.text)
    token = re.search(re.escape(path) + r"\?token=([\w-]+)", m.text)
    assert token
    return token.group(1)


def _ended_session(c: TestClient, h: dict[str, str]) -> str:
    sid = c.post("/v1/sessions", headers=h, json={"title": "dc"}).json()["id"]
    with _live(c, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 50}}))
        _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev), timeout_s=30)
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    return str(sid)


def _set_report_job(c: TestClient, sid: str, status: str) -> None:
    from sqlalchemy import update

    from orbit_api import jobs
    from orbit_api.db import sessionmaker
    from orbit_api.models import Job

    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(Job).where(Job.dedupe_key == jobs.report_key(sid)).values(status=status))
            await db.commit()

    assert c.portal is not None
    c.portal.call(go)


# ---- report retry ------------------------------------------------------------------------------------------


def test_failed_report_can_be_retried(client: TestClient) -> None:
    _, h = _user(client)
    sid = _ended_session(client, h)
    _set_report_job(client, sid, "failed")
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["report_status"] == "failed"
    r = client.post(f"/v1/sessions/{sid}/report/retry", headers=h)
    assert r.status_code == 200 and r.json()["report_status"] in ("pending", "ready")


def test_retry_refused_while_live_and_noop_when_ready(client: TestClient) -> None:
    _, h = _user(client)
    live = client.post("/v1/sessions", headers=h, json={"title": "not ended"}).json()["id"]
    assert client.post(f"/v1/sessions/{live}/report/retry", headers=h).status_code == 409
    sid = _ended_session(client, h)
    assert _wait_report(client, h, sid)["session"]["report_status"] == "ready"
    assert client.post(f"/v1/sessions/{sid}/report/retry", headers=h).json()["report_status"] == "ready"


# ---- transcript deletion -----------------------------------------------------------------------------------


def test_delete_transcript_keeps_answers(client: TestClient) -> None:
    _, h = _user(client)
    sid = _ended_session(client, h)
    before = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert before["turns"] and before["answers"]
    assert client.delete(f"/v1/sessions/{sid}/transcript", headers=h).status_code == 204
    after = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert after["turns"] == [] and after["answers"] == before["answers"]
    _, other = _user(client)
    assert client.delete(f"/v1/sessions/{sid}/transcript", headers=other).status_code == 404


# ---- export ------------------------------------------------------------------------------------------------


def test_export_has_everything_and_no_secrets(client: TestClient) -> None:
    email, h = _user(client)
    client.post("/v1/documents/text", headers=h, json={"kind": "notes", "title": "Prep notes",
                                                       "text": "Remember to ask about the on-call rotation."})
    sid = _ended_session(client, h)
    r = client.get("/v1/auth/me/export", headers=h)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data: dict[str, Any] = r.json()
    assert data["format"] == "orbit-export/1" and data["account"]["email"] == email
    assert "password_hash" not in data["account"] and "token_version" not in data["account"]
    assert data["documents"][0]["source_text"].startswith("Remember to ask")
    session = next(s for s in data["sessions"] if s["id"] == sid)
    assert session["transcript"] and session["answers"]
    assert any(e["action"] == "auth.register" for e in data["security_log"])
    assert "embedding" not in r.text


# ---- email change ------------------------------------------------------------------------------------------


def test_email_change_requires_password_and_a_free_address(client: TestClient) -> None:
    email, h = _user(client)
    taken, _ = _user(client)
    assert client.post("/v1/auth/me/email", headers=h,
                       json={"new_email": "new@example.com", "password": "wrong password"}).status_code == 403
    assert client.post("/v1/auth/me/email", headers=h,
                       json={"new_email": taken, "password": PW}).status_code == 409
    assert client.post("/v1/auth/me/email", headers=h,
                       json={"new_email": email, "password": PW}).status_code == 400


def test_email_change_confirms_by_link_and_signs_out_old_sessions(client: TestClient) -> None:
    email, h = _user(client)
    new = f"moved-{uuid.uuid4().hex[:6]}@example.com"
    assert client.post("/v1/auth/me/email", headers=h, json={"new_email": new, "password": PW}).status_code == 202
    token = _mail(new, "/confirm-email-change")
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox) and any(m.to == email and new in m.text for m in sender.sent)  # heads-up
    assert client.get("/v1/auth/me", headers=h).json()["email"] == email  # nothing changes until confirmed

    r = client.post("/v1/auth/email-change/confirm", json={"token": token})
    assert r.status_code == 200 and r.json()["user"]["email"] == new and r.json()["user"]["email_verified"] is True
    client.cookies.clear()
    assert client.get("/v1/auth/me", headers=h).status_code == 401  # old sessions are signed out
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/v1/auth/me", headers=fresh).json()["email"] == new
    assert client.post("/v1/auth/email-change/confirm", json={"token": token}).status_code == 400  # single use
    assert client.post("/v1/auth/login", json={"email": new, "password": PW}).status_code == 200
    assert client.post("/v1/auth/login", json={"email": email, "password": PW}).status_code == 401
