"""Across a session: later answers see what earlier ones said (to stay consistent and not retell the same
story), "why us?" draws on what the job post says about the company, and the company name reaches the prompt."""

from orbit_api.live.context_builder import EARLIER_ANSWERS, PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import FactSource, LiveAnswer, QuestionType
from orbit_api.live.question_detector import classify_type, normalize
from orbit_api.providers.llm.base import LLMMessage
from orbit_api.retrieval.embeddings import get_embedder
from orbit_api.retrieval.index import IndexedChunk, SessionIndex


def _inputs(q: str, **kw: object) -> PromptInputs:
    base: dict[str, object] = dict(question=q, qtype=QuestionType.behavioral, is_follow_up=False,
                                   session_type="interview", role="Backend Engineer", length="standard",
                                   style="natural", answer_language="en")
    base.update(kw)
    return PromptInputs(**base)  # type: ignore[arg-type]


def _answer(points: list[str], label: str | None = None, grounding: str = "verified") -> LiveAnswer:
    sources = [FactSource(ref="F1", chunk_id="c1", doc_kind="resume", document="CV", label=label, excerpt="x",
                          verified=True)] if label else []
    return LiveAnswer(direct_answer="…", key_points=points, sources=sources, grounding=grounding)


def _user(built_messages: list[LLMMessage]) -> str:
    return str(built_messages[1].content)


def test_later_answers_see_earlier_ones_with_the_stories_they_used() -> None:
    memory = SessionMemory()
    memory.note_answer("Tell me about a conflict with a teammate.",
                       _answer(["Disagreed on the rollout plan", "Ran a small pilot", "Shipped together"],
                               label="resume: Senior Engineer — PayCo"))
    memory.note_answer("Tell me about a failure.", _answer(["Missed a deadline"], grounding="example"))
    user = _user(build_prompt(SessionIndex([]), _inputs("Tell me about a time you led without authority."),
                              memory).messages)
    assert '<reference_data source="earlier_answers">' in user
    assert "Q: Tell me about a conflict with a teammate." in user
    assert "Disagreed on the rollout plan | Ran a small pilot | Shipped together" in user
    assert "(drew on: resume: Senior Engineer — PayCo)" in user
    assert "Missed a deadline (an example story, not a verified one)" in user


def test_a_follow_up_sees_the_previous_answer_in_full_and_older_ones_as_notes() -> None:
    memory = SessionMemory()
    memory.note_answer("Old question", _answer(["Old point"]))
    memory.note_answer("Latest question", _answer(["Latest point"]))
    memory.last_answer_brief = "The latest answer in full"
    user = _user(build_prompt(SessionIndex([]), _inputs("Why did you choose that?", is_follow_up=True,
                                                         qtype=QuestionType.follow_up), memory).messages)
    assert "Old point" in user and "Latest point" not in user  # not twice
    assert "The latest answer in full" in user


def test_only_the_last_few_answers_are_kept() -> None:
    memory = SessionMemory()
    for i in range(EARLIER_ANSWERS + 3):
        memory.note_answer(f"Question {i}", _answer([f"point {i}"]))
    assert memory.answers[0].question == "Question 3" and len(memory.answers) == EARLIER_ANSWERS


def test_the_first_answer_has_no_earlier_answers_block() -> None:
    user = _user(build_prompt(SessionIndex([]), _inputs("Tell me about yourself."), SessionMemory()).messages)
    assert "earlier_answers" not in user


def test_why_us_brings_in_what_the_job_post_says_about_the_company() -> None:
    embed = get_embedder().embed
    about = "Acme builds payment infrastructure for small online shops across Europe"
    chunks = [
        IndexedChunk("a", "job_description", "company", "JD: About us", about, False, embed(about)),
        IndexedChunk("r", "job_description", "responsibility", "JD: The role", "Own the ledger service", False,
                     embed("Own the ledger service")),
        IndexedChunk("q", "job_description", "requirement", "JD: Requirements", "5 years of Python", False,
                     embed("5 years of Python")),
    ]
    built = build_prompt(SessionIndex(chunks), _inputs("Why do you want to work here?", qtype=QuestionType.culture,
                                                       company="Acme"), SessionMemory())
    user = _user(built.messages)
    assert about in user and "Own the ledger service" in user
    assert "Company: Acme" in user


def test_closing_and_motivation_questions_are_typed_as_culture() -> None:
    for q in ("Do you have any questions for us?", "Is there anything you'd like to ask me?", "Why this role?",
              "What interests you about our team?", "What do you know about us?"):
        assert classify_type(normalize(q)) is QuestionType.culture, q


def test_the_system_prompt_covers_the_common_interview_questions() -> None:
    system = str(build_prompt(SessionIndex([]), _inputs("x"), SessionMemory()).messages[0].content)
    for cue in ("Tell me about yourself", "Why this company", "Weaknesses", "Do you have any questions for us?",
                "EARLIER ANSWERS"):
        assert cue in system, cue
