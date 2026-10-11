"""The practice queue: spaced repetition over every review's graded questions."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.sessions.practice_queue import build_cards, drill, question_key, queue

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=UTC)


def _days_ago(n: float) -> datetime:
    return NOW - timedelta(days=n)


def _item(question: str, score: int | None, feedback: str = "") -> dict[str, Any]:
    return {"question": question, "you_said": "x" if score else "", "score": score, "feedback": feedback}


def test_a_weak_answer_comes_back_the_next_day_and_good_ones_push_it_further_out() -> None:
    q = "Describe a conflict with a teammate."
    card = build_cards([("s1", _days_ago(2), [_item(q, 2, "No outcome.")])])[0]
    assert card.due_at() == _days_ago(1)  # weak → 1 day later
    assert card.attempts[0].feedback == "No outcome."

    good_once = build_cards([("s1", _days_ago(10), [_item(q, 2)]), ("s2", _days_ago(2), [_item(q, 4)])])[0]
    assert good_once.due_at() == _days_ago(2) + timedelta(days=3)
    good_twice = build_cards([("s1", _days_ago(20), [_item(q, 2)]), ("s2", _days_ago(10), [_item(q, 5)]),
                              ("s3", _days_ago(2), [_item(q, 4)])])[0]
    assert good_twice.due_at() == _days_ago(2) + timedelta(days=7)
    # Weak again: back to the next day, whatever came before.
    relapsed = build_cards([("s1", _days_ago(30), [_item(q, 2)]), ("s2", _days_ago(20), [_item(q, 5)]),
                            ("s3", _days_ago(3), [_item(q, 3)])])[0]
    assert relapsed.due_at() == _days_ago(2)


def test_four_good_answers_in_a_row_and_it_is_learnt() -> None:
    q = "Why this company?"
    history = [("s0", _days_ago(60), [_item(q, None)])] + [
        (f"s{n}", _days_ago(50 - 10 * n), [_item(q, 4)]) for n in range(1, 5)]
    cards = build_cards(history)
    assert cards[0].due_at() is None and cards[0].learnt()
    assert queue(cards, NOW) == ([], [], 1)


def test_a_question_never_answered_weakly_is_not_a_card() -> None:
    cards = build_cards([("s1", _days_ago(5), [_item("Tell me about yourself.", 5)])])
    assert cards[0].due_at() is None and not cards[0].learnt()
    assert queue(cards, NOW) == ([], [], 0)


def test_the_same_question_however_it_was_worded_or_introduced_is_one_card() -> None:
    assert question_key("Let's practise the questions from your prep. Tell me about yourself.") == question_key(
        "tell me about yourself?")
    cards = build_cards([("s1", _days_ago(9), [_item("Tell me about yourself.", 2)]),
                         ("s2", _days_ago(4), [_item("Let's try this one again. Tell me about yourself?", 4)])])
    assert len(cards) == 1 and [a.score for a in cards[0].attempts] == [2, 4]
    assert cards[0].question == "Tell me about yourself."


def test_due_comes_weakest_and_most_overdue_first_and_later_soonest_first() -> None:
    cards = build_cards([
        ("s1", _days_ago(5), [_item("A?", 3), _item("B?", 1), _item("C?", None)]),
        ("s2", _days_ago(0.5), [_item("D?", 2)]),  # due tomorrow
        ("s3", _days_ago(1), [_item("E?", 2), _item("F?", 4)]),  # E due now; F was never weak
    ])
    due, later, learnt = queue(cards, NOW)
    assert [c.question for c in due] == ["C?", "B?", "E?", "A?"]  # unanswered, then by score
    assert [c.question for c in later] == ["D?"] and learnt == 0
    plan = drill(due)
    assert [d.question for d in plan] == [c.question for c in due][:5]
    assert [d.follow_up for d in plan] == [True, True, False, False]
    assert all(d.kind == "retry" for d in plan)


# ---- the endpoints -------------------------------------------------------------------------------------------


def _reviewed(client: TestClient, h: dict[str, str], title: str, items: list[dict[str, Any]], ended: datetime,
              mock: dict[str, Any] | None = None) -> str:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, SessionSummary

    sid = client.post("/v1/sessions", headers=h, json={"title": title}).json()["id"]

    async def go() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status, row.ended_at = "ended", ended
            if mock is not None:
                row.mock_config = mock
            db.add(SessionSummary(session_id=sid, content={"summary": "x", "review": {"items": items}}))
            await db.commit()

    assert client.portal is not None
    client.portal.call(go)
    return sid


def test_the_queue_and_a_round_on_what_is_due(client: TestClient) -> None:
    from tests.test_api import _register

    h = _register(client)
    empty = client.get("/v1/practice/queue", headers=h).json()
    assert empty == {"due": [], "upcoming": 0, "next_due_at": None, "learnt": 0}
    r = client.post("/v1/practice/queue/drill", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "nothing_due"

    now = datetime.now(UTC)
    sid = _reviewed(client, h, "Acme onsite", [_item("Describe a conflict with a teammate.", 2, "No outcome."),
                                                _item("Tell me about yourself.", 5)], now - timedelta(days=3))
    _reviewed(client, h, "Yesterday's mock", [_item("Why this company?", 3)], now - timedelta(hours=2))
    # A negotiation's recruiter lines aren't questions to rehearse.
    _reviewed(client, h, "Salary call", [_item("We can offer 18 LPA.", 2)], now - timedelta(days=3),
              mock={"negotiation": {"offer": "18 LPA"}})

    q = client.get("/v1/practice/queue", headers=h).json()
    assert [d["question"] for d in q["due"]] == ["Describe a conflict with a teammate."]
    assert q["due"][0]["last_score"] == 2 and q["due"][0]["attempts"] == 1 and q["due"][0]["session_id"] == sid
    assert q["upcoming"] == 1 and q["next_due_at"] is not None and q["learnt"] == 0

    r = client.post("/v1/practice/queue/drill", headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["type"] == "mock" and r.json()["title"] == "Practice queue"

    other = _register(client)
    assert client.get("/v1/practice/queue", headers=other).json()["due"] == []  # only your own reviews
