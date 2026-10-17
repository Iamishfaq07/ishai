"""The question bank (orbit_api/question_bank): every company guide and role pack passes its checks, names never
collide, the honest-framing rules hold, and the mock interviewer and the copilot use a role's pack."""

import json
from typing import Any, get_args

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from orbit_api import question_bank
from orbit_api.live import company_styles, role_packs
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.live.mock_interviewer import MockConfig, MockInterviewer, MockInterviewType, Persona
from orbit_api.question_bank.load import COMPANIES_DIR, ROLES_DIR, BankError, _unique_names
from orbit_api.question_bank.schema import BANNED, CompanyGuide, MockPersona, MockType, RolePack
from orbit_api.retrieval.index import SessionIndex
from tests.test_api import _register
from tests.test_company_styles import _noop, _Recording


def test_the_bank_holds_about_a_hundred_companies_and_thirty_roles() -> None:
    guides, packs = question_bank.companies(), question_bank.roles()
    assert len(guides) >= 95 and len(packs) >= 30
    assert sum(len(g.questions) for g in guides) + sum(len(p.questions) for p in packs) >= 1500
    assert len(list(COMPANIES_DIR.glob("*.json"))) == len(guides)  # nothing skipped
    assert len(list(ROLES_DIR.glob("*.json"))) == len(packs)
    # The ones Orbit's users ask for most.
    slugs = {g.slug for g in guides}
    for must in ("tcs", "infosys", "wipro", "hcltech", "accenture", "cognizant", "capgemini", "flipkart", "swiggy",
                 "zomato", "razorpay", "paytm", "phonepe", "cred", "meesho", "zoho", "freshworks", "google", "amazon",
                 "microsoft", "meta", "apple", "netflix", "salesforce", "adobe", "oracle", "ibm", "deloitte", "ey",
                 "kpmg", "pwc", "goldman-sachs", "jpmorgan"):
        assert must in slugs, must
    roles = {p.slug for p in packs}
    for must in ("software-engineer", "data-analyst", "product-manager", "campus-placement", "nurse", "teacher"):
        assert must in roles, must


def test_every_entry_is_complete_and_its_sections_have_content() -> None:
    for g in question_bank.companies():
        assert g.summary and g.rounds and g.looks_for and g.tips, g.slug
        assert all(q.covers and q.text for q in g.questions), g.slug
        assert {q.type for q in g.questions} == {"behavioral", "role", "fit"}, g.slug
        if g.abroad is not None:
            assert g.abroad.rounds, g.slug
    for p in question_bank.roles():
        assert p.summary and p.rounds and p.looks_for and p.tips and p.mock, p.slug
        assert sum(q.type == "role" for q in p.questions) >= 6, p.slug


def test_no_entry_claims_real_questions_or_names_a_question_site() -> None:
    def text(value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, dict):
            return [s for v in value.values() for s in text(v)]
        if isinstance(value, list):
            return [s for v in value for s in text(v)]
        return []

    for path in [*COMPANIES_DIR.glob("*.json"), *ROLES_DIR.glob("*.json")]:
        for s in text(json.loads(path.read_text(encoding="utf-8"))):
            for pattern, why in BANNED:
                assert not pattern.search(s), f"{path.name}: {why}: {s!r}"
            for source_site in ("glassdoor", "leetcode", "geeksforgeeks", "ambitionbox", "prepinsta"):
                assert source_site not in s.lower(), f"{path.name}: {s!r}"


def _guide(**change: Any) -> dict[str, Any]:
    doc: dict[str, Any] = json.loads((COMPANIES_DIR / "amazon.json").read_text(encoding="utf-8"))
    doc.update(change)
    return doc


@pytest.mark.parametrize("bad", [
    "These are the actual interview questions Amazon uses.",
    "Questions asked at Amazon in 2025.",
    "Leaked questions from last week's drive.",
    "Frequently asked in the final round.",
    "We guarantee you an offer.",
    "Insider tips from recruiters.",
    "Freshers start at 12 LPA.",
    "It has 1,500,000 employees worldwide.",
    "Found on Glassdoor.",
])
def test_the_checks_refuse_overclaiming_text(bad: str) -> None:
    with pytest.raises(ValidationError):
        CompanyGuide.model_validate(_guide(tips=[bad, "A second tip that is fine."]))


@pytest.mark.parametrize("fine", [
    "Explain how you'd find a memory leak in a long-running service.",
    "Talk about delivery guarantees: at-least-once versus exactly-once.",
    "How would you handle an insider threat in a bank's systems?",
])
def test_the_checks_allow_ordinary_technical_words(fine: str) -> None:
    CompanyGuide.model_validate(_guide(tips=[fine, "A second tip that is fine."]))


def test_the_checks_hold_the_shape() -> None:
    with pytest.raises(ValidationError):  # a process stated as certain
        CompanyGuide.model_validate(_guide(rounds=["Every candidate always gets five rounds", "Offer"]))
    with pytest.raises(ValidationError):  # too few company-fit questions
        CompanyGuide.model_validate(_guide(questions=[q for q in _guide()["questions"] if q["type"] != "fit"]))
    with pytest.raises(ValidationError):  # a question without what a good answer covers
        qs = _guide()["questions"]
        CompanyGuide.model_validate(_guide(questions=[{**qs[0], "covers": []}, *qs[1:]]))
    with pytest.raises(ValidationError):  # an unknown field (a typo) isn't silently dropped
        CompanyGuide.model_validate(_guide(tipz=["x"]))
    with pytest.raises(ValidationError):  # a source must be a real https address
        CompanyGuide.model_validate(_guide(sources=[{"title": "Somewhere", "url": "http://example.com"}]))


def test_two_entries_can_never_answer_to_the_same_name() -> None:
    a = CompanyGuide.model_validate(_guide())
    b = CompanyGuide.model_validate(_guide(slug="amazon-two", name="Amazon Two", aliases=["aws"]))
    with pytest.raises(BankError, match="both answer to 'aws'"):
        _unique_names([a, b], "company")
    for entries in (question_bank.companies(), question_bank.roles()):  # and the bank's own don't
        _unique_names(list(entries), "entry")


def test_the_style_records_come_from_the_bank() -> None:
    assert [s.slug for s in company_styles.STYLES] == [g.slug for g in question_bank.companies()]
    amazon = company_styles.match("AWS")
    assert amazon is not None and amazon.questions[0] == question_bank.companies()[
        [g.slug for g in question_bank.companies()].index("amazon")].questions[0].text
    assert company_styles.match("Paytm").market == "india"  # type: ignore[union-attr]
    assert company_styles.match("HCL Technologies").slug == "hcltech"  # type: ignore[union-attr]


def test_a_role_pack_starts_a_mock_the_practice_page_can_run() -> None:
    assert set(get_args(MockType)) <= set(get_args(MockInterviewType))
    assert set(get_args(MockPersona)) <= set(get_args(Persona))
    for p in question_bank.roles():
        RolePack.model_validate(p.model_dump())


def test_typed_roles_find_their_pack() -> None:
    m = role_packs.match
    assert m("Senior Software Engineer II").slug == "software-engineer"  # type: ignore[union-attr]
    assert m("SDE-2").slug == "software-engineer"  # type: ignore[union-attr]
    assert m("Data Analyst Intern").slug == "data-analyst"  # type: ignore[union-attr]
    assert m("Java Backend Developer").slug == "backend-developer"  # type: ignore[union-attr]
    assert m("Staff Nurse").slug == "nurse"  # type: ignore[union-attr]
    for nothing in (None, "", "Senior", "Staff Engineer", "SAP Consultant", "Chief Happiness Officer"):
        assert m(nothing) is None, nothing


async def test_the_mock_interviewer_tests_what_the_role_needs() -> None:
    llm = _Recording()
    mi = MockInterviewer(MockConfig(interview_type="technical"), llm=llm, index=SessionIndex([]), role="Data Analyst",
                         send=_noop, on_question=_noop, on_finish=_noop)
    await mi._generate()
    assert "Interviews for data analyst roles usually check" in llm.systems[0]
    plain = _Recording()
    await MockInterviewer(MockConfig(interview_type="technical"), llm=plain, index=SessionIndex([]), role="Astronaut",
                          send=_noop, on_question=_noop, on_finish=_noop)._generate()
    assert "usually check" not in plain.systems[0]
    # Without the model: the usual opener, then the role's own questions before the general ones.
    said: list[str] = []

    async def on_question(_qid: str, text: str, *_: Any) -> None:
        said.append(text)

    offline = MockInterviewer(MockConfig(interview_type="technical"), llm=_Recording(fail=True), index=SessionIndex([]),
                              role="Data Analyst", send=_noop, on_question=on_question, on_finish=_noop)
    await offline.start(0)
    assert said and "background" in said[0]
    question, _ = await offline._generate()
    pack = role_packs.match("Data Analyst")
    assert pack is not None and question == next(q.text for q in pack.questions if q.type == "role")


def test_the_copilot_knows_what_a_roles_interviewers_check() -> None:
    def prompt(role: str | None, session_type: str = "interview") -> str:
        inputs = PromptInputs(question="How would you find out why orders dropped?", qtype=QuestionType.behavioral,
                              is_follow_up=False, session_type=session_type, role=role,  # type: ignore[arg-type]
                              length="standard", style="natural", answer_language="en")
        return "\n".join(m.content for m in build_prompt(SessionIndex([]), inputs, SessionMemory()).messages)

    assert "Interviewers for data analyst roles usually check" in prompt("Senior Data Analyst")
    assert "usually check" not in prompt("Astronaut") and "usually check" not in prompt(None)
    assert "usually check" not in prompt("Data Analyst", session_type="meeting")  # not a sales call or a meeting


def test_the_practice_page_learns_where_each_company_is_suggested(client: TestClient) -> None:
    styles = client.get("/v1/interview-styles", headers=_register(client)).json()
    assert len(styles) == len(company_styles.STYLES)
    by_slug = {s["slug"]: s for s in styles}
    assert by_slug["meesho"]["market"] == "india" and by_slug["tcs"]["market"] == "india-first"
    assert by_slug["google"]["market"] == "global"
