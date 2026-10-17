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


class _Scripted:
    """The test AI, with some of its calls replaced: `script[i]` is the i-th call's answer ("real", "garbled",
    "down")."""

    name = "scripted"

    def __init__(self, *script: str) -> None:
        from orbit_api.providers.llm import get_llm_provider

        self.real, self.script, self.calls = get_llm_provider(), script, 0

    def supports_structured_output(self) -> bool:
        return True

    async def generate(self, req: Any) -> Any:
        from orbit_api.providers.llm.base import LLMResponse, Usage

        what = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        if what == "down":
            raise LLMError("http_503", "down", retryable=True)
        if what == "garbled":
            return LLMResponse(text="Sorry, I can't help with that.", model="scripted", usage=Usage())
        return await self.real.generate(req)


def test_an_ai_answer_that_gives_nothing_keeps_the_credit(client: TestClient, welcome: None,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    """The model answered, but nothing it said could be used: only the free fixes come back, so nothing is spent
    (it used to be: "the AI answered" was taken as "the AI's work was delivered")."""
    from orbit_api.resumes import routes

    h = _signup(client, _new_ip())
    ai = _Scripted("garbled")
    monkeypatch.setattr(routes, "get_llm_provider", lambda: ai)
    out, fixed = _fix(client, h, weak())
    assert ai.calls >= 1 and _check(fixed, "dates").passed and out["followup"] is None
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 1


def test_a_later_ai_pass_failing_still_pays_for_the_first_ones(client: TestClient, welcome: None,
                                                               monkeypatch: pytest.MonkeyPatch) -> None:
    """The first pass's rewrites are delivered, so its credit stays spent: a later pass failing used to give the
    credit back with the AI's work still in the answer."""
    from orbit_api.resumes import routes

    h = _signup(client, _new_ip())
    free, _ = _fix(client, h, weak(), check="dates")
    ai = _Scripted("real", "down")
    monkeypatch.setattr(routes, "get_llm_provider", lambda: ai)
    out, _ = _fix(client, h, weak())
    assert ai.calls >= 2, "the fix needs a second AI call for this test"
    assert len(out["suggestions"]) > len(free["suggestions"])  # the first pass's rewrites are in it
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0


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


def long_senior() -> ResumeData:
    """Four roles, the current one with nine bullets, about 1,150 words, one bullet led by a duty."""
    def bullet(i: int, n: int) -> str:
        figure = f"by {20 + i}%" if i % 3 == 0 else "for the platform, mobile and data teams"
        return (f"Led the security review program across {n + i} product teams, finding and fixing high risk issues "
                f"before release and cutting critical production findings {figure} over two steady years of work "
                "across three regions, two clouds and four audits")
    roles = []
    for r, (title, n) in enumerate([("Senior Staff Engineer", 9), ("Staff Engineer", 6), ("Senior Engineer", 6),
                                     ("Engineer", 6)]):
        roles.append(Experience(title=title, company=f"Co{r}", location="Bengaluru, India", start=f"Jan {2021 - r * 3}",
                                end="" if r == 0 else f"Dec {2023 - r * 3}", current=r == 0,
                                bullets=[bullet(i, r + 3) for i in range(n)]))
    roles[1].bullets[2] = "Responsible for the threat modelling practice across payments, identity and lending teams"
    return ResumeData(basics=Basics(name="Asha Rao", email="asha@example.com", phone="+91 98765 43210",
                                    location="Bengaluru, India", summary="Security engineer. " * 20),
                      experience=roles, skills=[SkillGroup(name="Skills", items=["Burp Suite", "Python", "Go", "AWS"])])


def test_too_many_bullets_keeps_the_strongest_six_free(client: TestClient) -> None:
    data = long_senior()
    plain = [f"Led the security review of release {w} with the product and platform teams" for w in "abcdef"]
    sized = [f"Cut critical production findings by {n}% with threat models and reviews" for n in (30, 40, 50)]
    data.experience[0].bullets = plain + sized  # the ones with a number come last
    check = _check(data, "bullets_per_role")
    assert not check.passed and check.fix_kind == "auto" and "6 strongest" in check.fix
    h = _register(client)
    out, fixed = _fix(client, h, data, check="bullets_per_role")
    kept = [b for b in fixed.experience[0].bullets if b.strip()]
    assert len(kept) == 6 and _check(fixed, "bullets_per_role").passed
    # The ones with a number stayed; each removal names the text it took out, so it can be put back.
    assert kept == plain[:3] + sized  # every one with a number, then the first of the rest, in their order
    removed = [s for s in out["suggestions"] if s["after"] == ""]
    assert len(removed) == 3 and all(s["before"] == get_at(data, s["path"]) for s in removed)


def test_too_long_is_trimmed_to_fit_oldest_roles_first() -> None:
    import asyncio

    from orbit_api.models import User
    from orbit_api.resumes.ats import word_count
    from orbit_api.resumes.autofix import MAX_WORDS, FixIn, fix_resume

    data = long_senior()
    assert word_count(data) > MAX_WORDS

    async def no_credit() -> bool:
        return False

    async def never(_: Any) -> Any:
        raise AssertionError("no AI without a credit")

    out, used = asyncio.run(fix_resume(FixIn(data=data), User(id="u", email="a@example.com"), no_credit, never))
    fixed = data
    for s in out.suggestions:
        fixed = apply_suggestion(fixed, s)
    assert not used and word_count(fixed) <= MAX_WORDS
    counts = [len([b for b in e.bullets if b.strip()]) for e in fixed.experience]
    assert counts[0] >= 4 and min(counts) >= 2 and counts[-1] <= counts[0]  # the oldest role went first
    # Free fixes need no credit: the duty-led bullet is led by its verb.
    assert fixed.experience[1].bullets[2].startswith("Owned the threat modelling practice")
    assert _check(fixed, "action_verbs").passed and _check(fixed, "bullets_per_role").passed


def test_a_duty_or_a_part_becomes_the_verb_and_nothing_else_changes() -> None:
    from orbit_api.resumes.fixes import stronger_opener

    assert stronger_opener("Responsible for building the payments API in Go") == "Built the payments API in Go"
    duty = "Was responsible for the on-call rota for 12 services"
    assert stronger_opener(duty) == "Owned the on-call rota for 12 services"
    assert stronger_opener("Involved in the migration to Kubernetes") == "Contributed to the migration to Kubernetes"
    assert stronger_opener("Worked on fraud models") == "Contributed to fraud models"
    assert stronger_opener("Built the ledger") is None and stronger_opener("Responsible for") is None


def test_a_specialists_own_verbs_count_as_action_verbs() -> None:
    from orbit_api.resumes.ats import is_action_verb

    # An offensive-security resume leads with what was done, in its own words: none of these is a weak opener.
    for verb in ("Pentested", "Exploited", "Hardened", "Fuzzed", "Reverse-engineered", "Red-teamed", "Triaged"):
        assert is_action_verb(verb), verb
    # Describing the person, or being near the work, still isn't.
    for word in ("Worked", "Helped", "Experienced", "Skilled", "Self-motivated", "Detail-oriented", "Speed", "AWS"):
        assert not is_action_verb(word), word
    data = long_senior()
    data.experience[0].bullets[:3] = ["Exploited an SSRF chain in the payments gateway and shipped the fix in 2 days",
                                      "Pentested 14 internal services before launch with the platform team",
                                      "Fuzzed the PDF parser and found 6 memory-safety bugs"]
    data.experience[1].bullets[2] = "Red-teamed the identity platform with two engineers over a quarter"
    assert _check(data, "action_verbs").passed
