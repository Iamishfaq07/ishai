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
