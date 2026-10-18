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
    assert s == {"available": False, "voices": [], "default_voice": "vesta", "chars_left": 0}
    assert client.post("/v1/voice/speak", headers=h, json={"text": "Hi"}).status_code == 503


def test_speaks_through_the_api_and_counts_characters(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    seen: list[httpx.Request] = []
    _deepgram(monkeypatch, seen=seen)
    s = client.get("/v1/voice", headers=h).json()
    # A small choice of real Aura-2 voices (D76): two women's, two men's, Vesta first.
    assert s["available"] is True and [v["model"] for v in s["voices"]] == [
        "aura-2-vesta-en", "aura-2-aurora-en", "aura-2-pluto-en", "aura-2-arcas-en"]
    assert s["default_voice"] == "vesta"
    assert s["chars_left"] == get_settings().tts_daily_chars
    r = client.post("/v1/voice/speak", headers=h, json={"text": "  Tell me   about yourself. ", "voice": "arcas"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/mpeg" and r.content == AUDIO
    req = seen[0]
    assert req.url.params["model"] == "aura-2-arcas-en" and req.url.params["encoding"] == "mp3"
    assert "speed" not in req.url.params and r.headers["x-orbit-speed"] == "1"
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
    # A voice saved by an older client (uk, au) gets the one voice instead of failing.
    old_choice = client.post("/v1/voice/speak", headers=h, json={"text": "hi", "voice": "uk"})
    assert old_choice.status_code == 200


def test_a_pace_goes_to_deepgram_or_falls_back_to_the_normal_one(client: TestClient,
                                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    h = _account(client)
    seen: list[httpx.Request] = []
    _deepgram(monkeypatch, seen=seen)
    r = client.post("/v1/voice/speak", headers=h, json={"text": "Tell me about yourself.", "speed": 0.9})
    assert r.status_code == 200 and seen[0].url.params["speed"] == "0.9" and r.headers["x-orbit-speed"] == "0.9"
    assert client.post("/v1/voice/speak", headers=h, json={"text": "Hi", "speed": 3}).status_code == 422

    # A voice that won't take a pace: the normal one, said so, and the client paces the playback itself.
    def handle(request: httpx.Request) -> httpx.Response:
        if "speed" in request.url.params:
            return httpx.Response(400, json={"err_msg": "speed not supported"})
        return httpx.Response(200, content=AUDIO, headers={"content-type": "audio/mpeg"})

    provider = tts.DeepgramTTS("dg-secret-key", transport=httpx.MockTransport(handle))
    monkeypatch.setattr(voice, "get_tts_provider", lambda: provider)
    r = client.post("/v1/voice/speak", headers=h, json={"text": "Tell me about yourself.", "speed": 1.15})
    assert r.status_code == 200 and r.content == AUDIO and r.headers["x-orbit-speed"] == "1"


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


def _uid(client: TestClient, h: dict[str, str]) -> str:
    return str(client.get("/v1/auth/me", headers=h).json()["id"])


def test_usage_names_only_a_session_of_the_callers_own(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    a, b = _account(client), _account(client)
    _deepgram(monkeypatch)
    mine = client.post("/v1/sessions", headers=a, json={"title": "mine", "type": "mock"}).json()["id"]
    theirs = client.post("/v1/sessions", headers=b, json={"title": "theirs", "type": "mock"}).json()["id"]
    for sid in (mine, theirs):
        assert client.post("/v1/voice/speak", headers=a, json={"text": "Hello", "session_id": sid}).status_code == 200

    uid = _uid(client, a)

    async def tagged() -> list[str | None]:
        async with sessionmaker()() as db:
            return list((await db.scalars(select(UsageEvent.session_id).where(
                UsageEvent.user_id == uid, UsageEvent.metric == voice.METRIC)
                .order_by(UsageEvent.created_at))).all())

    assert client.portal.call(tagged) == [mine, None]  # type: ignore[union-attr]  # not someone else's session


def test_two_requests_at_once_cant_both_spend_the_last_characters(client: TestClient,
                                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    """The day's characters were checked, then the provider was asked, then the use was written: two requests at once
    both passed the check. The characters are now taken under the account lock before the provider is asked."""
    import asyncio

    from fastapi import HTTPException

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    h = _account(client)
    uid = _uid(client, h)
    monkeypatch.setattr(get_settings(), "tts_daily_chars", 10)

    async def race() -> list[int]:
        gate = asyncio.Event()

        class Slow:
            def stream(self, text: str, model: str) -> Any:
                async def audio() -> Any:
                    await gate.wait()  # the provider takes a moment: both requests are in flight
                    yield AUDIO

                return audio()

        monkeypatch.setattr(voice, "get_tts_provider", lambda: Slow())

        async def one() -> int:
            async with sessionmaker()() as db:
                user = await db.get(User, uid)
                assert user is not None
                try:
                    await voice.speak(voice.SpeakIn(text="12345678"), user, db)
                except HTTPException as e:
                    return e.status_code
                return 200

        tasks = [asyncio.create_task(one()) for _ in range(2)]
        await asyncio.sleep(0.3)
        gate.set()
        return sorted(await asyncio.gather(*tasks))

    assert client.portal.call(race) == [200, 429]  # type: ignore[union-attr]
