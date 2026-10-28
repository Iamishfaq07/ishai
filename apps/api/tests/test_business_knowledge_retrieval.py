"""Deterministic retrieval/citation evaluations over a small fictional Business corpus."""

import pytest

from orbit_api.business.knowledge_retrieval import passages, retrieve, validate_answer


def doc(name: str, title: str, body: str) -> dict[str, object]:
    return {"id": name, "revision": 2, "title": title, "body": body, "review_overdue": False}


CORPUS = [
    doc(
        "feedback",
        "Interview scorecards",
        "Submit independent feedback before reading peer scorecards. Record direct observations and evidence.",
    ),
    doc(
        "budget",
        "Headcount requests",
        "Budget approval requires an annual cost envelope, measurable outcomes and the requested number of positions.",
    ),
    doc(
        "joining",
        "Joining checklist",
        "Joining plans include equipment delivery, a named buddy and the agreed start date.",
    ),
]


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("When should independent feedback be submitted?", "feedback"),
        ("What does a budget approval require?", "budget"),
        ("What belongs on the joining checklist?", "joining"),
    ],
)
def test_reference_rank_on_representative_questions(question: str, expected: str) -> None:
    result = retrieve(CORPUS, question)
    assert result and result[0]["document_id"] == expected


def test_original_spans_unicode_and_overlap_remain_verifiable() -> None:
    body = ("Équipe – résumé policy.\n" * 100) + "Tail ends here."
    pieces = passages(body)
    assert len(pieces) > 1
    assert all(body[offset : offset + len(text)] == text for offset, text in pieces)
    assert pieces[-1][0] + len(pieces[-1][1]) == len(body)
    assert retrieve([doc("unicode", "Équipe résumé", body)], "ÉQUIPE résumé")[0]["document_id"] == "unicode"


def test_no_match_abstains_and_context_stays_bounded() -> None:
    assert retrieve(CORPUS, "Volcanology zygomorphisms") == []
    assert retrieve(CORPUS, "the and how do") == []
    huge = [doc(str(i), "Feedback", "Independent feedback observations. " * 500) for i in range(10)]
    result = retrieve(huge, "independent feedback")
    assert len(result) <= 8 and all(len(r["text"]) <= 1000 for r in result)
    assert max(sum(r["document_id"] == d["id"] for r in result) for d in huge) <= 3


def test_forged_quotes_and_status_mismatches_are_rejected() -> None:
    sources = retrieve(CORPUS, "Independent feedback")
    point = {"passage_id": sources[0]["id"], "quote": "invented source quote", "text": "A fabricated policy statement."}
    with pytest.raises(ValueError):
        validate_answer({"status": "answered", "points": [point]}, sources)
    with pytest.raises(ValueError):
        validate_answer({"status": "answered", "points": []}, sources)
    with pytest.raises(ValueError):
        validate_answer({"status": "insufficient", "points": [{**point, "quote": sources[0]["text"]}]}, sources)
    assert validate_answer({"status": "insufficient", "points": []}, sources).status == "insufficient"
