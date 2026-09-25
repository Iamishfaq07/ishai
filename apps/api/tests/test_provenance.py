"""Candidate fact provenance (launch brief §19): numbered facts, resolved SOURCES, and the safety net that never
lets unsupported personal history be labelled verified."""

from orbit_api.live.answer_format import AnswerStreamParser, finalize_grounding
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import FactSource, QuestionType
from orbit_api.retrieval.embeddings import HashingEmbedder
from orbit_api.retrieval.index import IndexedChunk, SessionIndex, chunk_body


def _fact(ref: str, verified: bool = True) -> FactSource:
    return FactSource(ref=ref, chunk_id=f"c{ref}", doc_kind="resume" if verified else "job_description",
                      document="cv", label="resume: Acme", excerpt="Led the Kafka migration", verified=verified)


def _parse(text: str, facts: dict[str, FactSource]) -> tuple:
    p = AnswerStreamParser("q", QuestionType.behavioral, [], facts=facts)
    p.feed(text)
    return p.snapshot(), finalize_grounding(p.snapshot())


def test_sources_are_resolved_and_unknown_refs_ignored() -> None:
    facts = {"F1": _fact("F1"), "F2": _fact("F2", verified=False)}
    raw, final = _parse("GROUNDED: verified\nANSWER:\nI led it.\nSOURCES: F1, F9, f2, F1\nPOINTS: a | b\n", facts)
    assert [s.ref for s in raw.sources] == ["F1", "F2"]  # F9 wasn't in the prompt; duplicates dropped
    assert final.grounding == "verified" and final.key_points == ["a", "b"]


def test_verified_without_a_verified_source_is_downgraded() -> None:
    facts = {"F1": _fact("F1"), "F2": _fact("F2", verified=False)}
    # cites only the JD → "inferred"
    assert _parse("GROUNDED: verified\nANSWER:\nx\nSOURCES: F2\n", facts)[1].grounding == "inferred"
    # cites nothing / forgot the line → "example" (unsupported), never shown as verified
    assert _parse("GROUNDED: verified\nANSWER:\nx\nSOURCES: none\n", facts)[1].grounding == "example"
    assert _parse("GROUNDED: verified\nANSWER:\nx\n", facts)[1].grounding == "example"
    assert _parse("GROUNDED: inferred\nANSWER:\nx\n", facts)[1].grounding == "example"
    assert _parse("GROUNDED: inferred\nANSWER:\nx\nSOURCES: F1\n", facts)[1].grounding == "inferred"
    assert _parse("GROUNDED: general\nANSWER:\nx\nSOURCES: none\n", facts)[1].grounding == "general"
    assert _parse("GROUNDED: unsupported\nANSWER:\nx\n", facts)[1].grounding == "example"


def test_prompt_numbers_facts_and_maps_them_back() -> None:
    h = HashingEmbedder()
    texts = [("experience", "Engineer — Acme (2020–2024): Led the Kafka migration"),
             ("experience", "Engineer — Acme (2020–2024): Resolved release disagreements with leadership")]
    idx = SessionIndex([IndexedChunk(str(i), "resume", c, "resume: Acme", t, True, h.embed(chunk_body(c, t)),
                                     doc_title="cv.pdf") for i, (c, t) in enumerate(texts)], h)
    inputs = PromptInputs(question="Tell me about a conflict with stakeholders", qtype=QuestionType.behavioral,
                          is_follow_up=False, session_type="interview", role="Engineer", length="standard",
                          style="natural", answer_language="en")
    built = build_prompt(idx, inputs, SessionMemory())
    user = built.messages[-1].content
    assert "F1 [VERIFIED CANDIDATE FACT]" in user and set(built.facts) <= {"F1", "F2"}
    first = built.facts["F1"].chunk
    assert first.doc_title == "cv.pdf" and "disagreements" in first.text  # the most relevant fact is F1


async def test_engine_attaches_sources_and_applies_the_safety_net() -> None:
    from orbit_api.live.engine import LiveEngine, SessionProfile
    from orbit_api.live.events import LiveSettings
    from orbit_api.providers.stt.base import TranscriptEvent
    from orbit_api.providers.stt.mock import MockSTTProvider
    from tests.test_engine import Sink
    from tests.test_llm_fallback import Scripted

    h = HashingEmbedder()
    t = "Engineer — Acme (2020–2024): Resolved release disagreements with engineering leadership"
    idx = SessionIndex([IndexedChunk("c1", "resume", "experience", "resume: Acme", t, True,
                                     h.embed(chunk_body("experience", t)), doc_title="cv.pdf")], h)

    async def run(reply: str) -> dict:
        sink = Sink()
        eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True),
                         LiveSettings(response_timing="quick"), send=sink, llm=Scripted("deepseek", [reply]),
                         stt=MockSTTProvider(), index=idx)
        await eng.start()
        await eng.on_transcript("system", TranscriptEvent(
            "final", "Tell me about a time you disagreed with leadership?", 0, 100, endpoint=True))
        await sink.wait_for("answer.completed")
        await eng.end()
        return sink.of("answer.completed")[0]["answer"]

    ok = await run("GROUNDED: verified\nANSWER:\nI resolved release disagreements.\nSOURCES: F1\nPOINTS: a | b\n")
    assert ok["grounding"] == "verified"
    assert ok["sources"][0] | {"excerpt": ""} == {"ref": "F1", "chunk_id": "c1", "doc_kind": "resume",
                                                   "document": "cv.pdf", "label": "resume: Acme",
                                                   "excerpt": "", "verified": True}
    bad = await run("GROUNDED: verified\nANSWER:\nI led a team of 40 at Google.\nSOURCES: none\nPOINTS: a\n")
    assert bad["grounding"] == "example" and bad["sources"] == []
