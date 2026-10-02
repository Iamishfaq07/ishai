"""Phone companion: share code → view ticket → a read-only mirror of the live socket."""

import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from orbit_api.sessions import companion
from orbit_api.sessions.routes import _live_engines
from tests.test_api import _collect, _register


def _share(client: TestClient, h: dict[str, str], sid: str) -> str:
    r = client.post(f"/v1/sessions/{sid}/companion", headers=h)
    assert r.status_code == 200, r.text
    assert 0 < r.json()["expires_in"] <= companion.SHARE_TTL_S
    return str(r.json()["code"])


def _view_ticket(client: TestClient, code: str) -> str:
    client.cookies.clear()  # the phone isn't signed in: the code is the credential
    r = client.post(f"/v1/companion/{code}")
    assert r.status_code == 200, r.text
    return str(r.json()["ticket"])


def test_share_code_is_stable_owner_only_and_revocable(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    code = _share(client, h, sid)
    assert _share(client, h, sid) == code  # same QR while it's valid
    assert client.post(f"/v1/sessions/{sid}/companion", headers=other).status_code == 404
    assert client.delete(f"/v1/sessions/{sid}/companion", headers=other).status_code == 404

    redeemed = client.post(f"/v1/companion/{code}").json()
    assert redeemed["session_id"] == sid and redeemed["title"] == "Acme onsite" and redeemed["ticket"]
    assert client.post("/v1/companion/not-a-code").status_code == 404

    assert client.delete(f"/v1/sessions/{sid}/companion", headers=h).status_code == 204
    assert client.post(f"/v1/companion/{code}").status_code == 404  # revoked
    assert _share(client, h, sid) != code  # a fresh one on request

    client.post(f"/v1/sessions/{sid}/end", headers=h)
    assert client.post(f"/v1/sessions/{sid}/companion", headers=h).status_code == 409  # ended: nothing to share
    assert not any(s.session_id == sid for s in companion._shares.values())  # ending revoked the code


def test_redeem_takes_the_code_in_the_body_and_the_path_form_still_works(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    code = _share(client, h, sid)
    client.cookies.clear()  # the phone isn't signed in

    r = client.post("/v1/companion/redeem", json={"code": code})  # in the body: out of the access logs
    assert r.status_code == 200, r.text
    assert r.json()["session_id"] == sid and r.json()["title"] == "Acme onsite" and r.json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/view?ticket={r.json()['ticket']}"):
        pass  # the ticket opens the phone's view
    assert client.post("/v1/companion/redeem", json={"code": "not-a-code"}).status_code == 404
    assert client.post("/v1/companion/redeem", json={}).status_code == 422
    # Phones still on the older web build send it in the path.
    assert client.post(f"/v1/companion/{code}").json()["session_id"] == sid

    companion.stop_sharing(sid)
    assert client.post("/v1/companion/redeem", json={"code": code}).status_code == 404  # revoked


def test_view_ticket_is_single_use_and_bound_to_the_session(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "x"}).json()["id"]
    other_sid = client.post("/v1/sessions", headers=h, json={"title": "y"}).json()["id"]
    ticket = _view_ticket(client, _share(client, h, sid))
    for url in (f"/v1/sessions/{other_sid}/view?ticket={ticket}", f"/v1/sessions/{sid}/view?ticket={ticket}"):
        with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(url) as ws:
            ws.receive_text()
        assert exc.value.code == 4001  # wrong session consumes it; it can't be replayed on the right one either


def test_phone_mirrors_the_live_session_and_is_disconnected_when_it_ends(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    code = _share(client, h, sid)
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as live:
        _collect(live, lambda ev: any(e["type"] == "session.started" for e in ev))
        live.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        _collect(live, lambda ev: any(e["type"] == "answer.completed" for e in ev))

        # A phone joining mid-session catches up from the replay buffer, then follows live.
        with client.websocket_connect(f"/v1/sessions/{sid}/view?ticket={_view_ticket(client, code)}") as phone:
            seen = _collect(phone, lambda ev: any(e["type"] == "answer.completed" for e in ev))
            types = {e["type"] for e in seen}
            assert {"session.started", "question.detected", "answer.chunk", "answer.completed"} <= types
            assert "transcript.partial" not in types  # interim transcript isn't mirrored
            phone.send_text(json.dumps({"type": "session.end", "data": {}}))  # ignored: the phone is read-only
            assert sid in _live_engines

            live.send_text(json.dumps({"type": "session.end", "data": {}}))
            _collect(live, lambda ev: any(e["type"] == "session.ended" for e in ev))
            _collect(phone, lambda ev: any(e["type"] == "session.ended" for e in ev))
            with pytest.raises(WebSocketDisconnect) as exc:
                phone.receive_text()
            assert exc.value.code == companion.CLOSE_SHARE_ENDED
    assert client.post(f"/v1/companion/{code}").status_code == 404
    assert sid not in companion._recent and sid not in companion._viewers


def test_viewer_limit(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "x"}).json()["id"]
    code = _share(client, h, sid)
    url = f"/v1/sessions/{sid}/view?ticket="
    with (
        client.websocket_connect(url + _view_ticket(client, code)),
        client.websocket_connect(url + _view_ticket(client, code)),
        client.websocket_connect(url + _view_ticket(client, code)),
    ):
        fourth = url + _view_ticket(client, code)
        with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(fourth) as ws:
            ws.receive_text()
        assert exc.value.code == 4029
    companion.stop_sharing(sid)


def test_publish_keeps_no_buffer_when_nobody_can_watch() -> None:
    companion.publish("nobody-watching", {"type": "answer.delta", "data": {}})
    assert "nobody-watching" not in companion._recent
