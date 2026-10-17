"""The mock interview camera coach (sessions/camera.py): off by default; with ORBIT_VIDEO_MOCK on, a mock session takes
the numbers the device measured (and only numbers), shows them in the session with a trend across sessions, and
nobody else's session can be written to or read."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from tests.test_api import _register

GOOD = {"seconds": 300, "samples": 3000, "face_in_frame_pct": 96.5, "facing_camera_pct": 71.2,
        "head_movement_deg_s": 4.3}


def _mock(client: TestClient, h: dict[str, str], kind: str = "mock") -> str:
    r = client.post("/v1/sessions", headers=h, json={"title": "Practice", "type": kind})
    assert r.status_code == 201, r.text
    out: str = r.json()["id"]
    return out


def test_off_by_default(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["video_mock"] is False
    sid = _mock(client, h)
    assert client.put(f"/v1/sessions/{sid}/camera-metrics", headers=h, json=GOOD).status_code == 404
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["camera"] is None


@pytest.fixture
def coach_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "video_mock", True)


@pytest.mark.usefixtures("coach_on")
def test_numbers_are_stored_with_a_trend(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["video_mock"] is True
    first, second = _mock(client, h), _mock(client, h)
    assert client.put(f"/v1/sessions/{first}/camera-metrics", headers=h,
                      json={**GOOD, "facing_camera_pct": 50.0}).status_code == 204
    assert client.put(f"/v1/sessions/{second}/camera-metrics", headers=h, json=GOOD).status_code == 204
    cam: dict[str, Any] = client.get(f"/v1/sessions/{second}", headers=h).json()["camera"]
    assert cam["metrics"]["facing_camera_pct"] == 71.2
    assert [p["facing_camera_pct"] for p in cam["trend"]] == [50.0, 71.2]  # oldest first, this one last
    first_cam = client.get(f"/v1/sessions/{first}", headers=h).json()["camera"]
    assert [p["session_id"] for p in first_cam["trend"]] == [first]  # later sessions aren't "earlier"
    # Sent again as they grow: the latest numbers win.
    assert client.put(f"/v1/sessions/{second}/camera-metrics", headers=h,
                      json={**GOOD, "seconds": 600}).status_code == 204
    assert client.get(f"/v1/sessions/{second}", headers=h).json()["camera"]["metrics"]["seconds"] == 600


@pytest.mark.usefixtures("coach_on")
def test_only_numbers_only_mocks_only_yours(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    sid = _mock(client, h)
    for bad in ({**GOOD, "facing_camera_pct": 101}, {**GOOD, "seconds": -1}, {**GOOD, "head_movement_deg_s": 1000},
                {k: v for k, v in GOOD.items() if k != "samples"}):
        assert client.put(f"/v1/sessions/{sid}/camera-metrics", headers=h, json=bad).status_code == 422, bad
    # Anything else sent alongside (an image, landmarks) is dropped, never stored.
    extra = {**GOOD, "frame": "data:image/png;base64,AAAA", "landmarks": [[0.1, 0.2]]}
    assert client.put(f"/v1/sessions/{sid}/camera-metrics", headers=h, json=extra).status_code == 204
    stored = client.get(f"/v1/sessions/{sid}", headers=h).json()["camera"]["metrics"]
    assert set(stored) == set(GOOD)
    assert client.put(f"/v1/sessions/{sid}/camera-metrics", headers=other, json=GOOD).status_code == 404
    live = _mock(client, h, kind="interview")
    assert client.put(f"/v1/sessions/{live}/camera-metrics", headers=h, json=GOOD).status_code == 409
    # Nothing measured yet: nothing stored.
    empty = _mock(client, h)
    assert client.put(f"/v1/sessions/{empty}/camera-metrics", headers=h, json={**GOOD, "samples": 0}).status_code == 204
    assert client.get(f"/v1/sessions/{empty}", headers=h).json()["camera"] is None


def test_the_privacy_policy_names_every_number_kept() -> None:
    """The privacy policy's camera line says what the coach saves with a session: every stored number, so one added
    to CameraMetrics has to be named there too."""
    from pathlib import Path

    from orbit_api.sessions.camera import CameraMetrics

    policy = (Path(__file__).resolve().parents[3] / "apps" / "web" / "public" / "privacy.html").read_text("utf-8")
    line = next(li for li in policy.split("<li>") if "camera coach" in li)
    named = {"seconds": "how long it measured", "samples": "how long it measured",
             "face_in_frame_pct": "face was in frame", "facing_camera_pct": "faced the camera",
             "head_movement_deg_s": "head moved"}
    assert set(named) == set(CameraMetrics.model_fields)
    assert all(phrase in line for phrase in named.values()), line
    assert "three numbers" not in line
