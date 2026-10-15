"""Career Evidence Vault: behind its flag, owned, quotes checked, confirmed-only reuse, export and deletion."""

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from orbit_api.evidence.routes import norm, parse_suggestions, quoted
from orbit_api.models import Story
from orbit_api.stories.routes import story_text
from tests.test_api import _collect, _doc, _register
from tests.test_stories import STORY


@pytest.fixture
def vault(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(get_settings(), "evidence_vault", True)
    yield client


def test_switched_off_it_is_not_there(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/evidence", headers=h).status_code == 404
    assert client.post("/v1/evidence", headers=h, json={"claim": "Led the ledger team"}).status_code == 404
    assert client.get("/v1/auth/me", headers=h).json()["evidence_vault"] is False


def test_crud_ownership_and_deleting_it_all(vault: TestClient) -> None:
    h, other = _register(vault), _register(vault)
    assert vault.get("/v1/auth/me", headers=h).json()["evidence_vault"] is True
    r = vault.post("/v1/evidence", headers=h, json={"claim": "Led a team of five on the payments ledger"})
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["status"] == "confirmed" and item["source_kind"] == "manual" and item["quote"] == ""
    assert vault.get("/v1/evidence", headers=other).json() == []
    assert vault.put(f"/v1/evidence/{item['id']}", headers=other, json={"claim": "Mine now"}).status_code == 404
    assert vault.delete(f"/v1/evidence/{item['id']}", headers=other).status_code == 404
    assert vault.post(f"/v1/evidence/{item['id']}/confirm", headers=other).status_code == 404
    assert vault.post("/v1/evidence", headers=h, json={"claim": "x"}).status_code == 422

    edited = vault.put(f"/v1/evidence/{item['id']}", headers=h, json={"claim": "Led five engineers"}).json()
    assert edited["claim"] == "Led five engineers"
    assert vault.delete(f"/v1/evidence/{item['id']}", headers=h).status_code == 204
    vault.post("/v1/evidence", headers=h, json={"claim": "Another claim"})
    assert vault.delete("/v1/evidence", headers=h).status_code == 204
    assert vault.get("/v1/evidence", headers=h).json() == []


def test_suggestions_quote_their_source_and_wait_for_a_check(vault: TestClient) -> None:
    h = _register(vault)
    story = vault.post("/v1/stories", headers=h, json=STORY).json()
    r = vault.post("/v1/evidence/suggest", headers=h, json={"source": "story", "story_id": story["id"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["added"] and out["dropped"] == 1  # the mock's made-up quote isn't in the story: never stored
    for item in out["added"]:
        assert item["status"] == "suggested" and item["source_kind"] == "story"
        assert item["source_id"] == story["id"] and item["source_title"] == STORY["title"]
        assert not item["quote"].startswith(("Situation:", "Task:"))
        assert quoted(item["quote"], story_text(Story(**{k: v for k, v in STORY.items() if k != "competencies"})))
    # Asked again, the same claims aren't added twice.
    again = vault.post("/v1/evidence/suggest", headers=h, json={"source": "story", "story_id": story["id"]}).json()
    assert again["added"] == [] and again["dropped"] == len(out["added"]) + 1

    listed = vault.get("/v1/evidence", headers=h).json()
    assert [i["status"] for i in listed] == ["suggested"] * len(out["added"])
    first = out["added"][0]["id"]
    assert vault.post(f"/v1/evidence/{first}/confirm", headers=h).json()["status"] == "confirmed"
    assert vault.delete("/v1/evidence?only=suggested", headers=h).status_code == 204
    assert [i["id"] for i in vault.get("/v1/evidence", headers=h).json()] == [first]

    # Someone else's story can't be mined; deleting the story keeps the evidence, unlinked.
    other = _register(vault)
    assert vault.post("/v1/evidence/suggest", headers=other,
                      json={"source": "story", "story_id": story["id"]}).status_code == 404
    vault.delete(f"/v1/stories/{story['id']}", headers=h)
    kept = vault.get("/v1/evidence", headers=h).json()[0]
    assert kept["source_id"] is None and kept["source_title"] == STORY["title"] and kept["quote"]


def test_suggestions_from_the_resume(vault: TestClient) -> None:
    h = _register(vault)
    r = vault.post("/v1/evidence/suggest", headers=h, json={"source": "resume"})
    assert r.status_code == 422 and "resume" in r.json()["detail"]
    _doc(vault, h, "resume_sample")
    out = vault.post("/v1/evidence/suggest", headers=h, json={"source": "resume"}).json()
    assert out["added"] and all(i["source_kind"] == "resume" for i in out["added"])


def test_the_export_has_it(vault: TestClient) -> None:
    h = _register(vault)
    vault.post("/v1/evidence", headers=h, json={"claim": "Shipped the ledger migration"})
    export = vault.get("/v1/auth/me/export", headers=h).json()
    assert [e["claim"] for e in export["evidence"]] == ["Shipped the ledger migration"]
    assert "embedding" not in export["evidence"][0]


def test_only_confirmed_evidence_reaches_live_answers(vault: TestClient) -> None:
    h = _register(vault)
    vault.post("/v1/evidence", headers=h, json={"claim": "Cut checkout latency by 40 percent with a pricing cache"})
    story = vault.post("/v1/stories", headers=h, json=STORY).json()
    vault.post("/v1/evidence/suggest", headers=h, json={"source": "story", "story_id": story["id"]})
    suggested = [i["claim"] for i in vault.get("/v1/evidence", headers=h).json() if i["status"] == "suggested"]
    sid = vault.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    ticket = vault.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with vault.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "chat.message",
                                 "data": {"text": "How did you cut checkout latency with the pricing cache?"}}))
        done = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        used = next(e for e in done if e["type"] == "answer.completed")["data"]["answer"]["context_used"]
    assert "Evidence: Cut checkout latency by 40 percent with a pricing cache" in used
    assert not any(f"Evidence: {c}" in used for c in suggested)


def test_a_quote_must_be_the_sources_own_words() -> None:
    source = "We launched on time — and conversion rose 6%.\nI wrote the  trade-offs."
    assert quoted("we launched on time - and conversion rose 6%", source)
    assert quoted("“I wrote the trade-offs.”", source)
    assert not quoted("conversion rose 9%", source)
    assert not quoted("rose 6%", source)  # too short to stand behind a claim
    assert norm("  A’s \n B ") == "a's b"
    assert parse_suggestions('{"items": [{"claim": "Did it", "quote": ""}, {"claim": "Led it", "quote": "q"}]}') == [
        ("Led it", "q")]
