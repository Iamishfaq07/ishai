"""Found by playing a whole spoken interview through real Deepgram and DeepSeek (tools/orbit-drive/interview_e2e.py):
the interviewer moving on within a few seconds of the last question had the new question stitched onto it (the
design question re-answered "time complexity" and replaced the code answer), lines like "I'll make a note of that."
or "You cut out for a second." were carried into the next question, "Tell me a bit about yourself" wasn't
recognised as the introduction question, and a command after a lead-in ("Next question. Write a function…") was
never answered at all."""

import pytest

from orbit_api.live.context_builder import _BROAD_BACKGROUND
from orbit_api.live.events import QuestionType
from orbit_api.live.finalizer import QuestionFinalizer
from orbit_api.live.question_detector import classify_type, detect, lead_in, normalize, starts_new_topic


def _fire(f: QuestionFinalizer, start: int, end: int) -> object:
    return next((x for t in range(start, end, 50) if (x := f.tick(t))), None)


# ---- moving on is a new question ----------------------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "Let's switch to system design.", "Okay, next question.", "Moving on. How do you test it?",
    "Alright, let's move on to testing.", "One more question before we wrap up.", "Let's do a quick coding question.",
    "So, switching gears a bit.", "Um. Okay. My last question is about leadership.",
])
def test_moving_on(text: str) -> None:
    assert starts_new_topic(text)


@pytest.mark.parametrize("text", [
    "How did you resolve it?", "Let's talk about the architecture first.", "You mentioned Kafka.",
    "Next, how would you test it?", "Let's say the input is sorted.", "And why?", "In Go?", "",
])
def test_not_moving_on(text: str) -> None:
    assert not starts_new_topic(text)


def test_a_new_topic_soon_after_an_answered_question_is_its_own_question() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=800)
    f.on_transcript("t1", "What's the time complexity, and can you do it without extra space?", 0, is_final=True,
                    endpoint=True)
    assert f.tick(800)
    # 4 s later, the candidate silent: the first interim doesn't say it yet, the final does
    assert f.on_transcript("t2", "Let's switch", 4000, is_final=False) is None
    f.on_transcript("t2", "Let's switch to system design. How would you design a URL shortener?", 5500,
                    is_final=True, endpoint=True)
    fired = _fire(f, 5500, 8000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "Let's switch to system design. How would you design a URL shortener?")


def test_a_moving_on_line_said_alone_leads_into_the_next_question() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=800)
    f.on_transcript("t1", "What's the time complexity?", 0, is_final=True, endpoint=True)
    assert f.tick(800)
    f.on_transcript("t2", "Let's switch to system design.", 4000, is_final=True, endpoint=True)
    assert _fire(f, 4000, 5000) is None  # not a question by itself
    f.on_transcript("t3", "How would you design a URL shortener?", 7000, is_final=True, endpoint=True)
    fired = _fire(f, 7000, 9000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "Let's switch to system design. How would you design a URL shortener?")


def test_a_second_part_after_a_pause_is_still_stitched() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=800)
    f.on_transcript("t1", "Tell me about a time you disagreed with a teammate.", 0, is_final=True, endpoint=True)
    assert f.tick(800)
    f.on_transcript("t2", "How did you resolve it, and what would you do differently?", 2500, is_final=True,
                    endpoint=True)
    fired = _fire(f, 2500, 5000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "Tell me about a time you disagreed with a teammate. How did you resolve it, and what would you do "
        "differently?")


@pytest.mark.parametrize("text", [
    "Next question. Write a function that reverses a linked list.",
    "My next question is about testing. Walk me through your strategy.",
    "Moving on to SQL. Write a query that finds the second highest salary.",
    "Let's do a quick coding question. Write a function that checks whether a string is a palindrome.",
])
def test_a_command_after_a_lead_in_is_answered_with_its_lead_in(text: str) -> None:
    # Scored together with its lead-in, the command read as a statement (0.15) and was never answered.
    d = detect(text, "interviewer")
    assert d.should_generate and d.question_text == text


# ---- talk around the interview isn't part of the next question --------------------------------------------------


def test_notes_and_reactions_are_not_carried_into_the_next_question() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=800)
    f.on_transcript("t1", "Right. Good. I'll make a note of that.", 0, is_final=True, endpoint=True)
    f.on_transcript("t2", "Okay. Let's do a quick coding question.", 5000, is_final=True, endpoint=True)
    assert _fire(f, 5000, 6000) is None
    f.on_transcript("t3", "Write a function that checks whether a string is a palindrome.", 10000, is_final=True,
                    endpoint=True)
    fired = _fire(f, 10000, 12000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "Let's do a quick coding question. Write a function that checks whether a string is a palindrome.")


def test_call_trouble_is_not_carried_into_the_next_question() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=800)
    f.on_transcript("t1", "Sorry, you cut out for a second there. Let me know when you're back.", 0, is_final=True,
                    endpoint=True)
    f.on_transcript("t2", "We're almost out of time. Do you have any questions for me?", 4000, is_final=True,
                    endpoint=True)
    fired = _fire(f, 4000, 6000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "We're almost out of time. Do you have any questions for me?")


def test_set_up_and_questions_are_still_carried_over() -> None:
    kept = lead_in("That's a great answer, thanks. I'll make a note of that. Okay, so let's say you have a queue "
                   "that's backing up. How would you handle the connection pool running out?", 120)
    assert kept == ("Okay, so let's say you have a queue that's backing up. How would you handle the connection pool "
                    "running out?")


# ---- the introduction question, however it's worded -----------------------------------------------------------


@pytest.mark.parametrize("text", [
    "Tell me a bit about yourself and what you're working on right now.", "Talk a little about yourself.",
    "So tell me more about yourself.",
])
def test_introductions_are_about_the_candidate(text: str) -> None:
    assert classify_type(normalize(text)) is QuestionType.resume
    assert _BROAD_BACKGROUND.search(text)


def test_speech_long_after_a_question_does_not_revive_it() -> None:
    # Desktop, the candidate's answer not heard (only speaker echo on the mic): 21 s after the intro question,
    # Deepgram's SpeechStarted counted as "the interviewer resumed", the old question came back as held, and every
    # later question was stitched onto it.
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=1500)
    f.on_transcript("t1", "Tell me a bit about yourself.", 0, is_final=True, endpoint=True)
    assert _fire(f, 0, 2000)
    f.on_speech_activity(21_000)
    f.on_transcript("t2", "Okay.", 21_200, is_final=True, endpoint=True)
    f.on_speech_activity(24_000)
    f.on_transcript("t3", "Tell me about a time you disagreed with a teammate.", 26_000, is_final=True,
                    endpoint=True)
    fired = _fire(f, 26_000, 29_000)
    assert fired and fired.detection.question_text == (  # type: ignore[attr-defined]
        "Tell me about a time you disagreed with a teammate.")
