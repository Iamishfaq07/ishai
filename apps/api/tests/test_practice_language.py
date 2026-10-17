"""Hindi and Hinglish mock interviews (orbit_api/practice_language.py): English stays the default and the only choice
while ORBIT_MULTILINGUAL is off; with it on, only a mock interview takes the language, the interviewer is told to speak
it, transcription uses Deepgram's multilingual mode, and the review is written in it."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api import practice_language
from orbit_api.config import get_settings
from orbit_api.live.mock_interviewer import MockConfig, MockInterviewer
from orbit_api.providers.llm.base import LLMRequest, LLMResponse
from orbit_api.retrieval.index import SessionIndex
from tests.test_api import _register
from tests.test_company_styles import _noop, _Recording


@pytest.fixture
def multilingual(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "multilingual", True)


def _session(client: TestClient, h: dict[str, str], **body: Any) -> dict[str, Any]:
    r = client.post("/v1/sessions", headers=h, json={"title": "Practice", **body})
    assert r.status_code == 201, r.text
    out: dict[str, Any] = r.json()
    return out


def test_off_by_default_everything_is_english(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["practice_languages"] == ["en"]
    assert _session(client, h, type="mock", language="hi")["language"] == "en"


@pytest.mark.usefixtures("multilingual")
def test_with_the_flag_only_a_mock_takes_the_language(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["practice_languages"] == ["en", "hi", "hinglish"]
    assert _session(client, h, type="mock", language="hi")["language"] == "hi"
    assert _session(client, h, type="mock", language="HINGLISH")["language"] == "hinglish"
    assert _session(client, h, type="mock", language="fr")["language"] == "en"  # not offered
    assert _session(client, h, type="interview", language="hi")["language"] == "en"  # the copilot stays English
    assert _session(client, h, type="mock")["language"] == "en"  # English is still the default


def test_transcription_setting() -> None:
    assert practice_language.stt_language("en") == "en"
    assert practice_language.stt_language("hi") == "multi"
    assert practice_language.stt_language("hinglish") == "multi"


def _interviewer(llm: _Recording, language: str) -> MockInterviewer:
    return MockInterviewer(MockConfig(), llm=llm, index=SessionIndex([]), role="SDE", send=_noop, on_question=_noop,
                           on_finish=_noop, language=language)


async def test_the_interviewer_is_told_the_language() -> None:
    hindi, hinglish, english = _Recording(), _Recording(), _Recording()
    await _interviewer(hindi, "hi")._generate()
    await _interviewer(hinglish, "hinglish")._generate()
    await _interviewer(english, "en")._generate()
    assert "in Hindi, written in Devanagari" in hindi.systems[0]
    assert "Hinglish" in hinglish.systems[0] and "Latin script" in hinglish.systems[0]
    assert "LANGUAGE:" not in english.systems[0]
    assert "never comment on their choice of language" in hindi.systems[0]


async def test_without_the_model_it_falls_back_in_the_same_language() -> None:
    question, _ = await _interviewer(_Recording(fail=True), "hi")._generate()
    assert question == practice_language.FALLBACK_QUESTIONS["hi"][0]
    question, _ = await _interviewer(_Recording(fail=True), "hinglish")._generate()
    assert question == practice_language.FALLBACK_QUESTIONS["hinglish"][0]


@pytest.mark.usefixtures("multilingual")
def test_the_review_is_written_in_the_language(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, Question, SessionTurn
    from orbit_api.providers.llm.mock import MockLLMProvider
    from orbit_api.sessions import report

    h = _register(client)
    sid = _session(client, h, type="mock", language="hinglish")["id"]

    async def plant() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status = "ended"
            db.add(Question(id=f"{sid[:8]}-q", session_id=sid, text="Apne project ke baare mein bataiye?",
                            type="behavioral", confidence=0.9))
            db.add(SessionTurn(id=f"{sid[:8]}-t", session_id=sid, speaker="candidate",
                               text="Maine payments ka dashboard banaya tha.", start_ms=0, end_ms=1))
            await db.commit()

    llm = MockLLMProvider()
    monkeypatch.setattr(report, "get_llm_provider", lambda: llm)
    client.portal.call(plant)  # type: ignore[union-attr]
    client.portal.call(report.generate_report, sid)  # type: ignore[union-attr]
    system = llm.requests[-1].messages[0].content
    assert "The interview was in Hinglish" in system and "never marked down for its language" in system
    assert llm.requests[-1].max_tokens == practice_language.max_tokens(700 + 160, "hinglish") > 700 + 160  # one pair


async def test_a_drill_in_the_language_leads_in_it_and_names_the_company() -> None:
    """Practice's one-tap HR round in Hindi or Hinglish is a drill of fixed questions written in that language: the
    interviewer's lead line is in it too, and "हमारी कंपनी" / "hamari company" names the company like "our company"."""
    from orbit_api.live.mock_interviewer import DrillItem, bare_question

    said: list[str] = []

    async def on_question(_qid: str, text: str, *_: Any) -> None:
        said.append(text)

    cases = (("hi", "आप हमारी कंपनी से क्यों जुड़ना चाहते हैं?", "आप Acme से क्यों जुड़ना चाहते हैं?"),
             ("hinglish", "Aap hamari company kyun join karna chahte hain?", "Aap Acme kyun join karna chahte hain?"),
             ("en", "Why do you want to join our company?", "Why do you want to join Acme?"))
    for language, question, named in cases:
        said.clear()
        mi = MockInterviewer(MockConfig(drill=[DrillItem(question=question, kind="prep")], company="Acme"),
                             llm=_Recording(), index=SessionIndex([]), role=None, send=_noop, on_question=on_question,
                             on_finish=_noop, company="Acme", language=language)
        await mi.start(0)
        lead = practice_language.DRILL_LEAD.get(language, {}).get("first_prep",
                                                                  "Let's practise the questions from your prep. ")
        assert said == [lead + named], (language, said)
        assert bare_question(said[0]) == named  # a drill of this round's review doesn't open with the lead twice


async def test_output_budgets_grow_with_the_language() -> None:
    """Hindi takes about twice English's tokens: the interviewer's and the review's budgets grow with it, or the
    model's JSON is cut off (and a Hindi round gets no review: see test_the_review_is_written_in_the_language)."""
    assert practice_language.max_tokens(240, "en") == 240
    assert practice_language.max_tokens(240, "hi") == 600
    assert practice_language.max_tokens(240, "hinglish") == 384
    assert practice_language.max_tokens(4_000, "hi") == practice_language.MAX_OUTPUT_TOKENS

    class Budgets(_Recording):
        def __init__(self) -> None:
            super().__init__()
            self.budgets: list[int] = []

        async def generate(self, request: LLMRequest) -> LLMResponse:
            self.budgets.append(request.max_tokens)
            return await super().generate(request)

    english, hindi = Budgets(), Budgets()
    await _interviewer(english, "en")._generate()
    await _interviewer(hindi, "hi")._generate()
    assert (english.budgets, hindi.budgets) == ([240], [600])
