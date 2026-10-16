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
