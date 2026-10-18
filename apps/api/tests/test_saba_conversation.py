"""The AI video interview as a conversation (DECISIONS D76): turn-taking timed like a person, small talk and the
plan, a reaction before each question, repeats, rephrasing, a moment to think, a check-in after a long silence, a
kind hint after "I don't know", their questions at the end and a goodbye; and the client's voice reports."""

import asyncio
import json
import logging
from typing import Any

import pytest

from orbit_api.live import saba_conversation as talk
from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.mock_interviewer import VIDEO_OPENING_QUESTION, MockConfig, MockInterviewer
from orbit_api.providers.llm.base import LLMRequest, LLMResponse, Usage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink
from tests.test_mock_interview import Spy


class Scripted(MockLLMProvider):
    """Answers the interviewer's model calls with what a test asks for, and keeps every request."""

    def __init__(self, replies: list[dict[str, Any]] | None = None) -> None:
        super().__init__()
        self.replies = list(replies or [])
        self.requests: list[LLMRequest] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        if self.replies:
            return LLMResponse(text=json.dumps(self.replies.pop(0)), model="mock", usage=Usage(1, 1))
        return await super().generate(request)


class Room:
    """A video interview on its own: what it sends, and a clock the test moves."""

    def __init__(self, llm: MockLLMProvider | None = None, minutes: int = 10, name: str | None = "Priya Sharma",
                 **cfg: Any) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []
        self.questions: list[tuple[str, str]] = []
        self.said: list[str] = []
        self.finished = False
        self.llm = llm or Scripted()

        async def send(kind: str, payload: dict[str, Any]) -> None:
            self.sent.append((kind, payload))

        async def on_question(_qid: str, text: str, _f: bool, question: str) -> None:
            self.questions.append((text, question))

        async def on_say(_sid: str, text: str) -> None:
            self.said.append(text)

        async def on_finish() -> None:
            self.finished = True

        self.mi = MockInterviewer(MockConfig(video=True, duration_minutes=minutes, **cfg), llm=self.llm,
                                  index=SessionIndex([]), role="Backend Engineer", company="Acme", send=send,
                                  on_question=on_question, on_finish=on_finish, candidate_name=name,
                                  level="mid", on_say=on_say)
        self.t = 0

    def kinds(self) -> list[str]:
        return [p.get("kind", k) if k == "mock.say" else k for k, p in self.sent]

    def last(self, kind: str) -> dict[str, Any]:
        return next(p for k, p in reversed(self.sent) if k == kind)

    async def say(self, text: str, then_ms: int = 0) -> None:
        self.t += 500
        self.mi.on_candidate(text, self.t, final=True)
        if then_ms:
            await self.wait(then_ms)

    async def wait(self, ms: int, step: int = 100) -> None:
        end = self.t + ms
        while self.t < end:
            self.t = min(end, self.t + step)
            await self.mi.tick(self.t)

    async def to_first_question(self) -> None:
        await self.mi.start(self.t)
        await self.say("Good, thanks. How about you?", 1000)
        assert self.sent[-1][0] == "mock.question"

    def spoke(self, line_id: str) -> None:
        self.mi.on_voice("finished", line_id, self.t)


def test_a_turn_ends_like_a_person_ends_it() -> None:
    assert talk.turn_end_ms("I led the migration and it cut costs by a third.") == talk.COMPLETE_MS
    assert talk.turn_end_ms("So yeah, that's it") == talk.WRAPPED_UP_MS
    assert talk.turn_end_ms("We moved to Kafka because") == talk.UNFINISHED_MS
    assert talk.turn_end_ms("so basically") == talk.UNFINISHED_MS
    assert talk.turn_end_ms("I used Postgres for that,") == talk.UNFINISHED_MS
    assert talk.turn_end_ms("I used Postgres for it") == talk.DEFAULT_MS
    assert talk.WRAPPED_UP_MS < talk.COMPLETE_MS <= 1200 < talk.UNFINISHED_MS
    assert talk.prefetch_after_ms("It worked.") < talk.prefetch_after_ms("and then")


@pytest.mark.parametrize(("said", "intent"), [
    ("Sorry, can you repeat that?", "repeat"),
    ("Could you say that again please", "repeat"),
    ("sorry?", "repeat"),
    ("I didn't catch that", "repeat"),
    ("Can you rephrase the question?", "rephrase"),
    ("I don't understand the question", "rephrase"),
    ("Give me a moment", "wait"),
    ("Let me think about that", "wait"),
    ("Hmm, I don't know", "dont_know"),
    ("I'm not sure", "dont_know"),
    ("No, I think I'm good", "no"),
    ("yes please", "yes"),
    ("ek minute", "wait"),
    ("phir se boliye", "repeat"),
    # How the transcriber actually wrote "Sorry, can you repeat that?" in a real run (D76: it was taken for an answer).
    ("Sorry. Can you repeat?", "repeat"),
    ("Can you repeat?", "repeat"),
    ("Repeat?", "repeat"),
    ("We repeat the scans every week.", None),
    ("I'm not sure, but I think I would add an index on the user id and check the query plan", None),
    ("I built the ledger service and owned its on-call rota for two years", None),
])
def test_what_the_candidate_asks_for(said: str, intent: str | None) -> None:
    assert talk.candidate_intent(said) == intent


def test_names_and_reactions() -> None:
    assert talk.first_name("priya sharma") == "Priya"
    assert talk.first_name("RAHUL") == "Rahul"
    assert talk.first_name("me@example.com") == ""
    assert talk.first_name(None) == ""
    assert talk.smalltalk_reaction("Not bad, a bit tired", "x") in (
        "Sorry to hear that. Let's make this a useful one.", "Ah, I hear you. Let's keep this relaxed.",
        "Fair enough. Let's keep it easy-going.")
    assert talk.smalltalk_reaction("Pretty good thanks", "x") in ("Glad to hear it.", "Good to hear.",
                                                                  "Nice, glad it's going well.")
    assert talk.smalltalk_reaction("I'm a little nervous", "x").startswith("That's completely normal")
    assert talk.smalltalk_reaction("Good, how about you?", "x").endswith("I'm doing well, thanks for asking.")


async def test_saba_says_hello_then_the_plan_then_the_first_question() -> None:
    room = Room()
    await room.mi.start(0)
    assert room.kinds() == ["smalltalk"] and room.said[0].startswith("Hi Priya")
    assert room.llm.requests == []  # instant: no model call
    assert not room.mi.awaiting_answer  # small talk isn't an answer to grade
    await room.say("Pretty good, thanks!", 1000)
    text, question = room.questions[0]
    assert question == VIDEO_OPENING_QUESTION and text.endswith(VIDEO_OPENING_QUESTION[1:])
    assert "10 minutes" in text and "Backend Engineer" in text and text.split(".")[0] in (
        "Glad to hear it", "Good to hear", "Nice, glad it's going well")
    assert room.llm.requests == []


async def test_no_reply_to_the_small_talk_is_fine() -> None:
    room = Room(name=None)
    await room.mi.start(0)
    assert room.said[0].startswith("Hi there")
    await room.wait(3000)
    room.spoke(room.mi._opening_id or "")  # she finished asking 3 s in (her voice took a moment to come)
    await room.wait(talk.SMALLTALK_WAIT_MS - 300)
    assert not room.questions  # counted from when she'd asked, not from when her line went out
    await room.wait(500)
    assert room.questions and room.questions[0][1] == VIDEO_OPENING_QUESTION


async def test_she_repeats_or_rephrases_when_asked_and_it_isnt_graded() -> None:
    room = Room(Scripted([{"question": "In simpler terms: what did you build?"}]))
    await room.to_first_question()
    await room.say("Sorry, can you repeat that?", 300)
    assert room.kinds()[-1] == "repeat" and room.said[-1].endswith(VIDEO_OPENING_QUESTION)
    assert room.mi.asked[-1].answer == []  # the request isn't part of the answer
    await room.say("Can you rephrase it?", 300)
    assert room.kinds()[-1] == "rephrase" and room.said[-1] == "Let me put it another way. In simpler terms: what " \
                                                                 "did you build?"
    assert ("mock.thinking", {}) in room.sent


async def test_a_moment_to_think_and_a_check_in_after_a_long_silence() -> None:
    room = Room()
    await room.to_first_question()
    qid = room.mi.asked[-1].question_id
    room.spoke(qid)  # she finished asking
    await room.wait(talk.CHECK_IN_AFTER_MS + 300)
    assert room.kinds()[-1] == "checkin" and "the question" in room.said[-1]  # one of her ways of asking
    checks = room.kinds().count("checkin")
    await room.wait(talk.CHECK_IN_AFTER_MS + 300)
    assert room.kinds().count("checkin") == checks  # once per question
    await room.say("Yes please", 200)
    assert room.kinds()[-1] == "repeat"
    # On the next question, "give me a moment" means no hurry and no check-in.
    await room.say("I'm a backend engineer and I've spent four years on payments and ledgers.", 1200)
    assert len(room.questions) == 2
    room.spoke(room.mi.asked[-1].question_id)
    await room.say("Give me a moment", 300)
    assert room.kinds()[-1] == "wait"
    await room.wait(talk.CHECK_IN_AFTER_MS + 2000)
    assert room.kinds()[-1] == "wait"


async def test_i_dont_know_gets_a_kind_hint_or_a_move_on() -> None:
    room = Room(Scripted([{"reaction": "Payments in Go", "question": "How do you keep a ledger consistent?",
                           "is_follow_up": True},
                          {"reaction": "That's okay.", "question": "Here's a hint: think about indexes. How would "
                           "you speed up that query?", "is_follow_up": True}]))
    await room.to_first_question()
    await room.say("I'm a backend engineer working on payments, mostly in Go and Postgres.", 1200)
    before = len(room.llm.requests)
    await room.say("Hmm, I don't know", 300)
    assert len(room.llm.requests) > before
    assert "said they don't know" in room.llm.requests[-1].messages[0].content
    assert room.questions[-1][0].startswith("That's okay. Here's a hint")


async def test_she_reacts_to_what_they_said_before_the_next_question() -> None:
    room = Room(Scripted([{"reaction": "Four years on payments ledgers", "question": "What broke first when you "
                           "scaled it?", "is_follow_up": True, "last_answer_score": 4}]))
    await room.to_first_question()
    await room.say("I've spent four years building payments ledgers in Go.", 1200)
    said, question = room.questions[-1]
    assert said == "Four years on payments ledgers. What broke first when you scaled it?"
    assert question == "What broke first when you scaled it?"  # graded as the question alone
    system = room.llm.requests[-1].messages[0].content
    assert '"reaction"' in system and "never praise" in system and "level" in system
    assert "without naming any method" in system and "Never state facts about the company" in system


async def test_the_close_takes_their_questions_and_says_goodbye() -> None:
    llm = Scripted([{"answer": "I don't know the team's size, so the recruiter is the best person to ask."}])
    room = Room(llm, minutes=5)  # three questions
    await room.to_first_question()
    while room.mi.phase == "interview":
        await room.say("I owned the design, wrote the migration plan and we cut latency by forty percent.", 1500)
    assert room.kinds()[-1] == "closing" and ("for me" in room.said[-1] or "ask me" in room.said[-1])
    assert not room.finished
    await room.say("How big is the team?", 1500)
    assert room.kinds()[-1] == "answer" and "recruiter" in room.said[-1]
    await room.say("No, that's all. Thanks!", 1500)
    assert room.kinds()[-1] == "goodbye" and "Priya" in room.said[-1]
    assert not room.finished  # she says goodbye first
    room.spoke(room.last("mock.say")["say_id"])
    await room.wait(600)
    assert room.finished


async def test_she_tells_the_room_when_shes_writing_her_next_line() -> None:
    class Slow(Scripted):
        async def generate(self, request: LLMRequest) -> LLMResponse:
            await asyncio.sleep(0.05)
            return await super().generate(request)

    room = Room(Slow())
    await room.to_first_question()
    room.sent.clear()
    await room.mi.next(room.t)
    assert room.sent[0] == ("mock.thinking", {}) and room.sent[-1][0] == "mock.question"


async def test_hindi_and_panels_keep_their_own_flow() -> None:
    sent: list[str] = []

    async def send(kind: str, _p: dict[str, Any]) -> None:
        sent.append(kind)

    async def noop(*_a: Any) -> None: ...

    hindi = MockInterviewer(MockConfig(video=True), llm=Scripted(), index=SessionIndex([]), role=None, send=send,
                            on_question=noop, on_finish=noop, language="hi")
    await hindi.start(0)
    assert "mock.say" not in sent and sent[-1] == "mock.question"  # no English small talk in a Hindi round


async def test_the_engine_records_her_lines_and_the_voice_reports(caplog: pytest.LogCaptureFixture) -> None:
    now = {"t": 0.0}
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(video=True, duration_minutes=10), candidate_name="Arjun Mehta"),
                     LiveSettings(auto_answer=False), send=sink, llm=Scripted(), stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    await sink.wait_for("mock.say")
    hello = sink.of("mock.say")[0]
    assert hello["text"].startswith("Hi Arjun")
    assert ("interviewer", hello["text"]) in spy.turns  # in the transcript, like anything she says
    await eng.on_transcript("mic", TranscriptEvent("final", "Good, thanks.", 0, 900, endpoint=True))
    now["t"] += 1.5
    await sink.wait_for("mock.question")
    question = sink.of("mock.question")[0]
    with caplog.at_level(logging.WARNING):
        await eng._dispatch("mock.voice", {"event": "started", "line_id": question["question_id"]})
        await eng._dispatch("mock.voice", {"event": "blocked", "line_id": question["question_id"],
                                           "detail": "autoplay"})
    assert "interviewer voice blocked (autoplay)" in caplog.text
    assert eng.latency.samples["mock_reply_after_speech"]
    assert eng.latency.samples["mock_audio_after_speech"]
    await eng.handle_client({"type": "mock.voice", "data": {"event": "nonsense"}})
    assert sink.of("error")[-1]["code"] == "invalid_event"
    await eng.end()


# ---- turns from the candidate's voice, as a real call goes (D76: found with the real transcriber) ----------------

async def voice(room: Room, until: int, every: int = 50) -> None:
    """Their voice on the mic (the server hears it) from now until `until`, the clock moving with it."""
    while room.t < until:
        room.t += every
        room.mi.on_voice_activity(room.t)
        await room.mi.tick(room.t)


async def test_the_small_talk_waits_for_a_reply_that_is_still_coming() -> None:
    # A real run: her "how are you?" took 3.5 s to be heard; the reply's first words weren't final 9 s after the line
    # went out, and she carried on over "…a little nervous, but excited."
    room = Room()
    await room.mi.start(0)
    await room.wait(5000)
    room.spoke(room.mi._opening_id or "")
    await room.wait(800)
    room.mi.on_candidate("I'm doing well", room.t, final=False)
    await voice(room, 9400)
    assert not room.questions  # they're still talking
    room.mi.on_candidate("I'm doing well, thanks! A little nervous, but excited.", room.t + 300, final=True)
    await room.wait(talk.SMALLTALK_MS + 300)
    assert room.questions and room.questions[0][0].startswith("That's completely normal")


async def test_a_pause_between_bursts_of_words_isnt_the_end_of_the_answer() -> None:
    # The transcriber's words come about a second apart: "no new words for 900 ms" happened mid-answer.
    room = Room(Scripted([{"reaction": "Report-only first.", "question": "What made you settle on two weeks?",
                           "is_follow_up": True}]))
    await room.to_first_question()
    room.spoke(room.mi.asked[-1].question_id)
    asked = len(room.questions)
    room.t += 300
    room.mi.on_candidate("So there was a case where we disagreed about blocking builds on scanner findings.", room.t,
                         final=True)
    await voice(room, room.t + 2200)  # still talking; their next words aren't in yet
    assert len(room.questions) == asked
    room.mi.on_candidate("I suggested we start in report only mode", room.t, final=False)
    await voice(room, room.t + 1500)
    room.mi.on_candidate("I suggested we start in report only mode, and we agreed on a threshold after two weeks.",
                         room.t + 500, final=True)
    stopped = room.t
    await room.wait(talk.COMPLETE_MS - 200)
    assert len(room.questions) == asked
    await room.wait(400)
    assert len(room.questions) == asked + 1 and room.t - stopped <= talk.COMPLETE_MS + 200


async def test_the_turn_ends_when_their_voice_stops_not_when_the_words_come_in() -> None:
    room = Room(Scripted([{"reaction": "Four years on ledgers.", "question": "What broke first?",
                           "is_follow_up": True}]))
    await room.to_first_question()
    asked = len(room.questions)
    room.mi.on_candidate("I spent four years on payments", room.t, final=False)
    await voice(room, room.t + 1500)
    stopped = room.t
    await room.wait(600)  # the final comes ~0.6 s after the voice stops
    room.mi.on_candidate("I spent four years on payments and ledgers.", room.t, final=True)
    while len(room.questions) == asked and room.t < stopped + 4000:
        await room.wait(50, step=50)
    # About COMPLETE_MS after they stopped talking, not COMPLETE_MS after the final came in (that was 0.6 s slower).
    assert room.mi.asked[-1].question == "What broke first?"
    assert room.t - stopped <= talk.COMPLETE_MS + 150


async def test_a_noise_that_never_stops_doesnt_hold_the_turn_open() -> None:
    room = Room(Scripted([{"reaction": "Go and Postgres.", "question": "Why Postgres?", "is_follow_up": True}]))
    await room.to_first_question()
    asked = len(room.questions)
    room.mi.on_candidate("I mostly work in Go and Postgres.", room.t, final=True)
    said = room.t
    await voice(room, said + talk.VOICE_AHEAD_MS + talk.COMPLETE_MS + 400)  # a fan, a TV: "voice" all along
    assert len(room.questions) == asked + 1


async def test_she_doesnt_check_in_while_they_are_making_a_sound() -> None:
    room = Room()
    await room.to_first_question()
    room.spoke(room.mi.asked[-1].question_id)
    await room.wait(talk.CHECK_IN_AFTER_MS - 1000)
    await voice(room, room.t + 2000)  # they start ("Umm…"), no words yet
    assert "checkin" not in room.kinds()
    await room.wait(talk.QUIET_FOR_CHECK_IN_MS + 300)
    assert room.kinds()[-1] == "checkin"


async def test_a_note_about_the_candidate_is_never_said() -> None:
    # A real run: the model's "reaction" was "No answer yet, just asked me to repeat the question.", said aloud.
    assert talk.spoken_reaction("No answer yet, just asked me to repeat the question.") == ""
    assert talk.spoken_reaction("The candidate only gave an intro.") == ""
    assert talk.spoken_reaction("Payments, so security there carries real weight.") != ""
    room = Room(Scripted([{"reaction": "No answer yet, just asked me to repeat the question.",
                           "question": "Could you tell me about your background?", "is_follow_up": False}]))
    await room.to_first_question()
    await room.say("I'm a backend engineer and I work on payments.", 1500)
    assert room.questions[-1][0] == "Could you tell me about your background?"


def _tone(level: float, n: int = 640, hz: int = 180) -> bytes:
    """40 ms of PCM16 at 16 kHz: a voice-like tone at peak `level` (0..1)."""
    import math
    import struct
    return b"".join(struct.pack("<h", int(level * 32767 * math.sin(2 * math.pi * hz * i / 16000))) for i in range(n))


def test_the_server_hears_their_voice_in_the_audio() -> None:
    from orbit_api.live.voice_activity import VoiceActivity
    vad = VoiceActivity()
    assert not any(vad.voiced(_tone(0.002)) for _ in range(20))  # a quiet room
    assert vad.voiced(_tone(0.1))  # someone talking
    hum = [vad.voiced(_tone(0.03)) for _ in range(3000)]  # a steady hum: after a while it's the room, not a voice
    assert hum[0] and not hum[-1]
    assert not vad.voiced(b"")


async def test_the_engine_tells_her_when_their_voice_is_on_the_mic() -> None:
    now = {"t": 0.0}
    sink = Sink()
    eng = LiveEngine(SessionProfile("s2", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(video=True, duration_minutes=10)),
                     LiveSettings(auto_answer=False), send=sink, llm=Scripted(), stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=Spy(), clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    assert eng._mock is not None
    await eng.handle_audio(b"\x00" + _tone(0.002))
    assert eng._mock._voice_ms is None  # the room
    now["t"] += 0.5
    await eng.handle_audio(b"\x00" + _tone(0.2))
    assert eng._mock._voice_ms == eng.now_ms()  # them
    await eng.end()
