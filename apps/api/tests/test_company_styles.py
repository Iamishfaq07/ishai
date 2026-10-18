"""Company interview guides (orbit_api/live/company_styles.py): matching names, the mock interviewer asking in the
company's style, the live copilot knowing what its interviewers listen for, and the Practice page's list."""

from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live import company_styles
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.live.mock_interviewer import MockConfig, MockInterviewer
from orbit_api.models import LiveSessionRow
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse, Usage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.retrieval.index import SessionIndex
from orbit_api.sessions.routes import _session_company
from tests.test_api import _register


def test_names_and_aliases_find_the_guide() -> None:
    m = company_styles.match
    assert m("Amazon").slug == m("AWS").slug == m("Amazon (AWS)").slug == "amazon"  # type: ignore[union-attr]
    assert m("Tata Consultancy Services Ltd.").name == "TCS"  # type: ignore[union-attr]
    assert m("google cloud india").name == "Google"  # type: ignore[union-attr]
    assert m("Infosys Limited").name == "Infosys"  # type: ignore[union-attr]
    for unknown in ("", None, "Acme Widgets", "Metadata Inc", "Ltd"):
        assert m(unknown) is None, unknown
    for s in company_styles.STYLES:  # every guide is complete
        assert s.rounds and s.looks_for and s.questions and s.tips and isinstance(s.tips, tuple), s.slug


class _Recording(MockLLMProvider):
    def __init__(self, fail: bool = False) -> None:
        super().__init__()
        self.systems: list[str] = []
        self.fail = fail

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.systems.append(request.messages[0].content)
        if self.fail:
            raise LLMError("unavailable", "down")
        return LLMResponse(text='{"question": "Tell me about a time you owned a hard problem.", "is_follow_up": false}',
                           model="mock", usage=Usage(1, 1))


async def _noop(*_: Any, **__: Any) -> None:
    return None


def _interviewer(llm: _Recording, company: str | None) -> MockInterviewer:
    return MockInterviewer(MockConfig(company=company), llm=llm, index=SessionIndex([]), role="SDE", send=_noop,
                           on_question=_noop, on_finish=_noop, company=company)


async def test_the_mock_interviewer_asks_in_the_companys_style() -> None:
    llm = _Recording()
    await _interviewer(llm, "Amazon")._generate()
    assert "Interview the way Amazon does" in llm.systems[0] and "Customer Obsession" in llm.systems[0]
    plain = _Recording()
    await _interviewer(plain, "Acme Widgets")._generate()
    assert "Interview the way" not in plain.systems[0]


async def test_without_the_model_it_asks_the_companys_own_questions() -> None:
    question, follow_up = await _interviewer(_Recording(fail=True), "TCS")._generate()
    assert question == company_styles.match("TCS").questions[0] and not follow_up  # type: ignore[union-attr]


async def test_the_session_knows_the_mock_company() -> None:
    row = LiveSessionRow(user_id="u", title="Mock", mock_config={"company": "  Flipkart "})
    assert await _session_company(None, row) == "Flipkart"  # type: ignore[arg-type]
    row = LiveSessionRow(user_id="u", title="Mock", mock_config={"negotiation": {"offer": "x", "company": "Swiggy"}})
    assert await _session_company(None, row) == "Swiggy"  # type: ignore[arg-type]


def test_the_copilot_knows_what_the_company_listens_for() -> None:
    def prompt(company: str | None) -> str:
        inputs = PromptInputs(question="Tell me about a time you disagreed with your manager.",
                              qtype=QuestionType.behavioral, is_follow_up=False, session_type="interview", role=None,
                              length="standard", style="natural", answer_language="en", company=company)
        return "\n".join(m.content for m in build_prompt(SessionIndex([]), inputs, SessionMemory()).messages)

    assert "Amazon's interviewers listen for" in prompt("Amazon") and "Disagree and Commit" in prompt("AWS")
    assert "interviewers listen for" not in prompt("Acme Widgets") and "interviewers listen for" not in prompt(None)


def test_the_practice_page_gets_every_guide(client: TestClient) -> None:
    assert client.get("/v1/interview-styles").status_code == 401
    r = client.get("/v1/interview-styles", headers=_register(client))
    assert r.status_code == 200
    names = [s["name"] for s in r.json()]
    assert "Amazon" in names and "TCS" in names and len(names) == len(company_styles.STYLES)
    amazon = next(s for s in r.json() if s["slug"] == "amazon")
    assert "aws" in amazon["aliases"] and amazon["tips"]


def test_a_mock_session_keeps_its_company(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/sessions", headers=h, json={"title": "Mock", "type": "mock",
                                                      "mock": {"company": "Amazon", "duration_minutes": 10}})
    assert r.status_code == 201, r.text
    too_long = client.post("/v1/sessions", headers=h, json={"title": "Mock", "type": "mock",
                                                             "mock": {"company": "x" * 121}})
    assert too_long.status_code == 422


async def test_a_fixed_round_names_the_company() -> None:
    from orbit_api.live.mock_interviewer import DrillItem

    said: list[str] = []

    async def on_question(_qid: str, text: str, *_: Any) -> None:
        said.append(text)

    plan = [DrillItem(question="Why do you want to join our company?", kind="prep")]
    for company, expected in (("AWS", "Why do you want to join Amazon?"), ("Acme", "Why do you want to join Acme?"),
                              (None, "Why do you want to join our company?")):
        said.clear()
        mi = MockInterviewer(MockConfig(drill=plan, company=company), llm=_Recording(), index=SessionIndex([]),
                             role=None, send=_noop, on_question=on_question, on_finish=_noop, company=company)
        await mi.start(0)
        assert said and said[0].endswith(expected), (company, said)


async def test_a_topic_steers_every_question() -> None:
    llm = _Recording()
    mi = MockInterviewer(MockConfig(topic="React performance", video=True), llm=llm, index=SessionIndex([]), role="SDE",
                         send=_noop, on_question=_noop, on_finish=_noop)
    await mi._generate()
    assert "TOPIC: this interview is about the topic below" in llm.systems[0] and "React performance" in llm.systems[0]
    plain = _Recording()
    await _interviewer(plain, None)._generate()
    assert "TOPIC:" not in plain.systems[0]


def test_a_video_interview_is_marked_on_the_session(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/sessions", headers=h, json={"title": "Video interview: React", "type": "mock",
                                                      "mock": {"video": True, "topic": "React performance"}})
    assert r.status_code == 201, r.text
    assert r.json()["video"] is True
    assert client.get(f"/v1/sessions/{r.json()['id']}", headers=h).json()["session"]["video"] is True
    plain = client.post("/v1/sessions", headers=h, json={"title": "Mock", "type": "mock", "mock": {}}).json()
    assert plain["video"] is False
    too_long = client.post("/v1/sessions", headers=h, json={"title": "x", "type": "mock", "mock": {"topic": "y" * 201}})
    assert too_long.status_code == 422


async def test_saba_opens_the_video_interview_at_once_and_keeps_a_calls_pace() -> None:
    from orbit_api.live.mock_interviewer import answer_silence_ms

    llm = _Recording()
    sent: list[tuple[str, dict[str, Any]]] = []

    async def send(kind: str, payload: dict[str, Any]) -> None:
        sent.append((kind, payload))

    mi = MockInterviewer(MockConfig(video=True, topic="React performance", duration_minutes=15), llm=llm,
                         index=SessionIndex([]), role="Frontend Engineer", company="Acme", send=send,
                         on_question=_noop, on_finish=_noop)
    await mi.start(0)
    assert llm.systems == []  # no model call before the first words
    text = sent[0][1]["text"]
    assert text.startswith("Hi, my name is Saba, and I'll be taking your interview today for the Frontend Engineer "
                           "role at Acme.")
    assert "about 15 minutes" in text and "about React performance" in text and "introduce yourself" in text
    # Later questions come from the model, told it's Saba on a video call.
    await mi._generate()
    assert "your name is Saba" in llm.systems[0]
    # A call's pace: an answer ends on a shorter pause than in the classic mock.
    mi.on_candidate("I built the checkout page and cut its load time in half using code splitting", 1000, final=True)
    pause = answer_silence_ms(" ".join(mi.asked[-1].answer))
    await mi.tick(1000 + int(pause * 0.75))
    assert len(sent) == 2 and sent[1][0] == "mock.question"
    # Hindi, a panel or a one-way round write their own opening.
    hindi = MockInterviewer(MockConfig(video=True), llm=_Recording(), index=SessionIndex([]), role=None, send=send,
                            on_question=_noop, on_finish=_noop, language="hi")
    assert not hindi._greets()


def test_outside_india_a_guide_drops_indias_campus_rounds() -> None:
    m, local = company_styles.match, company_styles.for_country
    for name in ("Accenture", "Cognizant", "Deloitte", "Google", "Amazon"):
        assert local(m(name), "IN") is m(name)  # type: ignore[arg-type]  # India: as written
    us = {n: local(m(n), "US") for n in ("Accenture", "Cognizant", "Deloitte", "Google", "Amazon")}  # type: ignore[arg-type]
    accenture, cognizant, deloitte = us["Accenture"], us["Cognizant"], us["Deloitte"]
    assert not any("spoken" in x.lower() for x in (*accenture.rounds, *accenture.tips))
    assert not any("relocat" in x.lower() for x in (*cognizant.looks_for, *cognizant.questions))
    assert not any("group discussion" in r.lower() for r in deloitte.rounds)
    assert "Communication assessment (spoken English)" in m("Accenture").rounds  # type: ignore[union-attr]
    assert "Group discussion (some campus roles)" in m("Deloitte").rounds  # type: ignore[union-attr]
    google = " ".join(us["Google"].questions)
    assert "weekday morning in New York?" in google and "Bengaluru" not in google
    assert "in London?" in " ".join(local(m("Google"), "GB").questions)  # type: ignore[arg-type]
    assert "in a big city?" in " ".join(local(m("Google"), None).questions)  # type: ignore[arg-type]
    assert "in Bengaluru?" in " ".join(m("Google").questions)  # type: ignore[union-attr]
    assert us["Amazon"] == m("Amazon")  # nothing India-only in it
    for s in company_styles.STYLES:  # every guide outside India is complete
        out = local(s, "US")
        assert out.rounds and out.looks_for and out.questions and out.tips, s.slug


async def test_the_mock_and_the_copilot_use_the_guide_for_the_users_country() -> None:
    def mock(country: str | None, company: str = "Google") -> MockInterviewer:
        return MockInterviewer(MockConfig(company=company), llm=llm, index=SessionIndex([]), role="SDE", send=_noop,
                               on_question=_noop, on_finish=_noop, company=company, country=country)

    llm = _Recording()
    await mock("US")._generate()
    await mock("IN")._generate()
    assert "New York" in llm.systems[0] and "Bengaluru" not in llm.systems[0]
    assert "Bengaluru" in llm.systems[1]

    def hint(country: str | None) -> str:
        inputs = PromptInputs(question="Tell me about yourself.", qtype=QuestionType.behavioral, is_follow_up=False,
                              session_type="interview", role=None, length="standard", style="natural",
                              answer_language="en", company="Cognizant", country=country)
        return build_prompt(SessionIndex([]), inputs, SessionMemory()).messages[1].content

    assert "Willingness to learn and relocate" in hint("IN") and "relocate" not in hint("US")


def test_the_practice_page_gets_the_guides_for_the_users_country(client: TestClient) -> None:
    h = _register(client)

    def accenture() -> list[str]:
        styles = client.get("/v1/interview-styles", headers=h).json()
        rounds: list[str] = next(s for s in styles if s["slug"] == "accenture")["rounds"]
        return rounds

    assert "Communication assessment (spoken English)" in accenture()  # no country yet: India's, as always
    assert client.patch("/v1/auth/me/region", headers=h, json={"country": "GB"}).status_code == 200
    assert not any("spoken English" in r for r in accenture())


async def test_the_opening_is_said_whole_but_kept_as_its_question() -> None:
    """Saba's greeting is said as one, but the questions list and the review keep the question alone: Q1 of a video
    interview was stored as the whole greeting. A written opening (Hindi, a panel, a classic mock) gives its greeting
    apart from its question."""
    from orbit_api.live.mock_interviewer import VIDEO_OPENING_QUESTION

    recorded: list[tuple[str, str]] = []

    async def on_question(_qid: str, text: str, _follow_up: bool, question: str) -> None:
        recorded.append((text, question))

    mi = MockInterviewer(MockConfig(video=True), llm=_Recording(), index=SessionIndex([]), role="Analyst",
                         send=_noop, on_question=on_question, on_finish=_noop)
    await mi.start(0)
    said, question = recorded[0]
    assert said.startswith("Hi, my name is Saba") and said.endswith(VIDEO_OPENING_QUESTION[1:])
    assert question == VIDEO_OPENING_QUESTION

    class Opening(_Recording):
        async def generate(self, request: LLMRequest) -> LLMResponse:
            self.systems.append(request.messages[-1].content)
            return LLMResponse(text='{"greeting": "Namaste, main Saba hoon.", "question": "Apne baare mein bataiye.",'
                               ' "is_follow_up": false}', model="mock", usage=Usage(1, 1))

    recorded.clear()
    llm = Opening()
    hindi = MockInterviewer(MockConfig(video=True), llm=llm, index=SessionIndex([]), role=None, send=_noop,
                            on_question=on_question, on_finish=_noop, language="hinglish")
    await hindi.start(0)
    assert '"greeting"' in llm.systems[0]
    assert recorded == [("Namaste, main Saba hoon. Apne baare mein bataiye.", "Apne baare mein bataiye.")]
