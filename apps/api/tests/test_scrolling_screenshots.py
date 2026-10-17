"""Scrolling screenshots (desktop "Scroll to the end"): a long problem captured as one tall image goes to the model as
readable parts in order (live/shots.py), the prompt says how to read them, and asking again sends them all again."""

import io
from itertools import pairwise
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from orbit_api.live import shots
from orbit_api.live.engine import SCREENSHOT_LABEL, SCREENSHOT_PROMPT, LiveEngine, screenshot_prompt
from orbit_api.providers.llm.base import LLMImage
from tests.test_api import _collect, _live, _register
from tests.test_live_audit import _engine


def _png(width: int, height: int) -> bytes:
    """A page of horizontal bands, a different grey every 10 rows, so each part's pixels say where it came from."""
    im = Image.new("RGB", (width, height))
    for y in range(height):
        shade = (y // 10) % 256
        im.paste((shade, shade, shade), (0, y, width, y + 1))
    out = io.BytesIO()
    im.save(out, format="PNG")
    return out.getvalue()


def test_an_ordinary_screenshot_is_sent_whole() -> None:
    image = LLMImage(_png(1600, 900))
    assert shots.split_tall(image) == [image]
    assert shots.part_boxes(800, 1300) == [(0, 1300)]  # a little taller than one part still goes whole


def test_a_tall_capture_becomes_overlapping_parts_from_top_to_bottom() -> None:
    boxes = shots.part_boxes(800, 4000)
    assert boxes[0][0] == 0 and boxes[-1][1] == 4000
    assert all(bottom - top <= shots.PART_MAX for top, bottom in boxes)
    assert all(nxt[0] <= prev[1] - shots.OVERLAP for prev, nxt in pairwise(boxes))
    # a narrow pane's parts are still a screen's worth, not slivers
    assert all(bottom - top >= shots.PART_MIN for top, bottom in shots.part_boxes(400, 5000))


def test_a_very_long_page_is_capped_at_a_few_taller_parts() -> None:
    boxes = shots.part_boxes(800, 30_000)
    assert len(boxes) == shots.MAX_PARTS and boxes[-1][1] == 30_000
    assert all(nxt[0] <= prev[1] - shots.OVERLAP for prev, nxt in pairwise(boxes))


def test_the_parts_are_the_pages_own_pixels_in_order() -> None:
    parts = shots.split_tall(LLMImage(_png(700, 3200)))
    assert len(parts) > 1 and all(p.media_type == "image/png" for p in parts)
    tops = []
    for part in parts:
        with Image.open(io.BytesIO(part.data)) as im:
            assert im.width == 700
            tops.append(im.getpixel((0, 0))[0])
    assert tops == sorted(tops) and tops[0] == 0


async def test_parts_go_to_the_model_together_and_again_when_asked_again() -> None:
    eng, sink, llm = _engine()
    await eng.start()
    parts = [LLMImage(b"a"), LLMImage(b"b"), LLMImage(b"c")]
    await eng.answer_screenshot(parts)
    await sink.wait_for("answer.completed")
    first = llm.requests[-1]
    assert [i.data for i in first.images] == [b"a", b"b", b"c"]
    assert "attached as 3 images from top to bottom" in first.messages[1].content
    await eng.handle_client({"type": "answer.request", "data": {"question_text": SCREENSHOT_LABEL}})
    await sink.wait_for("answer.completed", n=2)
    await eng.handle_client({"type": "chat.message", "data": {"text": "now in Java"}})
    await sink.wait_for("answer.completed", n=3)
    assert [len(r.images) for r in llm.requests if r.images] == [3, 3, 3]
    await eng.end()


def test_one_image_keeps_the_plain_prompt() -> None:
    assert screenshot_prompt(1) == SCREENSHOT_PROMPT
    assert screenshot_prompt(4).startswith(SCREENSHOT_PROMPT) and "4 images" in screenshot_prompt(4)


def test_an_uploaded_long_capture_is_answered_as_parts_and_spends_one_screenshot(client: TestClient,
                                                                                 monkeypatch: Any) -> None:
    sent: list[list[LLMImage]] = []
    original = LiveEngine.answer_screenshot

    async def spy(self: LiveEngine, image: Any) -> str:
        sent.append(image)
        return await original(self, image)

    monkeypatch.setattr(LiveEngine, "answer_screenshot", spy)
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "coding", "type": "coding"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        r = client.post(f"/v1/sessions/{sid}/screenshots", headers=h,
                        files={"image": ("long.png", _png(800, 4200), "image/png")})
        assert r.status_code == 202
        _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        ws.send_text('{"type": "session.end", "data": {}}')
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    assert len(sent) == 1 and len(sent[0]) == len(shots.part_boxes(800, 4200)) > 1
    assert client.get("/v1/usage", headers=h).json()["screenshots_used"] == 1
