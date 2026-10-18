"""The job assistant (business_ai/job_fill.py, business/job_assist.py, DECISIONS D85): reading varied prompts (Indian
and global pay formats, freshers, remote Europe, hybrid, part-time, internships, Hindi), pay never invented,
knock-outs only from stated requirements, protected characteristics refused, refine changing only what it's asked,
the deterministic path when the model is down, and the route's permission, tenant and usage checks."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business import ai_port
from orbit_api.business_ai import CompanyContext, JobFields, JobFillRequest, fill_job
from orbit_api.business_ai import llm as ai
from orbit_api.business_ai.job_facts import parse_pay, read_facts
from orbit_api.business_ai.job_fill import FillQuestion, Knockout, screens_on_person
from orbit_api.business_ai.text import word_count
from orbit_api.models import BizMember
from orbit_api.providers.llm.base import LLMError
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, register, tag
from tests.test_business_ai import Scripted

CO = CompanyContext(name="Kirana Cart", about="Kirana Cart builds ordering software for neighbourhood grocery stores.",
                    country="IN")


@pytest.fixture
def use(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    def install(llm: Any) -> Any:
        monkeypatch.setattr(ai, "provider", lambda: llm)
        return llm
    return install


# ---- reading prompts (deterministic) ---------------------------------------------------------------------------

# prompt -> (title, locations, workplace, employment, experience, (min, max, currency, period) | None, countries)
PROMPTS: list[tuple[str, tuple[Any, ...]]] = [
    ("Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ yrs",
     ("Senior React Developer", ["Bengaluru, IN"], "hybrid", None, "senior", (1_800_000, 2_800_000, "INR", "year"),
      None)),
    ("Sales executive Mumbai, fresher OK",
     ("Sales Executive", ["Mumbai, IN"], None, None, "entry", None, None)),
    ("Remote backend engineer, Go, Europe time zones, $90–120k",
     ("Backend Engineer", [], "remote", None, None, (90_000, 120_000, "USD", "year"), "EU")),
    ("Part-time content writer, remote India, ₹25,000 per month",
     ("Content Writer", [], "remote", "part_time", None, (25_000, 25_000, "INR", "month"), ["IN"])),
    ("Marketing intern in Pune, stipend 15k/month, 3 months",
     ("Marketing Intern", ["Pune, IN"], None, "internship", "entry", (15_000, 15_000, "INR", "month"), None)),
    ("Data analyst Hyderabad 6-10 LPA 2-4 yrs SQL Excel Power BI a plus",
     ("Data Analyst", ["Hyderabad, IN"], None, None, "junior", (600_000, 1_000_000, "INR", "year"), None)),
    ("Customer support executive, Noida, onsite, Hindi and English speaking, 3.5 LPA",
     ("Customer Support Executive", ["Noida, IN"], "onsite", None, None, (350_000, 350_000, "INR", "year"), None)),
    ("बेंगलुरु में सेल्स एग्जीक्यूटिव चाहिए, 2 साल अनुभव, 25,000 प्रति माह",
     ("सेल्स एग्जीक्यूटिव", ["Bengaluru, IN"], None, None, "junior", (25_000, 25_000, "INR", "month"), None)),
    ("Lead product designer, Dubai, AED 25,000 a month, 8+ years, Figma",
     ("Lead Product Designer", ["Dubai, AE"], None, None, "lead", (25_000, 25_000, "AED", "month"), None)),
    ("Python developer, Gurgaon, up to 12 LPA, immediate joiners",
     ("Python Developer", ["Gurugram, IN"], None, None, None, (None, 1_200_000, "INR", "year"), None)),
    ("Full stack engineer remote anywhere USD 60-80k Node.js React",
     ("Full Stack Engineer", [], "remote", None, None, (60_000, 80_000, "USD", "year"), [])),
    ("Accountant Chennai 4 to 6 lakh Tally GST",
     ("Accountant", ["Chennai, IN"], None, None, None, (400_000, 600_000, "INR", "year"), None)),
    ("Engineering manager, Berlin, €95–120k, 10+ yrs",
     ("Engineering Manager", ["Berlin, DE"], None, None, "lead", (95_000, 120_000, "EUR", "year"), None)),
    ("Contract DevOps engineer, London, £60-70k, Kubernetes",
     ("DevOps Engineer", ["London, GB"], None, "contract", None, (60_000, 70_000, "GBP", "year"), None)),
    ("Delivery executive, Kolkata, ₹18000/month",
     ("Delivery Executive", ["Kolkata, IN"], None, None, None, (18_000, 18_000, "INR", "month"), None)),
    ("Senior Java developer Bangalore 1.2 Cr CTC, 12 years",
     ("Senior Java Developer", ["Bengaluru, IN"], None, None, "senior", (12_000_000, 12_000_000, "INR", "year"),
      None)),
    ("Freelance video editor, $40/hr, remote US only",
     ("Video Editor", [], "remote", "contract", None, (40, 40, "USD", "hour"), ["US"])),
    ("Temporary warehouse associate in Navi Mumbai for the festive season",
     ("Warehouse Associate", ["Navi Mumbai, IN"], None, "temporary", "junior", None, None)),
]


@pytest.mark.parametrize(("prompt", "expected"), PROMPTS, ids=[p[:28] for p, _ in PROMPTS])
def test_reads_the_common_ways_people_write_a_job(prompt: str, expected: tuple[Any, ...]) -> None:
    title, locations, workplace, employment, experience, pay, countries = expected
    f = read_facts(prompt)
    assert f.title == title
    assert f.locations == locations
    assert f.workplace == workplace and f.employment_type == employment and f.experience == experience
    got = (f.pay.min, f.pay.max, f.pay.currency, f.pay.period) if f.pay else None
    assert got == pay
    if countries == "EU":
        assert f.allowed_countries and {"DE", "GB", "NL"} <= set(f.allowed_countries)
    else:
        assert f.allowed_countries == countries


def test_pay_formats() -> None:
    def p(text: str) -> tuple[Any, ...] | None:
        r = parse_pay(text)
        return (r.min, r.max, r.currency, r.period) if r else None
    assert p("CTC 18 to 28 lakh") == (1_800_000, 2_800_000, "INR", "year")
    assert p("USD 90,000-120,000") == (90_000, 120_000, "USD", "year")
    assert p("18,00,000 - 28,00,000 INR per annum") == (1_800_000, 2_800_000, "INR", "year")
    assert p("4-6 लाख") == (400_000, 600_000, "INR", "year")
    assert p("starting from $70k") == (70_000, None, "USD", "year")
    # Not pay: years, headcounts, durations, a day rate the form can't hold.
    assert p("5+ years, team of 12 people") is None
    assert p("3 months internship") is None
    assert p("£500 per day") is None


def test_age_and_gender_limits_are_detected_and_not_confused_with_pay_or_notice() -> None:
    for bad in ("male only", "below 30", "freshers under 25", "female candidates preferred", "age 22-28",
                "unmarried", "candidates below 30 years old"):
        assert screens_on_person(bad), bad
    for ok in ("up to 30 LPA", "notice period max 30 days", "under 25k a month", "5+ years of React",
               "team of 30 people", "Hindi speaking"):
        assert not screens_on_person(ok), ok


# ---- the model's answer and the server's checks -------------------------------------------------------------

BODY = ("You'll build the screens grocery store owners use every day to take orders, manage stock and talk to "
        "their customers, working with product and design colleagues on features from the first sketch to "
        "release. ")


def _answer(**over: Any) -> dict[str, Any]:
    md = ("## About the role\n" + BODY * 3 + "\n\n## What you'll do\n" + BODY * 3 + "\n\n## What you need\n- React\n"
          "- 5+ years of professional experience\n\n## About Kirana Cart\nKirana Cart builds ordering software for "
          "neighbourhood grocery stores.")
    base = {"title": "Senior React Developer", "department": "Engineering", "locations": ["Bangalore, India"],
            "workplace": "hybrid", "allowed_countries": [], "employment_type": "full_time", "experience": "senior",
            "salary": {"min": 1800000, "max": 2800000, "currency": "INR", "period": "year"}, "show_salary": True,
            "description_markdown": md, "must_haves": ["React", "5+ years of professional experience"],
            "nice_to_haves": ["TypeScript"],
            "questions": [
                {"text": "Are you authorised to work in India?", "kind": "yes_no", "knockout": {"equals": "yes"}},
                {"text": "How many years of React experience do you have?", "kind": "number",
                 "knockout": {"min": 5}}],
            "stages": None, "assumptions": ["Assumed full-time because you didn't say."]}
    return {**base, **over}


async def test_fill_takes_the_model_answer_through_the_checks(use) -> None:  # type: ignore[no-untyped-def]
    llm = use(Scripted(_answer()))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ years",
                                        company=CO))
    assert out.source == "ai" and len(llm.requests) == 1
    assert out.title == "Senior React Developer" and out.department == "Engineering"
    assert out.locations == ["Bengaluru, IN"] and out.workplace == "hybrid"
    assert (out.salary_min, out.salary_max, out.salary_currency, out.salary_period) == (
        1_800_000, 2_800_000, "INR", "year")
    assert out.must_haves == ["React", "5+ years of professional experience"]
    assert [q.knockout for q in out.questions] == [Knockout(equals="yes"), Knockout(min=5)]
    assert all(q.id for q in out.questions)
    assert {"title", "locations", "salary", "description", "questions"} <= set(out.changed_fields)
    assert any("full-time" in a for a in out.assumptions) and any("LPA" in a for a in out.assumptions)
    # The prompt is data inside the fence; the request type is the assistant's own.
    assert llm.requests[0].request_type == "business_fill"
    assert "<reference_data" in llm.requests[0].messages[-1].content


async def test_pay_is_never_invented(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(_answer()))  # the model "fills in" a salary nobody gave
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid, 5+ years", company=CO))
    assert out.salary_min is None and out.salary_max is None
    assert any("pay" in n.lower() for n in out.inclusive_language_notes)
    # A salary the recruiter did give is read by the server, whatever the model says.
    use(Scripted(_answer(salary={"min": 2_000_000, "max": 3_000_000, "currency": "INR", "period": "year"})))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru, 18-28 LPA", company=CO))
    assert (out.salary_min, out.salary_max) == (1_800_000, 2_800_000)
    # The model may read a format the reader doesn't know, if every figure is one the recruiter wrote.
    use(Scripted(_answer(salary={"min": 150_000, "max": 200_000, "currency": "INR", "period": "month"})))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru, monthly 1.5L to 2L",
                                        company=CO))
    assert (out.salary_min, out.salary_max, out.salary_period) == (150_000, 200_000, "month")


async def test_benefits_and_invented_figures_are_removed_from_the_description(use) -> None:  # type: ignore[no-untyped-def]
    md = _answer()["description_markdown"] + "\n\n## Benefits\n- Free lunch and a gym\n\nWe have 400 customers."
    use(Scripted(_answer(description_markdown=md)))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid", company=CO))
    assert "gym" not in out.description_markdown and "400" not in out.description_markdown


async def test_knockouts_only_from_stated_requirements(use) -> None:  # type: ignore[no-untyped-def]
    questions = [
        {"text": "How many years of React experience do you have?", "kind": "number", "knockout": {"min": 7}},
        {"text": "How many years of experience do you have in total?", "kind": "number", "knockout": {"max": 10}},
        {"text": "Do you have a computer science degree?", "kind": "yes_no", "knockout": {"equals": "yes"}},
        {"text": "This job is hybrid in Bengaluru. Can you work from there?", "kind": "yes_no",
         "knockout": {"equals": "yes"}},
        {"text": "What is your age?", "kind": "number", "knockout": None},
        {"text": "What is your current CTC?", "kind": "number", "knockout": None},
        {"text": "Are you married?", "kind": "yes_no", "knockout": {"equals": "no"}},
    ]
    use(Scripted(_answer(questions=questions)))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid, 5+ years", company=CO))
    by_text = {q.text: q.knockout for q in out.questions}
    assert by_text["How many years of React experience do you have?"] is None  # 7 was never stated
    assert by_text["How many years of experience do you have in total?"] is None  # never a maximum
    assert by_text["Do you have a computer science degree?"] is None  # not a stated requirement
    assert by_text["This job is hybrid in Bengaluru. Can you work from there?"] == Knockout(equals="yes")
    assert not any(t for t in by_text if "age" in t.lower() or "ctc" in t.lower() or "married" in t.lower())
    assert sum("personal characteristic" in n for n in out.inclusive_language_notes) >= 3


async def test_protected_characteristics_are_refused_before_anything_reads_them(use) -> None:  # type: ignore[no-untyped-def]
    llm = use(Scripted(_answer()))
    out = await fill_job(JobFillRequest(
        description="Sales executive Mumbai, male only, below 30, fresher OK", company=CO))
    sent = llm.requests[0].messages[-1].content
    assert "male only" not in sent and "below 30" not in sent and "fresher OK" in sent
    notes = " ".join(out.inclusive_language_notes)
    assert "'male only'" in notes and "'below 30'" in notes
    # The same without the model: still refused, and no question or requirement about it.
    out = await fill_job(JobFillRequest(description="Sales executive Mumbai, female candidates preferred",
                                        company=CO), use_model=False)
    assert "female" not in json.dumps(out.model_dump()).replace(out.inclusive_language_notes[0], "")


async def test_model_requirements_that_screen_on_a_person_are_dropped(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(_answer(must_haves=["React", "Male candidates only", "Age below 30"])))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru", company=CO))
    assert out.must_haves == ["React"]


async def test_an_invalid_answer_is_repaired_once(use) -> None:  # type: ignore[no-untyped-def]
    llm = use(Scripted(_answer(description_markdown="Too short."), _answer()))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid", company=CO))
    assert out.source == "ai" and len(llm.requests) == 2
    assert "words" in llm.requests[1].messages[-1].content  # the repair says what was wrong


async def test_model_down_fills_from_the_words_alone(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(LLMError("http_503", "down", retryable=True), LLMError("http_503", "down", retryable=True)))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ years",
                                        company=CO))
    assert out.source == "template"
    assert out.title == "Senior React Developer" and out.locations == ["Bengaluru, IN"]
    assert (out.salary_min, out.salary_max) == (1_800_000, 2_800_000) and out.experience == "senior"
    assert "5+ years of professional experience" in out.must_haves and "React" in out.must_haves
    assert len(out.description_markdown) >= 50 and "Kirana Cart" in out.description_markdown
    assert [q.knockout for q in out.questions][:3] == [Knockout(equals="yes"), Knockout(equals="yes"),
                                                       Knockout(min=5)]


async def test_pasted_old_post_is_used_and_checked(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(LLMError("http_503", "down", retryable=True), LLMError("http_503", "down", retryable=True)))
    old = "We need a rockstar ninja.\nYou will own our checkout flow.\nOnly male candidates below 30."
    out = await fill_job(JobFillRequest(description="Frontend developer, Pune", pasted=old, company=CO))
    assert "checkout flow" in out.description_markdown
    assert "rockstar" not in out.description_markdown.lower() and "male" not in out.description_markdown.lower()


async def test_hindi_prompt(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(LLMError("http_503", "down", retryable=True), LLMError("http_503", "down", retryable=True)))
    out = await fill_job(JobFillRequest(description="बेंगलुरु में सेल्स एग्जीक्यूटिव चाहिए, 2 साल अनुभव, 25,000 प्रति माह",
                                        company=CO))
    assert out.title == "सेल्स एग्जीक्यूटिव" and out.locations == ["Bengaluru, IN"] and out.experience == "junior"
    assert (out.salary_min, out.salary_period) == (25_000, "month")
    assert "भूमिका" in out.description_markdown


async def test_mock_model_runs_the_whole_path(use) -> None:  # type: ignore[no-untyped-def]
    use(MockLLMProvider())
    out = await fill_job(JobFillRequest(description="Remote backend engineer, Go, Europe time zones, $90–120k",
                                        company=CO))
    assert out.source == "ai" and out.workplace == "remote" and "DE" in out.allowed_countries
    assert (out.salary_min, out.salary_max, out.salary_currency) == (90_000, 120_000, "USD")
    assert word_count(out.description_markdown) >= 150
    again = await fill_job(JobFillRequest(instruction="add a notice period question", current=out, company=CO))
    assert again.changed_fields == ["questions"] and "notice" in again.questions[-1].text


# ---- refine -------------------------------------------------------------------------------------------------------


def _current() -> JobFields:
    return JobFields(title="Senior React Developer", department="Engineering", locations=["Bengaluru, IN"],
                     workplace="hybrid", experience="senior", salary_min=1_800_000, salary_max=2_800_000,
                     description_markdown="## About the role\n" + BODY * 6, must_haves=["React", "5+ years"],
                     questions=[FillQuestion(id="auth", text="Are you authorised to work in India?", kind="yes_no",
                                             knockout=Knockout(equals="yes"))])


async def test_refine_changes_only_what_it_is_asked(use) -> None:  # type: ignore[no-untyped-def]
    cur = _current()
    # The model returns the level change and, carelessly, an unchanged title: only the level counts as changed.
    llm = use(Scripted({"changes": {"experience": "mid", "title": "Senior React Developer",
                                    "must_haves": ["React", "3+ years"]}, "assumptions": []}))
    out = await fill_job(JobFillRequest(instruction="make it more junior, 3+ years", current=cur, company=CO))
    assert out.changed_fields == ["experience", "must_haves"]
    assert out.title == cur.title and out.salary_min == cur.salary_min and out.questions[0].id == "auth"
    assert "make it more junior" in llm.requests[0].messages[-1].content


async def test_refine_adds_a_question_keeping_ids(use) -> None:  # type: ignore[no-untyped-def]
    cur = _current()
    use(Scripted({"changes": {"questions": [
        {"id": "auth", "text": "Are you authorised to work in India?", "kind": "yes_no", "knockout": {"equals": "yes"}},
        {"text": "What is your notice period?", "kind": "choice", "choices": ["Immediately", "30 days", "60 days"],
         "knockout": {"any_of": ["Immediately"]}}]}, "assumptions": []}))
    out = await fill_job(JobFillRequest(instruction="add a question about notice period", current=cur, company=CO))
    assert out.changed_fields == ["questions"]
    assert out.questions[0].id == "auth" and out.questions[1].id and out.questions[1].id != "auth"
    assert out.questions[1].knockout is None  # nobody said they need an immediate start


async def test_refine_never_invents_pay(use) -> None:  # type: ignore[no-untyped-def]
    cur = _current().model_copy(update={"salary_min": None, "salary_max": None})
    use(Scripted({"changes": {"salary": {"min": 2_000_000, "max": 3_000_000, "currency": "INR", "period": "year"}},
                  "assumptions": []}))
    out = await fill_job(JobFillRequest(instruction="make it more attractive", current=cur, company=CO))
    assert out.salary_min is None and "salary" not in out.changed_fields
    use(Scripted({"changes": {"salary": {"min": 1, "max": 2, "currency": "INR", "period": "year"}},
                  "assumptions": []}))
    out = await fill_job(JobFillRequest(instruction="pay is 20-30 LPA", current=cur, company=CO))
    assert (out.salary_min, out.salary_max) == (2_000_000, 3_000_000) and out.changed_fields == ["salary"]


async def test_refine_that_asks_for_a_protected_characteristic_changes_nothing(use) -> None:  # type: ignore[no-untyped-def]
    llm = use(Scripted())
    out = await fill_job(JobFillRequest(instruction="only women, under 28", current=_current(), company=CO))
    assert out.changed_fields == [] and not llm.requests
    assert out.inclusive_language_notes


async def test_refine_without_the_model(use) -> None:  # type: ignore[no-untyped-def]
    use(Scripted(LLMError("http_503", "down", retryable=True), LLMError("http_503", "down", retryable=True)))
    cur = _current()
    out = await fill_job(JobFillRequest(instruction="add a notice period question", current=cur, company=CO))
    assert out.source == "template" and out.changed_fields == ["questions"]
    out = await fill_job(JobFillRequest(instruction="make it more junior", current=cur, company=CO))
    assert out.experience == "mid" and out.must_haves == ["React"]
    out = await fill_job(JobFillRequest(instruction="add Hindi requirement", current=cur, company=CO))
    assert "Fluent Hindi (spoken and written)" in out.must_haves
    assert set(out.changed_fields) == {"must_haves", "questions"}
    out = await fill_job(JobFillRequest(instruction="write it like a poem", current=cur, company=CO))
    assert out.changed_fields == [] and any("couldn't reach" in a for a in out.assumptions)


# ---- the route ----------------------------------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    gen = make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")
    c = next(gen)
    yield c
    gen.close()


def _assist(client: TestClient, h: dict[str, str], cid: str, **body: Any) -> Any:
    return client.post(f"/v1/business/companies/{cid}/jobs/assist", headers=auth(h), json=body)


def test_route_fills_the_editor_fields(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    r = _assist(client, owner, company["id"], prompt="Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ years")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "Senior React Developer" and d["locations"] == ["Bengaluru, IN"]
    assert (d["salary_min"], d["salary_max"], d["salary_currency"]) == (1_800_000, 2_800_000, "INR")
    assert d["description_html"].startswith("<h3>") and d["questions"][0]["knockout"] == {"equals": "yes"}
    assert d["source"] == "template" and d["stages"] is None  # the test suite's fake is the deterministic path
    assert "model" not in json.dumps(d).lower() and "deepseek" not in json.dumps(d).lower()
    # What it returns is a valid job: it saves as it is.
    job = {k: d[k] for k in ("title", "department", "locations", "workplace", "allowed_countries", "employment_type",
                             "experience", "salary_min", "salary_max", "salary_currency", "salary_period",
                             "show_salary", "description_html", "must_haves", "nice_to_haves", "questions")}
    s = client.post(f"/v1/business/companies/{company['id']}/jobs", headers=auth(owner), json=job)
    assert s.status_code == 201, s.text


def test_route_refine_keeps_the_description_html_when_it_is_not_changed(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    current = {"title": "Backend Engineer", "description_html": "<p>Our <strong>own</strong> words.</p>",
               "locations": ["Pune, IN"], "questions": [{"id": "q1", "text": "Do you know Python?",
                                                         "kind": "yes_no", "required": True}]}
    r = _assist(client, owner, company["id"], instruction="add a notice period question", current=current)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["changed_fields"] == ["questions"] and d["description_html"] == current["description_html"]
    assert d["questions"][0]["id"] == "q1" and len(d["questions"]) == 2


def test_route_permissions_and_tenancy(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    assert _assist(client, owner, cid, prompt="").status_code == 422
    outsider = register(client, f"out-{tag()}@example.com")
    assert _assist(client, outsider, cid, prompt="Sales executive Mumbai").status_code == 404
    for role in ("hiring_manager", "interviewer"):
        member = register(client, f"{role}-{tag()}@example.com")

        async def join(db: Any, uid: str = member["X-User-Id"], role: str = role) -> None:
            db.add(BizMember(company_id=cid, user_id=uid, role=role))

        db_call(client, join)
        r = _assist(client, member, cid, prompt="Sales executive Mumbai")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "biz_forbidden"
    recruiter = register(client, f"rec-{tag()}@example.com")

    async def join_recruiter(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=recruiter["X-User-Id"], role="recruiter"))

    db_call(client, join_recruiter)
    assert _assist(client, recruiter, cid, prompt="Sales executive Mumbai").status_code == 200


def test_route_records_usage_and_audit(client: TestClient) -> None:
    from orbit_api.models import BizAudit, ProviderRequest

    class Counting(ai_port.FakeBusinessAI):
        async def fill_job(self, request: JobFillRequest) -> Any:
            calls = ai_port._recording.get()
            assert calls is not None
            calls.append(ai_port.UsageRecord("mock", "mock-model", "business_fill", 900, 700, 0, 5, True))
            return await super().fill_job(request)

    owner, company, _ = new_company(client)
    ai_port.set_business_ai(Counting())
    try:
        assert _assist(client, owner, company["id"], prompt="Sales executive Mumbai").status_code == 200
    finally:
        ai_port.set_business_ai(None)

    async def rows(db: Any) -> tuple[list[ProviderRequest], list[BizAudit]]:
        usage = list((await db.scalars(select(ProviderRequest).where(
            ProviderRequest.company_id == company["id"]))).all())
        audits = list((await db.scalars(select(BizAudit).where(BizAudit.company_id == company["id"],
                                                               BizAudit.action == "job.ai_assist"))).all())
        return usage, audits

    usage, audits = db_call(client, rows)
    assert [u.request_type for u in usage] == ["business_fill"] and usage[0].output_tokens == 700
    assert len(audits) == 1 and audits[0].detail["refine"] is False


def test_route_through_the_real_module_with_the_mock_model(client: TestClient, use) -> None:  # type: ignore[no-untyped-def]
    import orbit_api.business_ai as real

    use(MockLLMProvider())
    owner, company, _ = new_company(client)
    ai_port.set_business_ai(ai_port.ModuleAI(real))
    try:
        r = _assist(client, owner, company["id"], prompt="Remote backend engineer, Go, Europe time zones, $90–120k")
    finally:
        ai_port.set_business_ai(None)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "ai" and d["workplace"] == "remote" and d["salary_currency"] == "USD"
    assert "<h3>" in d["description_html"]


async def test_live_eval_findings_are_cleaned(use) -> None:  # type: ignore[no-untyped-def]
    """What the live eval showed a model doing: a country as a place of work, logistics as must-haves, a language
    nobody asked for, and the same assumption twice."""
    use(Scripted(_answer(
        locations=["India", "Bengaluru, IN"], workplace="remote",
        must_haves=["React", "Right to work in India", "Ability to work from Bengaluru (hybrid)",
                    "Comfort speaking Marathi", "Immediate availability to join"],
        questions=[{"text": "Do you speak Kannada?", "kind": "yes_no", "knockout": None},
                   {"text": "Are you authorised to work in India?", "kind": "yes_no", "knockout": {"equals": "yes"}}],
        assumptions=["Assumed INR a year because you said LPA.", "Assumed the team ships weekly."])))
    out = await fill_job(JobFillRequest(description="Senior React developer, Bengaluru hybrid, 18-28 LPA", company=CO))
    assert out.locations == ["Bengaluru, IN"]
    assert out.must_haves == ["React"]
    assert [q.text for q in out.questions] == ["Are you authorised to work in India?"]
    assert sum("LPA" in a for a in out.assumptions) == 1 and "Assumed the team ships weekly." in out.assumptions
