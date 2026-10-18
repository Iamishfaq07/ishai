"""LinkedIn AI's fixes: the score's sections and what each fix adds, each fix type against LinkedIn's limits and the
honesty rules, what a fix costs (once, and nothing when it fails), and the suggestions kept with the profile (apply,
re-score, done, ownership)."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api import credits
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.linkedin import fixes
from orbit_api.linkedin import routes as linkedin_routes
from orbit_api.linkedin import suggestions as sug
from orbit_api.linkedin.audit import ROLE_WEIGHTS, audit, score_if
from orbit_api.linkedin.read import Profile, Role, School, parse_read
from orbit_api.linkedin.where import ABOUT_MAX, HEADLINE_MAX, ROLE_MAX
from orbit_api.models import Resume, User
from orbit_api.providers.llm.base import LLMError, LLMRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.resumes import allowance
from orbit_api.resumes import routes as resume_routes
from orbit_api.resumes.schema import Basics, Experience, ResumeData, SkillGroup
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)
from tests.test_linkedin import PDF_TEXT, _verify

KW = ["Go", "Kafka", "PostgreSQL", "Kubernetes", "AWS", "Docker", "Redis", "gRPC", "Python", "Microservices"]


def _profile(**kw: Any) -> Profile:
    base: dict[str, Any] = dict(
        name="Asha Rao", headline="Backend Engineer at PayNest", location="Bengaluru, Karnataka, India",
        about="I build payment systems. I like hard problems and good teams.",
        url="www.linkedin.com/in/asha-rao-4b2a91c7",
        experience=[Role(title="Backend Engineer", company="PayNest", dates="January 2021 - Present", current=True,
                         description="Built the payouts service in Go handling 2 million transfers a day, and cut "
                                     "settlement time by 40% with Kafka."),
                    Role(title="Software Engineer", company="Acme", dates="June 2018 - December 2020",
                         description="Worked on the billing team's services in Python and PostgreSQL."),
                    Role(title="Intern", company="Globex", dates="2017")],
        education=[School(school="IIT Delhi", degree="B.Tech, Computer Science")],
        skills=["Go", "Kafka", "PostgreSQL"], certifications=["AWS Certified Developer"])
    base.update(kw)
    return Profile(**base)


def _src(p: Profile | None = None, *, resume: ResumeData | None = None, use_profile: bool = True,
         target: str = "Backend Engineer") -> fixes.Sources:
    return fixes.Sources(profile=p or _profile(), use_profile=use_profile, resume=resume, target=target, market=KW)


def _mock(req: LLMRequest) -> str:
    return MockLLMProvider()._response_for(req)


def _resume() -> ResumeData:
    return ResumeData(
        basics=Basics(name="Asha Rao", email="asha@example.com", location="Bengaluru"),
        experience=[Experience(title="Backend Engineer", company="PayNest Pvt Ltd", start="Jan 2021", current=True,
                               bullets=["Moved settlements to event sourcing on Kafka, 3 releases early",
                                        "Ran on-call for 14 services on Kubernetes"]),
                    Experience(title="Software Engineer", company="Acme", start="Jun 2018", end="Dec 2020",
                               bullets=["Shipped the invoicing API in Python"])],
        skills=[SkillGroup(name="Tech", items=["Go", "Kafka", "Kubernetes", "Redis", "Docker"])])


# ---- the score ------------------------------------------------------------------------------------------------


def test_the_pdf_sections_are_worth_100_and_what_it_cannot_see_is_not_scored() -> None:
    a = audit(_profile(), "Backend Engineer", KW)
    known = [c for c in a.checks if c.known]
    assert sum(c.max for c in known) == 100  # three roles: every PDF section at its full weight
    assert a.score == round(sum(c.points for c in known) / 100 * 100)
    unknown = {s.id for s in a.sections if not s.known}
    assert unknown == {"featured", "photo", "recommendations", "activity"}
    assert all(c.points == 0 and c.gain >= 0 for c in a.checks if not c.known)
    sections = {s.id: s for s in a.sections}
    assert sum(s.max for s in a.sections if s.known) == 100
    exp = sections["experience"]
    assert exp.max == 4 + 3 + sum(t + f for t, f, _ in ROLE_WEIGHTS) == 25
    assert [r.label for r in exp.roles] == ["Backend Engineer at PayNest", "Software Engineer at Acme",
                                            "Intern at Globex"]
    d = _profile().experience[0].description
    assert (exp.roles[0].points, exp.roles[0].max) == (round(6 * len(d) / 150) + 3, 9)  # short of 150, with figures
    assert exp.roles[2].points == 0  # the intern role has nothing written


def test_each_fix_says_what_it_adds_and_the_biggest_comes_first() -> None:
    a = audit(_profile(), "Backend Engineer", KW)
    for c in a.checks:
        if c.known and not c.ok:
            assert c.gain == score_if(a.checks, {c.id}) - a.score and c.part != "" and c.kind in ("ai", "auto", "you")
    gains = [r.gain for r in a.raise_it]
    assert gains == sorted(gains, reverse=True) and gains[0] > 0
    head = next(r for r in a.raise_it if r.part == "headline")
    assert head.kind == "ai" and head.label == "Rewrite the headline"
    assert head.gain == score_if(a.checks, set(head.checks)) - a.score >= max(
        c.gain for c in a.checks if c.id in head.checks)
    intern = next(r for r in a.raise_it if r.part == "experience" and r.role == 2)
    assert intern.label == "Rewrite Intern at Globex" and set(intern.checks) == {"exp_text_2", "exp_figures_2"}
    assert next(r for r in a.raise_it if r.part == "url").kind == "auto"


def test_what_is_known_is_scored_and_no_job_posts_costs_nothing() -> None:
    seen = audit(_profile(recommendations=1, activity=False, featured=[], photo=True, banner=True),
                 "Backend Engineer", KW)
    by = {c.id: c for c in seen.checks}
    assert all(by[i].known for i in ("recommendations", "activity", "featured", "photo", "banner"))
    assert by["recommendations"].points == 2 and not by["recommendations"].ok  # one of two: half
    assert by["photo"].ok and by["banner"].ok and not by["featured"].ok
    assert sum(c.max for c in seen.checks if c.known) == 100 + 3 + 3 + 2 + 3
    # Projects count for Featured: the section shows the work either way.
    assert next(c for c in audit(_profile(projects=["Ledger"]), "", KW).checks if c.id == "featured").ok
    # No job posts for the role: the keyword checks aren't held against the profile.
    bare = audit(_profile(), "Backend Engineer", [])
    assert not {c.id for c in bare.checks if not c.known} - {"featured", "photo", "banner", "recommendations",
                                                               "activity", "skills_market", "keywords"}
    assert bare.score > audit(_profile(), "Backend Engineer", KW).score - 20


def test_the_read_only_trusts_sections_the_text_has() -> None:
    raw = json.dumps({"name": "Asha Rao", "headline": "Backend Engineer at PayNest", "featured": ["Ledger talk"],
                      "recommendations_received": 4, "activity": True, "projects": ["Payout service"]})
    p = parse_read(raw, PDF_TEXT)  # a PDF: no Featured, Recommendations or Activity sections in it
    assert (p.featured, p.recommendations, p.activity, p.projects) == (None, None, None, [])
    pasted = PDF_TEXT + "\nFeatured\nLedger talk\nRecommendations\nReceived (4)\nActivity\nProjects\nPayout service"
    p = parse_read(raw, pasted)
    assert (p.featured, p.recommendations, p.activity, p.projects) == (["Ledger talk"], 4, True, ["Payout service"])


# ---- each fix ---------------------------------------------------------------------------------------------------


def test_headline_options_fit_name_only_backed_skills_and_never_promote() -> None:
    src = _src(target="Senior Backend Engineer")
    req = fixes.headline_request(src, MockLLMProvider())
    body = req.messages[-1].content
    assert "Kubernetes" in body.split("never claim these")[1]  # the market wants it, the profile doesn't show it
    options = fixes.parse_headline(_mock(req), src)
    assert len(options) == 3 and len({o.label for o in options}) == 3
    assert all(len(o.text) <= HEADLINE_MAX and "Kubernetes" not in o.text for o in options)
    assert all(not o.text.lower().startswith("senior") for o in options)  # never more senior than the sources
    long = json.dumps({"options": [{"style": "search", "text": "Backend Engineer | " + " | ".join(
        ["Go, Kafka, PostgreSQL payments work"] * 12)}, {"style": "result", "text": "Backend Engineer | Kubernetes"},
        {"style": "focus", "text": "Backend Engineer | Cut costs by 75% with Rust"}]})
    got = fixes.parse_headline(long, src)
    assert len(got[0].text) <= HEADLINE_MAX
    assert all("Kubernetes" not in o.text and "Rust" not in o.text and "75%" not in o.text for o in got)
    with pytest.raises(ValueError):
        fixes.parse_headline('{"options": [{"style": "search", "text": "Rust | Kubernetes"}]}', src)


def test_about_has_an_opening_before_see_more_and_fits() -> None:
    src = _src()
    about = fixes.parse_about(_mock(fixes.about_request(src, MockLLMProvider())), src)
    opening = about.split("\n\n")[0]
    assert len(opening) <= 265 and len(about) <= ABOUT_MAX and "Message me here" in about
    long = json.dumps({"opening": "Backend engineer building payments in Go. " * 20,
                       "rest": "The payouts service moves 2 million transfers a day. I saved the bank 9 crore last "
                               "year. I rewrote the ledger in Rust. " + "More work. " * 400})
    about = fixes.parse_about(long, src)
    assert len(about.split("\n\n")[0]) <= 265 and len(about) <= ABOUT_MAX
    # A figure the sources give stays; one they don't goes with its sentence, and so does a tool they never name.
    assert "2 million" in about and "9 crore" not in about and "Rust" not in about


def test_role_bullets_keep_only_this_roles_figures_and_mark_the_rest_as_placeholders() -> None:
    src = _src()
    text, holes = fixes.parse_role(_mock(fixes.role_request(src, 0, MockLLMProvider())), src, 0)
    assert text.startswith("• ") and len(text) <= ROLE_MAX
    assert "2 million" in text and "40%" in text  # stated for this role: kept
    assert "35%" not in text and "[X%]" in text and "[N users]" in text and holes == 2
    # The second role states no figures: the first role's 40% isn't moved into it.
    other = json.dumps({"bullets": ["Built the billing services in Python and PostgreSQL, cutting errors by 40%",
                                    "Moved invoices to PostgreSQL for 3 product teams", "Rewrote it in Rust"]})
    text, holes = fixes.parse_role(other, src, 1)
    assert "40%" not in text and "[X%]" in text and "for [X] product teams" in text and "Rust" not in text
    assert holes == 2
    # From the resume: its own figures for the same role count.
    both = _src(resume=_resume())
    assert "on-call for 14 services" in fixes.parse_role(json.dumps({"bullets": [
        "Ran on-call for 14 services on Kubernetes", "Built the payouts service in Go"]}), both, 0)[0]


def test_skills_are_ordered_by_demand_and_never_invented() -> None:
    s = fixes.skills_fix(_src())
    assert s is not None and s.items[:3] == ["Go", "Kafka", "PostgreSQL"] and "Kubernetes" not in s.items
    assert "Python" in s.items  # named in a role's description: the profile shows it
    with_resume = fixes.skills_fix(_src(resume=_resume()))
    assert with_resume is not None and "Kubernetes" in with_resume.items and "Redis" in with_resume.items
    assert with_resume.items.index("Kubernetes") < with_resume.items.index("Python") or "Kubernetes" in KW[:4]
    assert "New on LinkedIn" in with_resume.note and not with_resume.ai
    done = _profile(skills=["Go", "Kafka", "PostgreSQL", "AWS", "Python"], experience=[])
    assert fixes.skills_fix(_src(done)) is None  # already in the market's order, nothing new to add


def test_url_featured_recommendation_and_checklists() -> None:
    url = fixes.url_fix(_profile(), "Backend Engineer")
    assert url is not None and [o.text for o in url.options] == [
        "linkedin.com/in/asha-rao", "linkedin.com/in/asharao", "linkedin.com/in/asha-rao-backend-engineer"]
    assert all(3 <= len(o.text.rsplit("/", 1)[1]) <= 100 for o in url.options)
    src = _src(_profile(projects=["Payout service"]))
    ideas = fixes.parse_featured(_mock(fixes.featured_request(src, MockLLMProvider())), src)
    assert [t for t, _ in ideas] == ["Payout service", "AWS Certified Developer"]
    made_up = json.dumps({"ideas": [{"title": "Kubernetes operator", "what": "A repo."},
                                    {"title": "Payout service", "what": "Slides on 3x faster payouts."}]})
    assert fixes.parse_featured(made_up, src) == [("Payout service", "Slides on faster payouts.")]
    req = fixes.recommendation_request(src, 1, "Priya Nair", MockLLMProvider())
    msg = fixes.parse_recommendation(_mock(req), src, 1, "Priya Nair")
    assert msg.startswith("Hi Priya,\n\n") and msg.endswith("Thanks,\nAsha Rao") and "Software Engineer" in msg
    invented = json.dumps({"body": "Rahul suggested I ask you about this. We worked on billing at Acme together for "
                                   "two years. You could mention the billing services I built in Python."})
    msg = fixes.parse_recommendation(invented, src, 1, "")
    assert "Rahul" not in msg and msg.startswith("Hi,\n\n")
    otw = fixes.open_to_work_fix(_profile(), "Backend Engineer")
    assert "Backend Engineer" in otw.items[0] and "Bengaluru" in otw.items[2] and len(otw.items) == 6
    assert fixes.photo_fix(_profile()).part == "photo"


def test_applying_rescores_and_putting_back_restores_the_read() -> None:
    read = _profile()
    s = fixes.headline_suggestion(_src(), [sug.Option(label="A", text="Backend Engineer | Go, Kafka, PostgreSQL")])
    state = sug.put(sug.State(read=read), s)
    p = sug.apply(read, s)
    assert sug.applied(p, s) and not sug.applied(read, s)
    assert audit(p, "Backend Engineer", KW).score > audit(read, "Backend Engineer", KW).score
    assert sug.unapply(p, read, s).headline == read.headline
    assert audit(sug.projected(read, state.suggestions), "Backend Engineer", KW).score == audit(
        p, "Backend Engineer", KW).score
    again = sug.put(state, fixes.headline_suggestion(_src(), [sug.Option(label="B", text="Other headline here")]))
    assert len(again.suggestions) == 1  # one per part: writing it again replaces it
    # A new read where LinkedIn has the new headline: ticked done.
    fresh = read.model_copy(update={"headline": "Backend Engineer | Go, Kafka, PostgreSQL"})
    assert sug.after_read(state, fresh).suggestions[0].done


# ---- the API ----------------------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_keywords() -> Any:
    """The market's keywords are cached per role: each test inserts its own job posts."""
    linkedin_routes._kw_cache.clear()
    yield
    linkedin_routes._kw_cache.clear()


def _setup(jobs: TestClient) -> dict[str, str]:  # noqa: F811
    _register(jobs)  # the first account stands in as the admin: not ours
    h = _register(jobs)
    _verify(jobs, h)
    insert(jobs, *[_listing(company=f"C{i}", title="Backend Engineer",
                            keywords=["Go", "Kafka", "Kubernetes", "AWS", "Docker"]) for i in range(4)])
    r = jobs.post("/v1/linkedin/read-file", headers=h, files={"file": ("Profile.txt", PDF_TEXT.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    return h


def _uid(jobs: TestClient, h: dict[str, str]) -> str:  # noqa: F811
    return str(jobs.get("/v1/auth/me", headers=h).json()["id"])


def _resume_id(jobs: TestClient, h: dict[str, str]) -> str:  # noqa: F811
    r = jobs.post("/v1/resumes", headers=h, json={"title": "Mine", "data": _resume().model_dump(mode="json")})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_fix_apply_rescore_done_and_ownership(jobs: TestClient) -> None:  # noqa: F811
    h = _setup(jobs)
    start = jobs.get("/v1/linkedin", headers=h).json()
    assert start["scores"] == {"read": start["audit"]["score"], "now": start["audit"]["score"],
                               "projected": start["audit"]["score"]}
    assert start["audit"]["raise_it"] and start["suggestions"] == [] and start["progress"] == {"done": 0, "total": 0}
    r = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"})
    assert r.status_code == 200, r.text
    out = r.json()
    s = out["suggestions"][0]
    assert s["id"] == out["suggestion_id"] and s["part"] == "headline" and len(s["options"]) == 3 and s["ai"]
    assert s["limit"] == 220 and s["where"] and s["help_url"].startswith("https://www.linkedin.com/help/")
    assert s["applies"] and not s["applied"] and out["scores"]["projected"] > out["scores"]["now"]

    applied = jobs.post(f"/v1/linkedin/suggestions/{s['id']}/apply", headers=h).json()
    assert applied["profile"]["headline"] == s["options"][0]["text"] and applied["suggestions"][0]["applied"]
    assert applied["scores"]["now"] == applied["audit"]["score"] > applied["scores"]["read"]
    assert applied["read"]["headline"] == "Backend Engineer at PayNest"  # what LinkedIn says is kept apart
    # Another option: no longer the applied one, until it's applied.
    picked = jobs.patch(f"/v1/linkedin/suggestions/{s['id']}", headers=h, json={"choice": 1}).json()
    assert picked["suggestions"][0]["after"] == s["options"][1]["text"] and not picked["suggestions"][0]["applied"]
    back = jobs.post(f"/v1/linkedin/suggestions/{s['id']}/unapply", headers=h).json()
    assert back["profile"]["headline"] == "Backend Engineer at PayNest" and back["scores"]["now"] == back["scores"][
        "read"]

    assert jobs.patch(f"/v1/linkedin/suggestions/{s['id']}", headers=h, json={"after": "x" * 221}).status_code == 422
    edited = jobs.patch(f"/v1/linkedin/suggestions/{s['id']}", headers=h,
                        json={"after": "Backend Engineer | Go, Kafka | Payouts at [X] scale"}).json()
    assert edited["suggestions"][0]["options"][1]["text"].endswith("[X] scale")
    assert edited["suggestions"][0]["placeholders"] == 1
    done = jobs.patch(f"/v1/linkedin/suggestions/{s['id']}", headers=h, json={"done": True}).json()
    assert done["progress"] == {"done": 1, "total": 1}
    assert jobs.get("/v1/linkedin", headers=h).json()["suggestions"][0]["done"]  # kept with the profile

    # The free ones, and a checklist that ticks itself done.
    otw = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "open_to_work"}).json()
    sid = otw["suggestion_id"]
    assert not otw["suggestions"][0]["applies"]
    assert jobs.post(f"/v1/linkedin/suggestions/{sid}/apply", headers=h).status_code == 422
    ticked = jobs.patch(f"/v1/linkedin/suggestions/{sid}", headers=h, json={"checked": list(range(6))}).json()
    assert ticked["suggestions"][0]["done"] and ticked["progress"] == {"done": 2, "total": 2}
    assert jobs.patch(f"/v1/linkedin/suggestions/{sid}", headers=h, json={"checked": [9]}).status_code == 422
    photo = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "photo"}).json()
    with_photo = jobs.post(f"/v1/linkedin/suggestions/{photo['suggestion_id']}/apply", headers=h).json()
    assert with_photo["profile"]["photo"] and next(
        x for x in with_photo["audit"]["sections"] if x["id"] == "photo")["known"]

    # Someone else's suggestion or resume: not found, and nothing changes.
    other = _register(jobs)
    _verify(jobs, other)
    jobs.post("/v1/linkedin/read-file", headers=other, files={"file": ("p.txt", PDF_TEXT.encode(), "text/plain")})
    for call in (lambda: jobs.post(f"/v1/linkedin/suggestions/{s['id']}/apply", headers=other),
                 lambda: jobs.patch(f"/v1/linkedin/suggestions/{s['id']}", headers=other, json={"done": False}),
                 lambda: jobs.delete(f"/v1/linkedin/suggestions/{s['id']}", headers=other)):
        assert call().status_code == 404
    mine = _resume_id(jobs, h)
    assert jobs.post("/v1/linkedin/fix", headers=other,
                     json={"part": "about", "source": "resume", "resume_id": mine}).status_code == 404
    assert jobs.get("/v1/linkedin", headers=h).json()["suggestions"][-1]["done"]

    gone = jobs.delete(f"/v1/linkedin/suggestions/{s['id']}", headers=h).json()
    assert all(x["id"] != s["id"] for x in gone["suggestions"])


def test_each_part_through_the_api(jobs: TestClient) -> None:  # noqa: F811
    h = _setup(jobs)
    rid = _resume_id(jobs, h)
    for body in ({"part": "about", "source": "both", "resume_id": rid}, {"part": "experience", "role": 0},
                 {"part": "experience", "role": 1, "source": "resume", "resume_id": rid}, {"part": "skills"},
                 {"part": "url"}, {"part": "featured", "source": "both", "resume_id": rid},
                 {"part": "recommendation", "role": 1, "recipient": "Priya Nair"}):
        r = jobs.post("/v1/linkedin/fix", headers=h, json=body)
        assert r.status_code == 200, (body, r.text)
        s = next(x for x in r.json()["suggestions"] if x["id"] == r.json()["suggestion_id"])
        assert s["part"] == body["part"] and s["source"] == body.get("source", "profile")
        assert not s["limit"] or len(s["after"]) <= s["limit"]
    out = jobs.get("/v1/linkedin", headers=h).json()
    roles = [x for x in out["suggestions"] if x["part"] == "experience"]
    assert len(roles) == 2 and {x["label"] for x in roles} == {"Backend Engineer at PayNest",
                                                                 "Software Engineer at Acme"}
    assert any(x["placeholders"] for x in roles)
    rec = next(x for x in out["suggestions"] if x["part"] == "recommendation")
    assert rec["after"].startswith("Hi Priya,") and not rec["applies"]
    # Things that can't be done say so before anything is spent.
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "experience"}).status_code == 422
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "about", "source": "resume"}).status_code == 422
    unknown = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "experience", "role": 0, "source": "resume",
                                                             "resume_id": "nope"})
    assert unknown.status_code == 404
    # "Rewrite everything" from the resume: headline, About and skills as suggestions.
    whole = jobs.post("/v1/linkedin/rewrite", headers=h, json={"resume_id": rid})
    assert whole.status_code == 200, whole.text
    parts = [x["part"] for x in whole.json()["suggestions"]]
    assert {"headline", "about", "skills"} <= set(parts) and len(parts) == len(set(
        (x["part"], x["role_key"]) for x in whole.json()["suggestions"]))
    # Every applicable suggestion applied: the projected score.
    for x in jobs.get("/v1/linkedin", headers=h).json()["suggestions"]:
        if x["applies"]:
            assert jobs.post(f"/v1/linkedin/suggestions/{x['id']}/apply", headers=h).status_code == 200
    final = jobs.get("/v1/linkedin", headers=h).json()
    assert final["scores"]["now"] == final["scores"]["projected"] > final["scores"]["read"]


def test_a_new_read_keeps_the_suggestions_and_ticks_what_linkedin_now_has(jobs: TestClient) -> None:  # noqa: F811
    h = _setup(jobs)
    fix = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).json()
    new_headline = fix["suggestions"][0]["options"][0]["text"]
    jobs.post("/v1/linkedin/fix", headers=h, json={"part": "experience", "role": 1})
    pasted = PDF_TEXT.replace("Backend Engineer at PayNest", new_headline).replace(
        "Acme\nSoftware Engineer\nJune 2018 - December 2020 (2 years 7 months)\n", "")
    r = jobs.post("/v1/linkedin/read", headers=h, json={"text": pasted})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [x["part"] for x in out["suggestions"]] == ["headline"]  # the Acme role is gone, and its suggestion
    assert out["suggestions"][0]["done"] and out["suggestions"][0]["before"] == new_headline
    assert out["profile"]["headline"] == out["read"]["headline"] == new_headline


@pytest.fixture
def enforce(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(allowance, "ENFORCE_IN_TESTS", True)


def _wallet(jobs: TestClient, h: dict[str, str]) -> tuple[int, int]:  # noqa: F811
    a = jobs.get("/v1/resumes/allowance", headers=h).json()
    return a["credits_left"], a["fixes_left"]


def test_a_fix_costs_a_fraction_once_and_nothing_when_it_fails(jobs: TestClient, enforce: None,  # noqa: F811
                                                               monkeypatch: pytest.MonkeyPatch) -> None:
    h = _setup(jobs)
    uid = _uid(jobs, h)

    async def grant() -> None:
        async with sessionmaker()() as db:
            for e in (await db.scalars(select(User).where(User.id == uid))).all():
                credits.add(db, e.id, "resume", 1 - await credits.resume_balance(db, e.id), "test")
            await db.commit()

    run(jobs, grant)
    assert _wallet(jobs, h) == (1, 0)

    class Down(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    with monkeypatch.context() as m:  # the AI is down: nothing spent
        m.setattr(resume_routes, "get_llm_provider", lambda: Down())
        assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).status_code == 503
    assert _wallet(jobs, h) == (1, 0)
    with monkeypatch.context() as m:  # an answer that fails the checks: nothing spent either
        m.setattr(resume_routes, "get_llm_provider", lambda: MockLLMProvider(script=["not json at all"]))
        bad = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "about"})
        assert bad.status_code == 502 and "nothing was spent" in bad.json()["detail"]
    assert _wallet(jobs, h) == (1, 0)
    assert jobs.get("/v1/linkedin", headers=h).json()["suggestions"] == []

    per = 5
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).status_code == 200
    assert _wallet(jobs, h) == (0, per - 1)  # one credit pays for this fix and the next four
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "skills"}).status_code == 200
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "url"}).status_code == 200
    assert _wallet(jobs, h) == (0, per - 1)  # the free ones are free
    for _ in range(per - 1):
        assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "about"}).status_code == 200
    assert _wallet(jobs, h) == (0, 0)
    out = jobs.post("/v1/linkedin/fix", headers=h, json={"part": "featured"})
    assert out.status_code == 402 and out.json()["detail"]["code"] == "upgrade_required"
    # A whole rewrite needs a whole credit.
    rid = _resume_id(jobs, h)
    assert jobs.post("/v1/linkedin/rewrite", headers=h, json={"resume_id": rid}).status_code == 402


def test_fixes_need_a_verified_email_and_a_read_profile(jobs: TestClient,  # noqa: F811
                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    _register(jobs)
    h = _register(jobs)
    monkeypatch.setattr(get_settings(), "email_verification", "required")
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).status_code == 403
    _verify(jobs, h)
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).status_code == 404
    assert jobs.post("/v1/linkedin/suggestions/abc/apply", headers=h).status_code == 404


def test_an_old_row_without_suggestions_still_reads(jobs: TestClient) -> None:  # noqa: F811
    h = _setup(jobs)
    uid = _uid(jobs, h)

    async def strip() -> None:
        from orbit_api.models import LinkedInProfileRow

        async with sessionmaker()() as db:
            row = await db.get(LinkedInProfileRow, uid)
            assert row is not None
            row.data = {k: v for k, v in row.data.items() if k != "orbit"}
            await db.commit()

    run(jobs, strip)
    out = jobs.get("/v1/linkedin", headers=h).json()
    assert out["suggestions"] == [] and out["read"]["name"] == "Asha Rao"
    assert out["scores"]["read"] == out["scores"]["now"]
    assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "url"}).status_code == 200


def test_a_fix_never_writes_to_the_resume_it_reads(jobs: TestClient) -> None:  # noqa: F811
    h = _setup(jobs)
    rid = _resume_id(jobs, h)

    async def data() -> dict[str, Any]:
        async with sessionmaker()() as db:
            r = await db.get(Resume, rid)
            assert r is not None
            return dict(r.data)

    before = run(jobs, data)
    assert jobs.post("/v1/linkedin/fix", headers=h,
                     json={"part": "about", "source": "resume", "resume_id": rid}).status_code == 200
    assert run(jobs, data) == before


def test_a_new_version_never_drags_the_projection_down_and_the_rewrite_adds_an_option() -> None:
    read = _profile()
    good = fixes.headline_suggestion(_src(), [sug.Option(label="A", text="Backend Engineer | Go, Kafka, PostgreSQL")])
    state = sug.put(sug.State(read=read), good)
    copy = sug.apply(read, good)
    # Before is LinkedIn's text, not Orbit's copy with something applied.
    about = fixes.about_suggestion(_src(copy.model_copy(update={"about": "Applied text"})), "x" * 300)
    assert sug.put(state, about).suggestions[0].before == read.about
    # A worse headline written later: the projection keeps the better one already applied.
    worse = fixes.headline_suggestion(_src(), [sug.Option(label="B", text="Engineer")])
    later = sug.put(state, worse)

    def score(p: Profile) -> int:
        return audit(p, "Backend Engineer", KW).score

    assert score(sug.projected(copy, later.suggestions, score)) >= score(copy)
    assert score(sug.projected(copy, later.suggestions)) < score(copy)  # applying it blindly would lower it
    # The rewrite's headline joins the options there, keeping the pick.
    merged = sug.put(later, fixes.headline_suggestion(_src(), [sug.Option(label="From your resume", text="Data")]),
                     add_options=True)
    head = merged.suggestions[0]
    assert [o.label for o in head.options] == ["B", "From your resume"] and head.id == worse.id


def test_free_fixes_dont_use_up_the_ai_limit(jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    from orbit_api import ratelimit

    h = _setup(jobs)
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    ratelimit.reset_all()
    try:
        for _ in range(12):  # more than Resume AI's burst of 10: free, so not counted against it
            assert jobs.post("/v1/linkedin/fix", headers=h, json={"part": "url"}).status_code == 200
        codes = [jobs.post("/v1/linkedin/fix", headers=h, json={"part": "headline"}).status_code for _ in range(11)]
        assert codes[:10] == [200] * 10 and codes[10] == 429
    finally:
        ratelimit.reset_all()
