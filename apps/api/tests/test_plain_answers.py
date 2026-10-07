"""Plain-spoken answers: sized to the question ("auto" length), pitched at the candidate's real level, honest about
what their background doesn't show, and a glossary (TERMS) of the jargon they're about to say."""

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.documents.parsing import chunk_document
from orbit_api.live.answer_format import AnswerStreamParser
from orbit_api.live.background import Background, infer_level
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.engine import TRAILER_TOKENS, LiveEngine, SessionProfile, resize_steps
from orbit_api.live.events import AnswerRequest, LiveSettings, LiveSettingsPatch, QuestionType
from orbit_api.live.question_detector import classify_type, detect, normalize, question_parts
from orbit_api.live.routing import SIZE_LENGTH, SIZE_TOKENS, pick_size, step_size
from orbit_api.providers.llm.base import LLMRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import IndexedChunk, SessionIndex
from tests.test_api import _register

FRESHER = """Priya Raman

Summary
Final-year B.Tech Computer Science student looking for a first software role.

Education
B.Tech Computer Science — SRM Institute of Science and Technology (2022–2026)

Projects
College Fest Portal: a small website for event registrations, built with HTML, CSS and JavaScript

Experience
Web Development Intern — BrightPixel Studios (May 2025–July 2025)
- Fixed layout bugs on client websites

Skills
HTML
Python
"""
SENIOR = """Rahul Mehta

Summary
Senior backend engineer with 9 years of experience building payment platforms.

Experience
Senior Backend Engineer — Finlytics (2020–2025)
- Moved the payments monolith to Go services on EKS
- Built the Kafka event pipeline for the fraud model

Skills
Python
PostgreSQL
"""
MID = """Sam Lee

Experience
Software Engineer — Acme (Jan 2021 – Dec 2024)
- Built the billing API
"""


def _chunks(text: str, kind: str = "resume") -> list[IndexedChunk]:
    return [IndexedChunk(f"{kind}-{i}", kind, c.category, c.label, c.text, kind == "resume", [])
            for i, c in enumerate(chunk_document(text, kind, "Doc"))]


def _size(q: str) -> str:
    d = detect(q, "interviewer")
    return pick_size(q, d.question_type, len(question_parts(q)))


# ---- auto length -------------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("question", "size"), [
    ("Are you comfortable with Git?", "brief"),
    ("Have you used Kubernetes?", "brief"),
    ("What's your notice period?", "brief"),
    ("Do you know SQL?", "brief"),
    ("Are you open to relocating to Bangalore?", "brief"),
    ("What is an API?", "short"),
    ("What does CI/CD mean?", "short"),
    ("What's the difference between a process and a thread?", "short"),
    ("Can you briefly explain what Kafka is used for?", "short"),
    ("What are your salary expectations?", "short"),
    ("Do you have any questions for us?", "short"),
    ("Would you use SQL or NoSQL for this?", "short"),
    ("Tell me about yourself.", "medium"),
    ("Walk me through your resume.", "medium"),
    ("Why do you want to work here?", "medium"),
    ("What's your biggest weakness?", "medium"),
    ("How does HTTPS keep data safe?", "medium"),
    ("Write a function to reverse a linked list.", "medium"),  # the talk track; the code is shown, not said
    ("Tell me about a time you disagreed with a teammate.", "long"),
    ("Tell me about a project you're proud of.", "long"),
    ("Describe a time you had to learn something new quickly.", "long"),  # "quickly" is no cue to be brief
    ("How would you debug a slow API endpoint?", "long"),
    ("How would you design a URL shortener like bit.ly?", "detailed"),
    ("Design Twitter.", "detailed"),
    ("Explain in detail how you'd migrate a monolith to microservices.", "detailed"),
    ("Walk me through step by step how you'd build and evaluate an end-to-end machine learning pipeline for fraud "
     "detection. Start with the data, then features, model choice, training, evaluation metrics, and what failure "
     "modes you'd watch for.", "detailed"),
])
def test_auto_length_sizes_each_question(question: str, size: str) -> None:
    assert _size(question) == size


def test_their_own_words_move_the_size() -> None:
    assert _size("In one sentence, what is Kubernetes?") == "brief"
    assert _size("Briefly, how would you design a rate limiter?") == "short"
    assert _size("Explain how garbage collection works in depth.") == "detailed"
    # every part of a multi-part question gets room
    assert _size("What is a cache? And when would you not use one?") == "medium"


def test_size_steps_stay_on_the_scale() -> None:
    assert step_size("brief", -1) == "brief" and step_size("detailed", 1) == "detailed"
    assert step_size("medium", -1) == "short" and step_size("medium", 1) == "long"
    assert resize_steps("make it shorter please") == -1 and resize_steps("give me more detail") == 1
    assert resize_steps("give an example") == 0


def test_failure_as_a_technical_subject_is_not_a_story() -> None:
    assert classify_type(normalize("What failure modes would you watch for in a fraud model?")) == \
        QuestionType.technical
    assert classify_type(normalize("How do you retry failed payments?")) == QuestionType.technical
    assert classify_type(normalize("Tell me about a failure.")) == QuestionType.behavioral
    assert classify_type(normalize("What was your biggest failure?")) == QuestionType.behavioral


# ---- the candidate's real level and background -------------------------------------------------------------------

def test_level_is_inferred_from_the_resume_then_the_role() -> None:
    now = datetime(2026, 10, 1, tzinfo=UTC)
    assert infer_level(_chunks(FRESHER), "Senior Backend Engineer", now=now) == "fresher"  # the resume wins
    assert infer_level(_chunks(SENIOR), None, now=now) == "senior"
    assert infer_level(_chunks(MID), None, now=now) == "mid"  # four dated years
    assert infer_level([], "Software Engineering Intern", now=now) == "fresher"
    assert infer_level([], "Staff Engineer", now=now) == "senior"
    assert infer_level([], "Backend Engineer", now=now) is None  # nothing to go on: no level line at all


def test_unshown_technologies_are_the_ones_the_resume_never_mentions() -> None:
    fresher, senior = Background.of(_chunks(FRESHER)), Background.of(_chunks(SENIOR))
    assert fresher.unshown("Have you used Kubernetes?", QuestionType.resume) == ["Kubernetes"]
    assert senior.unshown("Have you used Kubernetes?", QuestionType.resume) == []  # "EKS" shows it
    assert senior.unshown("Have you worked with Postgres before?", QuestionType.resume) == []  # an alias
    assert fresher.unshown("Have you used gRPC?", QuestionType.resume) == ["gRPC"]  # any tool, asked hands-on
    # knowledge, not hands-on use: no framing for definitions, concepts or other kinds of question
    assert fresher.unshown("What is Docker?", QuestionType.technical) == []
    assert fresher.unshown("How does HTTPS keep data safe?", QuestionType.technical) == []
    assert fresher.unshown("Are you open to relocating to Bangalore?", QuestionType.technical) == []
    assert fresher.unshown("Tell me about a time you used Docker.", QuestionType.behavioral) == []
    # no resume: nothing is assumed about what the user has or hasn't done
    assert Background.of([]).unshown("Have you used Kubernetes?", QuestionType.resume) == []


# ---- prompt assembly ---------------------------------------------------------------------------------------------

def _inputs(q: str, **kw: Any) -> PromptInputs:
    base: dict[str, Any] = dict(question=q, qtype=QuestionType.technical, is_follow_up=False,
                                session_type="interview", role="Associate Software Engineer", length="standard",
                                style="natural", answer_language="en")
    base.update(kw)
    return PromptInputs(**base)


def test_prompt_carries_the_size_level_and_honesty_rules() -> None:
    built = build_prompt(SessionIndex([]), _inputs("Have you used Kubernetes?", qtype=QuestionType.resume,
                                                   length="short", size="brief", level="fresher",
                                                   unshown=["Kubernetes"]), SessionMemory())
    user = built.messages[1].content
    assert "Length: BRIEF" in user and "STANDARD" not in user
    assert "Candidate level: FRESHER" in user and "never present an invented project" in user
    assert "don't show the user working with Kubernetes" in user and "haven't used it on a real project" in user
    assert "first sentence is the whole answer in short" in user  # answer first
    assert user.rindex("QUESTION:") > user.index("Length: BRIEF")


def test_a_fixed_length_still_uses_its_own_rule() -> None:
    user = build_prompt(SessionIndex([]), _inputs("What is a B-tree?"), SessionMemory()).messages[1].content
    assert "Length: STANDARD" in user and "Candidate level" not in user and "SIMPLER" not in user


def test_brief_answers_are_never_invited_to_write_code() -> None:
    brief = build_prompt(SessionIndex([]), _inputs("Do you know SQL?", size="brief"), SessionMemory())
    medium = build_prompt(SessionIndex([]), _inputs("How does an index speed up a query?", size="medium"),
                          SessionMemory())
    assert "answering this properly means writing code" not in brief.messages[1].content
    assert "answering this properly means writing code" in medium.messages[1].content


def test_simpler_asks_for_plainer_words() -> None:
    user = build_prompt(SessionIndex([]), _inputs("What is Kafka?", size="short", simpler=True),
                        SessionMemory()).messages[1].content
    assert "SIMPLER" in user and "everyday words" in user


def test_system_prompt_asks_for_plain_words_answer_first_and_terms() -> None:
    system = build_prompt(SessionIndex([]), _inputs("What is Kafka?"), SessionMemory()).messages[0].content
    assert "Plain words, at the level of the question" in system and "never a textbook definition" in system
    assert "Answer first: the first sentence is a complete, sayable answer on its own" in system
    assert "TERMS: <up to 3 technical terms" in system
    assert "SOUND LIKE THE USER, AT THEIR REAL LEVEL" in system


def test_a_project_question_gets_the_resume_projects() -> None:
    # "College Fest Portal: a small website…" shares no word with the question: without the anchor it was never found
    index = SessionIndex(_chunks(FRESHER))
    built = build_prompt(index, _inputs("Tell me about a project you're proud of.", qtype=QuestionType.behavioral),
                         SessionMemory())
    assert "College Fest Portal" in built.messages[1].content


# ---- TERMS -------------------------------------------------------------------------------------------------------

def _parse(raw: str, *, done: bool = True) -> Any:
    p = AnswerStreamParser("q", QuestionType.technical, [])
    p.feed(raw)
    return p.finish() if done else p.snapshot()


def test_terms_line_is_parsed_and_kept_to_what_the_answer_says() -> None:
    a = _parse("GROUNDED: general\nANSWER:\nKubernetes restarts the pod, and after a few crashes there's a backoff.\n"
               "TERMS: pod = one running copy of your app | backoff = waiting longer between retries | "
               "etcd = the cluster's database\nPOINTS: Restart | Back off\n")
    assert [(t.term, t.meaning) for t in a.terms] == [("pod", "one running copy of your app"),
                                                       ("backoff", "waiting longer between retries")]
    assert "TERMS" not in a.direct_answer and a.key_points == ["Restart", "Back off"]


def test_terms_are_at_most_three_and_tolerate_other_separators() -> None:
    a = _parse("ANSWER:\nCI runs tests, CD ships, a pipeline links them, and staging is a test copy.\n"
               "TERMS: CI: tests on every push | CD - shipping it | pipeline = the steps in order | "
               "staging = a test copy | none\n")
    assert [t.term for t in a.terms] == ["CI", "CD", "pipeline"]


def test_no_terms_line_or_none_means_no_terms() -> None:
    assert _parse("ANSWER:\nYes, I use it every day.\nPOINTS: Daily use\n").terms == []
    assert _parse("ANSWER:\nYes.\nTERMS: none\n").terms == []


def test_a_terms_line_still_streaming_is_not_shown_yet() -> None:
    raw = "ANSWER:\nThe pod restarts.\nTERMS: pod = one running co"
    assert _parse(raw, done=False).terms == []
    assert [t.meaning for t in _parse(raw).terms] == ["one running co"]  # the stream ended there


def test_terms_end_an_unclosed_code_block() -> None:
    a = _parse("ANSWER:\nUse a set.\nCODE: python\n```python\nseen = set()\nTERMS: set = a list without repeats\n")
    assert a.code is not None and "TERMS" not in a.code.content and [t.term for t in a.terms] == ["set"]


# ---- the engine --------------------------------------------------------------------------------------------------

class Sink:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def __call__(self, msg: dict[str, Any]) -> None:
        self.events.append(msg)

    def of(self, type_: str) -> list[dict[str, Any]]:
        return [e["data"] for e in self.events if e["type"] == type_]

    async def wait_for(self, type_: str, n: int = 1) -> None:
        async with asyncio.timeout(5):
            while len(self.of(type_)) < n:
                await asyncio.sleep(0.01)


async def _engine(llm: MockLLMProvider, resume: str | None = None, **settings: Any) -> tuple[LiveEngine, Sink]:
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Associate Software Engineer", "en", "en"),
                     LiveSettings(**settings), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex(_chunks(resume) if resume else []))
    await eng.start()
    return eng, sink


def _answers(llm: MockLLMProvider) -> list[LLMRequest]:
    return [r for r in llm.requests if r.request_type in ("answer", "chat")]


async def test_auto_sizes_each_answer_and_tells_the_card() -> None:
    llm = MockLLMProvider()
    eng, sink = await _engine(llm)
    assert eng.settings.length == "auto"  # the default
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "Do you know SQL?"}})
    await sink.wait_for("answer.completed")
    started = sink.of("answer.started")[0]
    # older clients get the fixed length nearest the size; newer ones the size itself
    assert started["size"] == "brief" and started["length"] == SIZE_LENGTH["brief"] == "short"
    request = _answers(llm)[0]
    assert request.max_tokens == SIZE_TOKENS["brief"] + TRAILER_TOKENS  # no room for an essay
    assert "Length: BRIEF" in request.messages[1].content
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "How would you design Twitter?"}})
    await sink.wait_for("answer.completed", 2)
    assert sink.of("answer.started")[1]["size"] == "detailed"
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_a_fixed_length_session_works_as_before() -> None:
    llm = MockLLMProvider()
    eng, sink = await _engine(llm, length="short")
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "Do you know SQL?"}})
    await sink.wait_for("answer.completed")
    started = sink.of("answer.started")[0]
    assert started["length"] == "short" and "size" not in started
    assert "Length: SHORT, about 60–80 words" in _answers(llm)[0].messages[1].content
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_shorter_and_simpler_apply_to_one_answer_only() -> None:
    llm = MockLLMProvider()
    eng, sink = await _engine(llm)
    q = "Tell me about a time you disagreed with a teammate."
    await eng.handle_client({"type": "answer.request", "data": {"question_text": q, "size": "medium",
                                                                "simpler": True}})
    await sink.wait_for("answer.completed")
    assert sink.of("answer.started")[0]["size"] == "medium"
    user = _answers(llm)[0].messages[1].content
    assert "Length: MEDIUM" in user and "SIMPLER" in user
    assert eng.settings.length == "auto"  # the session keeps sizing each question
    await eng.handle_client({"type": "answer.request", "data": {"question_text": q}})
    await sink.wait_for("answer.completed", 2)
    assert sink.of("answer.started")[1]["size"] == "long" and "SIMPLER" not in _answers(llm)[1].messages[1].content
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_make_it_shorter_in_chat_steps_down_from_the_last_size() -> None:
    llm = MockLLMProvider()
    eng, sink = await _engine(llm)
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "How would you debug a slow API?"}})
    await sink.wait_for("answer.completed")
    assert sink.of("answer.started")[0]["size"] == "long"
    await eng.handle_client({"type": "chat.message", "data": {"text": "make it shorter"}})
    await sink.wait_for("answer.completed", 2)
    assert sink.of("answer.started")[1]["size"] == "medium"
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_level_and_unshown_topics_reach_the_prompt() -> None:
    llm = MockLLMProvider()
    eng, sink = await _engine(llm, resume=FRESHER)
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "Have you used Kubernetes?"}})
    await sink.wait_for("answer.completed")
    user = _answers(llm)[0].messages[1].content
    assert "Candidate level: FRESHER" in user and "working with Kubernetes" in user
    await eng.handle_client({"type": "settings.update", "data": {"experience": "senior"}})  # the user knows better
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "What is Docker?"}})
    await sink.wait_for("answer.completed", 2)
    user = _answers(llm)[1].messages[1].content
    assert "Candidate level: SENIOR" in user and "don't show the user working with" not in user
    await eng.handle_client({"type": "session.end", "data": {}})


def test_protocol_models_accept_the_new_values_and_the_old_ones() -> None:
    assert LiveSettings().length == "auto" and LiveSettings().experience == "auto"
    for length in ("short", "standard", "detailed"):  # what installed desktop clients send
        assert LiveSettings(length=length).length == length
    assert LiveSettingsPatch.model_validate({"experience": "fresher"}).experience == "fresher"
    assert AnswerRequest.model_validate({"question_text": "x"}).size is None  # older clients' requests
    assert AnswerRequest.model_validate({"size": "brief", "simpler": True}).simpler is True
    with pytest.raises(ValueError):
        AnswerRequest.model_validate({"size": "huge"})


def test_sessions_and_setups_store_auto_without_a_migration(client: TestClient) -> None:
    h = _register(client)
    default = client.post("/v1/sessions", headers=h, json={"title": "new"})
    assert default.status_code == 201 and default.json()["length"] == "auto"
    old_client = client.post("/v1/sessions", headers=h, json={"title": "desktop 0.1.37", "length": "short"})
    assert old_client.status_code == 201 and old_client.json()["length"] == "short"
    assert client.post("/v1/sessions", headers=h, json={"title": "x", "length": "huge"}).status_code == 422
    ws = client.post("/v1/workspaces", headers=h, json={"name": "Acme", "length": "auto", "document_ids": []})
    assert ws.status_code == 201 and ws.json()["length"] == "auto"
    listed = client.get(f"/v1/sessions/{default.json()['id']}", headers=h).json()
    assert (listed.get("session") or listed)["length"] == "auto"
