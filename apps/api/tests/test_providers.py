import json

import httpx
import pytest

from orbit_api.providers.llm.base import LLMError, LLMImage, LLMMessage, LLMRequest
from orbit_api.providers.llm.deepseek import DeepSeekProvider
from orbit_api.providers.stt.base import STTConfig
from orbit_api.providers.stt.deepgram import build_url, parse_message


def _sse(*objs: object) -> bytes:
    return b"".join(f"data: {json.dumps(o)}\n\n".encode() for o in objs) + b"data: [DONE]\n\n"


def _provider(handler: httpx.MockTransport) -> DeepSeekProvider:
    client = httpx.AsyncClient(base_url="https://api.deepseek.test", transport=handler)
    return DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-chat", "deepseek-reasoner",
                            client=client)


async def test_deepseek_streams_content_and_usage_and_hides_reasoning() -> None:
    seen: dict[str, object] = {}

    def handle(req: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(req.content)
        body = _sse(
            {"choices": [{"delta": {"reasoning_content": "secret chain of thought"}}]},
            {"choices": [{"delta": {"content": "ANSWER: Hi"}}]},
            {"choices": [{"delta": {"content": "\n- point"}}]},
            {"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 9}},
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    p = _provider(httpx.MockTransport(handle))
    resp = await p.generate(LLMRequest(messages=[LLMMessage("user", "hi")], reasoning="deep"))
    assert resp.text == "ANSWER: Hi\n- point"
    assert "secret" not in resp.text
    assert (resp.usage.input_tokens, resp.usage.output_tokens) == (120, 9)
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["model"] == "deepseek-reasoner" and body["stream"] is True and "temperature" not in body


@pytest.mark.parametrize(("status", "code", "retryable"), [(429, "rate_limited", True), (401, "http_401", False),
                                                            (503, "http_503", True)])
async def test_deepseek_error_mapping(status: int, code: str, retryable: bool) -> None:
    p = _provider(httpx.MockTransport(lambda r: httpx.Response(status, text="nope")))
    with pytest.raises(LLMError) as e:
        await p.generate(LLMRequest(messages=[LLMMessage("user", "hi")]))
    assert e.value.code == code and e.value.retryable is retryable


async def test_deepseek_refuses_images_instead_of_faking_vision() -> None:
    p = _provider(httpx.MockTransport(lambda r: httpx.Response(200)))
    assert not p.supports_vision()
    with pytest.raises(LLMError, match="images"):
        await p.generate(LLMRequest(messages=[LLMMessage("user", "x")], images=[LLMImage(b"png")]))


def test_deepgram_url_and_parsing() -> None:
    url = build_url("nova-3", STTConfig(language="en", keyterms=["Kubernetes"]))
    assert "interim_results=true" in url and "endpointing=300" in url and "keyterm=Kubernetes" in url
    assert "detect_language=true" in build_url("nova-3", STTConfig(language="auto"))

    partial = parse_message({"type": "Results", "is_final": False, "speech_final": False, "start": 1.0,
                             "duration": 0.5, "channel": {"alternatives": [{"transcript": "tell me"}]}})
    assert partial and partial.kind == "partial" and partial.start_ms == 1000 and partial.end_ms == 1500
    final = parse_message({"type": "Results", "is_final": True, "speech_final": True, "start": 1.0,
                           "duration": 1.2, "channel": {"alternatives": [{"transcript": "tell me about yourself"}]}})
    assert final and final.kind == "final" and final.endpoint
    assert parse_message({"type": "UtteranceEnd"}).kind == "utterance_end"  # type: ignore[union-attr]
    assert parse_message({"type": "Metadata"}) is None


async def test_deepgram_rejected_key_goes_down_without_retrying(monkeypatch: pytest.MonkeyPatch) -> None:
    from websockets.datastructures import Headers
    from websockets.exceptions import InvalidStatus
    from websockets.http11 import Response

    from orbit_api.providers.stt import deepgram

    attempts = 0

    def reject(*_a: object, **_k: object) -> object:
        nonlocal attempts
        attempts += 1
        raise InvalidStatus(Response(401, "Unauthorized", Headers()))

    monkeypatch.setattr(deepgram.websockets, "connect", reject)
    session = deepgram.DeepgramSession("bad-key", "nova-3", STTConfig())
    await session.connect()
    events = [ev async for ev in session.events()]
    assert [(e.kind, e.status) for e in events] == [("status", "down")]
    assert "rejected" in events[0].text and attempts == 1
    await session.close()


def test_reasoner_gets_chain_of_thought_headroom() -> None:
    from orbit_api.providers.llm.deepseek import REASONING_HEADROOM

    p = DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-chat", "deepseek-reasoner")
    msgs = [LLMMessage("user", "q")]
    assert p._payload(LLMRequest(messages=msgs, max_tokens=420))["max_tokens"] == 420
    deep = p._payload(LLMRequest(messages=msgs, max_tokens=420, reasoning="deep"))
    assert deep["model"] == "deepseek-reasoner" and deep["max_tokens"] == 420 + REASONING_HEADROOM


def test_thinking_is_explicit_on_every_request() -> None:
    p = DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-flash", "deepseek-flash")
    msgs = [LLMMessage("user", "q")]
    off = p._payload(LLMRequest(messages=msgs, max_tokens=420))
    # V4 models think by default, so "off" must be sent, not implied
    assert off["thinking"] == {"type": "disabled"} and "reasoning_effort" not in off
    assert off["max_tokens"] == 420 and off["temperature"] == 0.3
    mx = p._payload(LLMRequest(messages=msgs, max_tokens=420, thinking="max"))
    assert mx["reasoning_effort"] == "max" and "thinking" not in mx and "temperature" not in mx
    from orbit_api.providers.llm.deepseek import REASONING_HEADROOM

    assert mx["max_tokens"] == 420 + REASONING_HEADROOM



def test_images_ride_on_the_last_user_message_for_vision_models() -> None:
    import base64

    msgs = [LLMMessage("system", "s"), LLMMessage("user", "What does this show?")]
    flash = DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-flash", "deepseek-flash")
    assert flash.supports_vision()
    payload = flash._payload(LLMRequest(messages=msgs, images=[LLMImage(b"\x89PNGfake", "image/png")]))
    user = payload["messages"][-1]
    assert user["content"][0] == {"type": "text", "text": "What does this show?"}
    url = user["content"][1]["image_url"]["url"]
    assert url == "data:image/png;base64," + base64.b64encode(b"\x89PNGfake").decode()
    assert payload["messages"][0] == {"role": "system", "content": "s"}  # untouched

    legacy = DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-chat", "deepseek-reasoner")
    assert not legacy.supports_vision()
    with pytest.raises(LLMError) as e:
        legacy._payload(LLMRequest(messages=msgs, images=[LLMImage(b"x")]))
    assert e.value.code == "vision_unsupported"
