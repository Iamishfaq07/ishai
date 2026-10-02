""""Fix with AI" from the ATS score (resumes/autofix.py): the fix is applied and re-checked on the server, so a check
it fixes really passes; numbers only the candidate knows are asked for, claims the resume doesn't prove come back
for review, and the free fixes stay free."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from orbit_api.providers.llm.base import LLMError
from orbit_api.resumes.apply import add_skills, apply_suggestion, get_at, set_at
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.autofix import _collapse
from orbit_api.resumes.fixes import Suggestion
from orbit_api.resumes.schema import Basics, Experience, ResumeData, ResumeDesign, SkillGroup
from tests.test_api import _register
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401 (the fixture)


@pytest.fixture
def welcome(enforce: None, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    """Credits enforced, and every new account gets its welcome credit (the suite signs up past the daily cap)."""
    monkeypatch.setattr(get_settings(), "welcome_daily_limit", 10**9)


def weak() -> ResumeData:
    return ResumeData(
        basics=Basics(name="Asha Rao", phone="+91 98765 43210", summary="Hard working team player."),
        experience=[
            Experience(title="Support Agent", company="Brightdesk", location="Pune, India", start="2020",
                       end="Feb 2022", bullets=["Answered customer emails and chats using zendesk",
                                                "I kept the macro library up to date"]),
            Experience(title="Customer Support Lead", company="Brightdesk", start="Mar 2022", current=True,
                       bullets=["Responsible for handling customer tickets and escalations",
                                "The help center articles were written by me"]),
            Experience(title="Intern", company="Nimbus", start="Jun 2019", end="Dec 2019", bullets=["Data entry"]),
        ],
        skills=[SkillGroup(name="Skills", items=["Zendesk", "Excel"])],
    )


def _fix(client: TestClient, h: dict[str, str], data: ResumeData, design: ResumeDesign | None = None,
         **extra: Any) -> tuple[dict[str, Any], ResumeData]:
    body = {"data": data.model_dump(mode="json"), "design": (design or ResumeDesign()).model_dump(mode="json"),
            "job_text": "", **extra}
    r = client.post("/v1/resumes/fix", headers=h, json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    fixed = data
    for s in out["suggestions"]:  # as the editor applies them
        fixed = apply_suggestion(fixed, Suggestion(**s))
    if out["order"]:
        rank = {rid: i for i, rid in enumerate(out["order"])}
        fixed = fixed.model_copy(update={"experience": sorted(fixed.experience, key=lambda e: rank[e.id])})
    return out, fixed


def _check(data: ResumeData, check: str, design: ResumeDesign | None = None) -> Any:
    return {c.id: c for c in score_resume(data, design or ResumeDesign()).checks}[check]


def test_every_failing_check_says_how_it_gets_fixed_and_lists_all_its_lines() -> None:
    report = score_resume(weak(), ResumeDesign(template="sidebar"))
    failing = {c.id: c for c in report.checks if not c.passed}
    assert all(c.fix_kind in ("ai", "auto", "you") for c in failing.values())
    assert {failing[i].fix_kind for i in ("action_verbs", "no_pronouns", "summary", "quantified")} == {"ai"}
    assert {failing[i].fix_kind for i in ("tech_names", "single_column", "email", "date_order", "dates")} == {"auto"}
    assert failing["link"].fix_kind == "you"
    assert len(failing["action_verbs"].paths) == 4  # every weak opener, not just the first
    assert all(c.fix_kind is None and c.paths == [] for c in report.checks if c.passed)


def test_one_check_fixed_with_ai_really_passes_after(client: TestClient) -> None:
    h = _register(client)
    data = weak()
    assert not _check(data, "action_verbs").passed
    out, fixed = _fix(client, h, data, check="action_verbs")
    assert _check(fixed, "action_verbs").passed
    assert out["remaining"] == [] and out["score_after"] > out["score_before"]
    assert all(s["before"] == get_at(data, s["path"]) for s in out["suggestions"])  # each names the text it replaces


def test_fix_everything_fixes_what_it_can_and_hands_back_the_rest(client: TestClient) -> None:
    h = _register(client)
    data = weak()
    design = ResumeDesign(template="sidebar", show_photo=True, photo="data:image/png;base64,AA")
    out, fixed = _fix(client, h, data, design)
    final = score_resume(fixed, design.model_copy(update=out["design"]))
    passed = {c.id for c in final.checks if c.passed}
    assert {"action_verbs", "no_pronouns", "cliches", "dates", "tech_names", "single_column", "no_photo", "email",
            "date_order", "location", "summary"} <= passed
    assert out["design"] == {"template": "classic", "show_photo": False}
    assert fixed.basics.email and fixed.basics.location == "Pune, India"  # the account's email, the role's city
    assert fixed.experience[0].title == "Customer Support Lead"  # most recent first
    # Only the candidate knows these: asked for, not invented.
    remaining = {c["id"]: c for c in out["remaining"]}
    assert "link" in remaining and remaining["link"]["fix_kind"] == "you"
    assert out["questions"] and all(q["question"] for q in out["questions"])
    assert "quantified" in remaining
    # Bullets drafted from a job title are offered for review, never added silently.
    assert any(s["kind"] == "add_bullet" and s["confirm"] for s in out["review"])
    assert len(fixed.experience[2].bullets) == 1


def test_the_candidates_numbers_are_written_in_and_size_the_lines(client: TestClient) -> None:
    h = _register(client)
    out, fixed = _fix(client, h, weak())
    facts = {q["path"]: f"about {40 + i} a week" for i, q in enumerate(out["questions"])}
    _, done = _fix(client, h, fixed, check="quantified", facts=facts)
    for path, fact in facts.items():
        assert fact in (get_at(done, path) or "")
    assert _check(done, "quantified").passed or len(facts) < 3


def test_mechanical_fixes_need_no_ai_and_no_credit(client: TestClient, welcome: None) -> None:
    h = _signup(client, _new_ip())
    data = weak()
    out, fixed = _fix(client, h, data, check="tech_names")
    assert _check(fixed, "tech_names").passed
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 1  # not spent
    _fix(client, h, data, check="action_verbs")
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0  # one AI action, one credit
    # Out of credits: the free fixes still come back, with the way to get more.
    out, fixed = _fix(client, h, data)
    assert out["upgrade_required"] is True and _check(fixed, "dates").passed


def test_the_ai_being_down_keeps_the_free_fixes_and_the_credit(client: TestClient, welcome: None,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    class Down:
        name = "down"

        def supports_structured_output(self) -> bool:
            return True

        async def generate(self, req: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    from orbit_api.resumes import routes

    h = _signup(client, _new_ip())
    monkeypatch.setattr(routes, "get_llm_provider", lambda: Down())
    out, fixed = _fix(client, h, weak())
    assert out["ai_error"] and _check(fixed, "dates").passed and _check(fixed, "tech_names").passed
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 1


def test_unknown_checks_are_refused(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/resumes/fix", headers=h, json={"data": weak().model_dump(mode="json"), "check": "nope"})
    assert r.status_code == 422


def test_suggestions_apply_on_the_server_as_in_the_editor() -> None:
    data = weak()
    role = data.experience[0]
    path = f"experience.{role.id}.bullets.1"
    assert get_at(data, path) == "I kept the macro library up to date"
    changed = set_at(data, path, "Kept the macro library up to date")
    assert get_at(changed, path) == "Kept the macro library up to date" and get_at(data, path) != get_at(changed, path)
    assert set_at(data, "experience.nope.bullets.0", "x") is data  # unknown path: unchanged
    stale = Suggestion(id="s", path=path, label="", before="something else", after="x", reason="")
    assert apply_suggestion(data, stale) is data  # edited meanwhile: left alone
    assert [i for g in add_skills(data, ["zendesk", "SQL"]).skills for i in g.items] == ["Zendesk", "Excel", "SQL"]
    # Two passes on one line come back as one change from the original text.
    first = Suggestion(id="a", path=path, label="", before=get_at(data, path) or "", after="Kept it current",
                       reason="1", kind="rewrite")
    second = Suggestion(id="b", path=path, label="", before="Kept it current", after="Maintained the macro library",
                        reason="2", kind="rewrite")
    [one] = _collapse(data, [first, second])
    assert one.before == "I kept the macro library up to date" and one.after == "Maintained the macro library"


def test_answering_the_questions_is_part_of_the_fix_and_free(client: TestClient, welcome: None) -> None:
    h = _signup(client, _new_ip())
    out, fixed = _fix(client, h, weak())  # spends the one credit
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0
    assert out["questions"] and out["followup"]
    facts = {q["path"]: "about 40 a week" for q in out["questions"]}
    again, done = _fix(client, h, fixed, check="quantified", facts=facts, followup=out["followup"])
    assert not again["upgrade_required"] and all("about 40 a week" in (get_at(done, p) or "") for p in facts)
    # Without the token, or with one for other lines, it's a new AI action (and there are no credits left).
    asked = set(facts)
    other = {next(f"experience.{e.id}.bullets.{i}" for e in fixed.experience for i in range(len(e.bullets))
                  if f"experience.{e.id}.bullets.{i}" not in asked): "12 a day"}
    for extra in ({}, {"followup": out["followup"] + "x"}, {"followup": out["followup"]},  # spent: once only
                  {"followup": out["followup"], "facts": other}):
        paid, _ = _fix(client, h, fixed, **{"check": "quantified", "facts": facts, **extra})
        assert paid["upgrade_required"] is True
    # Out of credits, a fix that used no AI hands out no token to get AI for free with.
    broke, _ = _fix(client, h, weak())
    assert broke["upgrade_required"] is True and broke["followup"] is None
