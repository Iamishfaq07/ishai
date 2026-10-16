"""The mock interviewer's natural voice: off without a key, streams audio through the API with the key kept
server-side, counts characters against a daily allowance, and fails as JSON (so the client uses the device's voice)."""

import json
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from orbit_api.providers import tts
from orbit_api.voice import routes as voice

AUDIO = b"\xff\xfb\x90\x00" + b"\x00" * 400  # an MP3 frame header and some bytes: the content doesn't matter here


def _account(client: TestClient) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": f"v-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "correct horse battery"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _deepgram(monkeypatch: pytest.MonkeyPatch, status: int = 200, seen: list[Any] | None = None) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status != 200:
            return httpx.Response(status, json={"err_msg": "nope"})
        return httpx.Response(200, content=AUDIO, headers={"content-type": "audio/mpeg"})

    provider = tts.DeepgramTTS("dg-secret-key", transport=httpx.MockTransport(handle))
    monkeypatch.setattr(voice, "get_tts_provider", lambda: provider)


def test_without_a_key_the_device_voice_is_used(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    monkeypatch.setattr(voice, "get_tts_provider", lambda: None)
    s = client.get("/v1/voice", headers=h).json()
    assert s == {"available": False, "voices": [], "default_voice": "us", "chars_left": 0}
    assert client.post("/v1/voice/speak", headers=h, json={"text": "Hi"}).status_code == 503


def test_speaks_through_the_api_and_counts_characters(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    seen: list[httpx.Request] = []
    _deepgram(monkeypatch, seen=seen)
    s = client.get("/v1/voice", headers=h).json()
    assert s["available"] is True and {v["id"] for v in s["voices"]} == {"us", "uk", "au"}
    assert s["chars_left"] == get_settings().tts_daily_chars
    r = client.post("/v1/voice/speak", headers=h, json={"text": "  Tell me   about yourself. ", "voice": "uk"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/mpeg" and r.content == AUDIO
    req = seen[0]
    assert req.url.params["model"] == "aura-2-draco-en" and req.url.params["encoding"] == "mp3"
    assert req.headers["authorization"] == "Token dg-secret-key"
    assert json.loads(req.content) == {"text": "Tell me about yourself."}  # whitespace tidied, nothing else sent
    assert "dg-secret-key" not in r.text
    left = client.get("/v1/voice", headers=h).json()["chars_left"]
    assert left == get_settings().tts_daily_chars - len("Tell me about yourself.")


def test_the_daily_allowance_and_limits(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    _deepgram(monkeypatch)
    monkeypatch.setattr(get_settings(), "tts_daily_chars", 30)
    assert client.post("/v1/voice/speak", headers=h, json={"text": "x" * 20}).status_code == 200
    over = client.post("/v1/voice/speak", headers=h, json={"text": "y" * 20})
    assert over.status_code == 429 and "device's voice" in over.json()["detail"]
    assert client.post("/v1/voice/speak", headers=h, json={"text": "x" * 801}).status_code == 422
    assert client.post("/v1/voice/speak", headers=h, json={"text": "hi", "voice": "klingon"}).status_code == 422


def test_a_provider_failure_is_a_json_error_and_free(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    _deepgram(monkeypatch, status=401)
    r = client.post("/v1/voice/speak", headers=h, json={"text": "Why this company?"})
    assert r.status_code == 502 and "device's voice" in r.json()["detail"]
    _deepgram(monkeypatch)
    assert client.get("/v1/voice", headers=h).json()["chars_left"] == get_settings().tts_daily_chars


def test_signed_out_gets_nothing(client: TestClient) -> None:
    client.cookies.clear()
    assert client.get("/v1/voice").status_code == 401
    assert client.post("/v1/voice/speak", json={"text": "hi"}).status_code in (401, 403)


def test_provider_follows_the_key_and_the_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import runtime_config

    real = runtime_config.get_effective_config()
    monkeypatch.setattr(runtime_config, "get_effective_config", lambda: real.__class__(
        **{**real.__dict__, "deepgram_api_key": "k"}))
    assert isinstance(tts.get_tts_provider(), tts.DeepgramTTS)
    monkeypatch.setattr(get_settings(), "natural_voice", False)
    assert tts.get_tts_provider() is None
