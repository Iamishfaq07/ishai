"""Hybrid retrieval (brief §17–§18): benchmark floors, the pieces it's built from, re-embedding, degradation."""

import asyncio
import importlib.util
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.documents.parsing import chunk_document
from orbit_api.live.events import QuestionType
from orbit_api.retrieval import embeddings
from orbit_api.retrieval.embeddings import FastEmbedEmbedder, HashingEmbedder
from orbit_api.retrieval.index import IndexedChunk, SessionIndex, chunk_body
from orbit_api.retrieval.lexical import BM25, stem, tokenize
from orbit_api.retrieval.themes import expand
from tests.retrieval_eval import evaluate, hybrid_retriever, legacy_retriever, load_cases

# ---- benchmark floors (measured values in docs/RETRIEVAL.md; floors sit just below them) -----------------------


def test_hybrid_beats_legacy_on_dev_and_holdout() -> None:
    dev, hold = load_cases("cases.json"), load_cases("holdout_cases.json")
    h = HashingEmbedder()
    new_dev, old_dev = evaluate("h", hybrid_retriever(h, "dev"), dev), evaluate("l", legacy_retriever("dev"), dev)
    new_hold = evaluate("h", hybrid_retriever(h, "holdout"), hold)
    old_hold = evaluate("l", legacy_retriever("holdout"), hold)
    assert new_dev.recall_at_3 >= 0.9 and new_dev.mrr >= 0.8
    assert new_hold.recall_at_3 >= 0.45 and new_hold.mrr >= 0.45
    assert new_dev.mrr > old_dev.mrr and new_hold.mrr > old_hold.mrr


@pytest.mark.skipif(importlib.util.find_spec("fastembed") is None or os.environ.get("ORBIT_TEST_NEURAL") != "1",
                    reason="set ORBIT_TEST_NEURAL=1 (downloads the 67 MB model once)")
def test_bge_small_on_holdout() -> None:
    bge = FastEmbedEmbedder("BAAI/bge-small-en-v1.5", None)
    assert bge.warm()
    r = evaluate("bge", hybrid_retriever(bge, "holdout"), load_cases("holdout_cases.json"))
    assert r.recall_at_3 >= 0.75 and r.mrr >= 0.65


# ---- building blocks -------------------------------------------------------------------------------------------


def test_chunk_body_drops_the_shared_heading() -> None:
    assert chunk_body("experience", "Engineer — Acme (2020–2024): Led the migration") == "Led the migration"
    assert chunk_body("skill", "C#: see notes") == "C#: see notes"


def test_short_skills_survive_chunking() -> None:
    drafts = chunk_document("Skills\n- Go\n- R\n- C#\n- Python\n- -\n", "resume", "cv")
    assert {d.text for d in drafts if d.category == "skill"} == {"Go", "R", "C#", "Python"}


def test_light_stemming_and_bm25() -> None:
    assert stem("migrations") == stem("migration") == "migr"
    assert tokenize("The Kafka migration") == ["kafka", "migr"]
    bm = BM25(["Led the Kafka migration", "Built a React dashboard", "Mentored junior engineers"])
    s = bm.scores("event streaming with Kafka")
    assert s[0] > 0 and s[1] == 0 and s[2] == 0


def test_theme_expansion_is_additive_and_query_only() -> None:
    assert expand("Tell me about stakeholder conflict").startswith("Tell me about stakeholder conflict ")
    assert "disagreement" in expand("How do you handle conflict?")
    assert expand("Write a function to reverse a list.") == "Write a function to reverse a list."


def _index(texts: list[tuple[str, str]]) -> SessionIndex:
    h = HashingEmbedder()
    return SessionIndex([IndexedChunk(str(i), "resume", cat, cat, t, True, h.embed(chunk_body(cat, t)))
                         for i, (cat, t) in enumerate(texts)], h)


def test_unrelated_question_retrieves_nothing() -> None:
    idx = _index([("experience", "Acme: Led the Kafka migration"), ("skill", "Python")])
    assert idx.search("What is the capital of Peru?", QuestionType.small_talk) == []
    assert idx.search("Tell me about Kafka", QuestionType.technical)[0].chunk.text.endswith("Kafka migration")


def test_doc_kind_filter() -> None:
    h = HashingEmbedder()
    idx = SessionIndex([IndexedChunk("a", "resume", "skill", "s", "Kafka", True, h.embed("Kafka")),
                        IndexedChunk("b", "job_description", "requirement", "r", "Kafka experience", False,
                                     h.embed("Kafka experience"))], h)
    assert [x.chunk.id for x in idx.search("Kafka", QuestionType.technical, doc_kind="job_description")] == ["b"]


def test_chunks_from_another_embedder_rank_lexically_only() -> None:
    h = HashingEmbedder()
    idx = SessionIndex([IndexedChunk("a", "resume", "skill", "s", "Kafka streams", True, []),  # stale: no vector
                        IndexedChunk("b", "resume", "skill", "s", "Terraform", True, h.embed("Terraform"))], h)
    assert idx.search("Kafka", QuestionType.technical)[0].chunk.id == "a"


# ---- degradation + re-embedding --------------------------------------------------------------------------------


def test_neural_embedder_that_cannot_load_degrades_to_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings

    monkeypatch.setenv("ORBIT_EMBEDDER", "bge-small")
    get_settings.cache_clear()
    monkeypatch.setattr(embeddings, "_neural", FastEmbedEmbedder("no/such-model", None))
    try:
        assert embeddings._neural is not None and embeddings._neural.warm() is False
        assert embeddings.get_embedder() is embeddings._hash
    finally:
        monkeypatch.delenv("ORBIT_EMBEDDER")
        get_settings.cache_clear()


def test_stale_vectors_are_reembedded_when_a_session_loads(client: TestClient) -> None:
    from sqlalchemy import select, update

    from orbit_api.db import sessionmaker
    from orbit_api.models import DocumentChunk, LiveSessionRow
    from orbit_api.sessions.routes import _load_index

    r = client.post("/v1/auth/register", json={"email": f"rt-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "retrieval password 1"})
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    doc = client.post("/v1/documents/text", headers=h, json={
        "kind": "resume", "title": "cv",
        "text": "Experience\nEngineer — Acme (2020–2024)\n- Led the Kafka migration for the ledger\n"}).json()
    sid = client.post("/v1/sessions", headers=h, json={"title": "t", "document_ids": [doc["id"]]}).json()["id"]

    async def go() -> tuple[list[str | None], list[str | None], int]:
        async with sessionmaker()() as db:
            first = [c.embedding_model for c in (await db.scalars(
                select(DocumentChunk).where(DocumentChunk.document_id == doc["id"]))).all()]
            await db.execute(update(DocumentChunk).where(DocumentChunk.document_id == doc["id"])
                             .values(embedding_model=None))  # as if embedded by the legacy hasher
            await db.commit()
            owner = await db.scalar(select(LiveSessionRow.user_id).where(LiveSessionRow.id == sid))
            index, _ = await _load_index(db, sid, str(owner))
            after = [c.embedding_model for c in (await db.scalars(
                select(DocumentChunk).where(DocumentChunk.document_id == doc["id"]))).all()]
            return first, after, len(index)

    assert client.portal is not None
    first, after, n = client.portal.call(go)
    assert first == ["hash-v2"] and after == ["hash-v2"] and n == 1
    assert asyncio.iscoroutinefunction(_load_index)


def test_the_stemmer_brings_word_forms_together() -> None:
    from orbit_api.retrieval.lexical import stem

    for group in (("service", "services"), ("scale", "scaled", "scaling"), ("migrating", "migration", "migrated"),
                  ("measure", "measured", "measurement"), ("process", "processes"), ("company", "companies")):
        assert len({stem(w) for w in group}) == 1, group
    assert stem("success") == "success" and stem("status") == "status" and stem("analysis") == "analysis"


def test_a_story_question_finds_the_experience_it_is_about() -> None:
    from orbit_api.documents.parsing import chunk_document
    from orbit_api.live.events import QuestionType
    from orbit_api.retrieval.index import IndexedChunk, SessionIndex

    resume = "EXPERIENCE\nAcme Corp — Senior Engineer (2021–Present)\n- Built payment services handling 10k TPS\n"
    chunks = [IndexedChunk(f"r{i}", "resume", c.category, c.label, c.text, True, [])
              for i, c in enumerate(chunk_document(resume, "resume", "cv"))]
    hits = SessionIndex(chunks).search("Tell me about a time you had to scale a service under pressure.",
                                       QuestionType.behavioral)
    assert hits and "payment services" in hits[0].chunk.text
