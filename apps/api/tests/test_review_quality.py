"""The review's per-answer rubric, improvement, grounded stronger answer and speaking stats; the top three to practise.

The model writes them; the server keeps only what it can check: a rubric quote has to be the candidate's own words, a
number in a stronger answer has to be one they said or their documents hold (else a placeholder), and the speaking
stats are arithmetic on the answer's own transcript lines."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.sessions.delivery import answer_speaking, count_fillers, delivery_stats
from orbit_api.sessions.report import QAPair, build_review, ground_numbers, quote_in_answer


@dataclass
class T:
    speaker: str
    text: str
    start_ms: int
    end_ms: int


ANSWER = ("So, um, at Acme I moved our billing jobs to a queue, and that cut the nightly run from six hours to "
          "about 40 minutes. I wrote the retry logic myself.")


def test_a_quote_is_kept_only_when_it_is_the_candidates_own_words() -> None:
    assert quote_in_answer("I moved our billing jobs to a queue", ANSWER)
    assert quote_in_answer("“i wrote the retry logic myself.”", ANSWER)  # case, quote marks, a full stop
    assert quote_in_answer("billing jobs to a queue and that cut", ANSWER)  # a dropped comma still matches
    assert not quote_in_answer("I led a team of twelve", ANSWER)  # never said
    assert not quote_in_answer("ill", ANSWER)  # not a word of theirs: "billing" doesn't count
    assert not quote_in_answer("  ", ANSWER)
    assert quote_in_answer("मैंने डैशबोर्ड बनाया", "हाँ, मैंने डैशबोर्ड बनाया था।")  # in their own script


def test_a_stronger_answer_cites_only_numbers_that_were_said_or_are_in_the_documents() -> None:
    docs = "[RESUME] Scaled the platform to 1,200 services; on-call for 3 teams."
    allowed = f"{ANSWER}\n{docs}"
    out = ground_numbers("I cut the run from six hours to 40 minutes, a 37% drop, saving $2M in 2019 across "
                         "1200 services, in 3 steps on S3 and EC2.", allowed)
    assert "40 minutes" in out  # said
    assert "1200 services" in out  # in the resume (as 1,200)
    assert "[the percentage]" in out and "37%" not in out
    assert "[the amount]" in out and "$2M" not in out
    assert "[the year]" in out and "2019" not in out
    assert "3 steps" in out and "S3" in out and "EC2" in out  # a small count and names are left alone
    assert ground_numbers("A package of ₹12 LPA.", ANSWER) == "A package of [the amount]."
    assert ground_numbers("I did [the result in numbers].", ANSWER) == "I did [the result in numbers]."


def _model(**item: Any) -> dict[str, Any]:
    return {"overall_score": 3, "items": [{"q": 1, "score": 3, **item}]}


def test_the_rubric_keeps_scores_reasons_and_only_real_quotes() -> None:
    rubric = {"structure": {"score": 4, "reason": "A clear order.", "quote": "I moved our billing jobs to a queue"},
              "evidence": {"score": 9, "reason": "  Numbers given ", "quote": "I saved the company"},
              "relevance": 5, "clarity": "high", "conciseness": {"score": None, "reason": "Can't tell."}}
    r = build_review(_model(rubric=rubric, improvement="Lead with the result.  "), [QAPair("Q?", ANSWER)])
    assert r is not None
    got = r["items"][0]["rubric"]
    assert got["structure"] == {"score": 4, "reason": "A clear order.", "quote": "I moved our billing jobs to a queue"}
    assert got["specifics"] == {"score": 5, "reason": "Numbers given", "quote": None}  # "evidence" read as specifics
    assert got["relevance"] == {"score": 5, "reason": "", "quote": None}  # a bare score is accepted
    assert "clarity" not in got  # not a score at all
    assert got["conciseness"]["score"] is None
    assert r["items"][0]["improvement"] == "Lead with the result."
    # An unanswered question gets no rubric and no improvement, whatever the model wrote.
    blank = build_review(_model(rubric=rubric, improvement="x"), [QAPair("Q?", "")])
    assert blank is not None and blank["items"][0]["rubric"] == {} and blank["items"][0]["improvement"] == ""


def test_the_top_three_to_practise_point_at_real_questions() -> None:
    model = {"items": [], "top_practice": [
        {"practice": "Give one number for every result", "questions": [1, "Q2", 9, "x"]},
        "Open with the point",
        {"text": "Cut the repeats", "questions": "1"},
        {"practice": "A fourth one", "questions": [1]},
        {"practice": "   "},
    ]}
    r = build_review(model, [QAPair("A?", "a"), QAPair("B?", "b")])
    assert r is not None
    assert r["top_practice"] == [
        {"practice": "Give one number for every result", "questions": [1, 2]},
        {"practice": "Open with the point", "questions": []},
        {"practice": "Cut the repeats", "questions": []},
    ]


def test_each_answer_gets_its_own_speaking_stats_from_its_lines() -> None:
    turns = (T("candidate", "Um, so I moved the billing jobs to a queue, you know, " + "word " * 30, 0, 15_000),
             T("candidate", "And basically it cut the run to forty minutes. " + "word " * 10, 19_000, 25_000))
    r = build_review(_model(), [QAPair("Q?", "the answer", 25_000, turns=turns)])
    assert r is not None
    speaking = r["items"][0]["speaking"]
    words = sum(len(t.text.replace(",", " ").replace(".", " ").split()) for t in turns)
    assert sorted(speaking.pop("top_fillers")) == ["basically", "um", "you know"]
    assert speaking == {"speaking_seconds": 21, "words_per_minute": round(words / (21 / 60)), "fillers": 3,
                        "long_pauses": 1}
    # Typed answers (no timings) and very short ones: nothing to measure.
    assert answer_speaking([T("candidate", "Typed answer.", 0, 0)]) is None
    assert build_review(_model(), [QAPair("Q?", "x")])["items"][0]["speaking"] is None  # type: ignore[index]


def test_hindi_and_hinglish_fillers_and_words_are_counted() -> None:
    assert count_fillers("Matlab, maine yaani dashboard banaya, achha", "hinglish") == {
        "matlab": 1, "yaani": 1, "achha": 1}
    assert count_fillers("मतलब मैंने यानी डैशबोर्ड बनाया", "hi") == {"मतलब": 1, "यानी": 1}
    assert count_fillers("Matlab no", "en") == {}  # an English round counts English fillers only
    hindi = [T("candidate", "मैंने पेमेंट सर्विस को स्केल किया और लेटेंसी कम की " * 4, 0, 30_000)]
    stats = delivery_stats(hindi, language="hi")
    assert stats is not None and stats["words"] == 40  # a Hindi mock round's words, in Devanagari
    speaking = answer_speaking(hindi, language="hi")
    assert speaking is not None and speaking["words_per_minute"] == 80


def test_an_old_stored_review_and_an_old_model_reply_still_work() -> None:
    old = {"overall_score": 4, "strengths": ["s"], "items": [{"q": 1, "score": 4, "feedback": "f", "better": "b"}]}
    r = build_review(old, [QAPair("Q?", "an answer")])
    assert r is not None
    item = r["items"][0]
    assert item["rubric"] == {} and item["improvement"] == "" and item["speaking"] is None and item["better"] == "b"
    assert r["top_practice"] == [] and r["practice"] == []


def test_the_report_uses_the_documents_and_checks_what_the_model_wrote(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import Document, DocumentChunk, LiveSessionRow, Question, SessionDocument, SessionTurn
    from orbit_api.sessions import report
    from tests.test_api import _register

    h = _register(client)
    me = client.get("/v1/auth/me", headers=h).json()["id"]
    sid = client.post("/v1/sessions", headers=h, json={"title": "Review quality", "type": "mock"}).json()["id"]
    answer = "I moved the billing jobs to a queue. Um, it cut the nightly run to forty minutes."
    t0 = datetime.now(UTC)

    async def plant() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status = "ended"
            doc = Document(user_id=me, title="My resume", kind="resume", status="ready")
            db.add(doc)
            await db.flush()
            db.add(DocumentChunk(document_id=doc.id, user_id=me, ordinal=0, category="experience", label="Acme",
                                 text="Acme: billing platform engineer, 2021 to now; 1,200 services."))
            db.add(SessionDocument(session_id=sid, document_id=doc.id))
            db.add(Question(id=f"{sid[:8]}-q", session_id=sid, text="Tell me about a system you improved.",
                            type="behavioral", confidence=0.9, created_at=t0))
            db.add(SessionTurn(id=f"{sid[:8]}-a", session_id=sid, speaker="candidate", text=answer[:37],
                               start_ms=2_000, end_ms=6_000, created_at=t0 + timedelta(seconds=2)))
            db.add(SessionTurn(id=f"{sid[:8]}-b", session_id=sid, speaker="candidate", text=answer[37:],
                               start_ms=10_000, end_ms=16_000, created_at=t0 + timedelta(seconds=10)))
            await db.commit()

    client.portal.call(plant)  # type: ignore[union-attr]
    llm = MockLLMProvider()
    monkeypatch.setattr(report, "get_llm_provider", lambda: llm)
    out = client.portal.call(report.generate_report, sid)  # type: ignore[union-attr]
    prompt = llm.requests[-1].messages[1].content
    assert 'source="candidate_documents"' in prompt and "1,200 services" in prompt
    item = out["review"]["items"][0]
    # The mock's stronger answer cites "37%", which nobody said: a placeholder now.
    assert item["better"].endswith("cut the time by [the percentage].")
    assert item["improvement"] == "[mock] Lead with the result in question 1."
    assert item["rubric"]["structure"]["quote"] == "I moved the billing"  # really theirs
    assert item["rubric"]["specifics"]["quote"] is None  # "I single-handedly saved the company": dropped
    assert item["speaking"]["long_pauses"] == 1 and item["speaking"]["fillers"] == 1
    assert out["review"]["top_practice"][0] == {"practice": "[mock] Give one number for every result",
                                                "questions": [1]}  # question 2 doesn't exist in this session


def test_the_output_budget_fits_a_full_review_of_each_answer() -> None:
    # A real 7-question review overran the old budget (280 a question), was cut off mid-JSON and failed 3 times (D76).
    import json

    from orbit_api.sessions import report

    words = lambda n: " ".join(("we cut the nightly run from six hours to forty minutes " * 20).split()[:n])  # noqa: E731
    item = {"q": 7, "feedback": words(40), "score": 3, "missing_points": [words(10)] * 3, "delivery_score": 3,
            "clarity_score": 3, "dimensions": dict.fromkeys(("problem_framing", "technical_depth", "scalability",
                                                             "edge_case_rigor", "communication_clarity"), 3),
            "rubric": {k: {"score": 3, "reason": words(14), "quote": words(12)} for k in report.RUBRIC},
            "improvement": words(20), "better": words(70)}
    tokens = len(json.dumps(item)) / 4  # English JSON: about four characters a token
    assert tokens <= report.REVIEW_TOKENS_PER_QUESTION
    rich, budget = report.review_budget(7)
    assert rich == 7 and budget >= report.REVIEW_BASE_TOKENS + 7 * tokens
    # A long session: the latest get the full review, the earliest a short one, all within the model's limit.
    rich, budget = report.review_budget(20)
    assert 0 < rich < 20 and budget <= 8_000
    assert report.review_budget(7, factor=2.5)[0] < 7  # Hindi takes more tokens: fewer full reviews fit


def test_a_stronger_answer_checks_spelled_out_numbers_too() -> None:
    # The real call: main's review wrote "about four years of experience" for a candidate who never said how long.
    said = "I lead application security. We agreed on a threshold after two weeks of data. Our team has 12 people."
    assert ground_numbers("I have about four years of experience.", said) == (
        "I have about [the number] years of experience.")
    assert ground_numbers("Twenty-five services, two hundred builds a day.", said) == (
        "[the number] services, [the number] builds a day.")
    kept = "After two weeks of data, a team of twelve."
    assert ground_numbers(kept, said) == kept
    assert ground_numbers("One of the checks failed, in three-quarters of the time.", said) == (
        "One of the checks failed, in three-quarters of the time.")


def test_their_questions_at_the_end_arent_graded_as_an_answer() -> None:
    # The real call: "I'd start with the requirements…" (said after "Is there anything you'd like to ask me?") was
    # quoted in the review as their answer to her last question.
    from types import SimpleNamespace

    from orbit_api.sessions.report import pair_questions_with_answers

    at = datetime(2026, 10, 18, tzinfo=UTC)
    q = SimpleNamespace(id="q1", text="Tell me about a late vulnerability.", created_at=at)
    turns = [SimpleNamespace(speaker=s, text=x, start_ms=0, end_ms=1000, created_at=at + timedelta(seconds=n))
             for n, s, x in [(1, "interviewer", "Tell me about a late vulnerability."),
                             (2, "candidate", "We found an auth bypass two days before launch."),
                             (3, "interviewer", "Got it, thank you. Is there anything you'd like to ask me?"),
                             (4, "candidate", "How big is the team?")]]
    pairs = pair_questions_with_answers([q], turns)  # type: ignore[arg-type]
    assert pairs[0].answer == "We found an auth bypass two days before launch."
