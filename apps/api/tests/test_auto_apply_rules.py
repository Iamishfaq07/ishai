"""Orbit Apply's rules as code (auto_apply/rules.py): each ATS's recorded public form read into questions, every
question answered only from approved data (or stopped), boards never automated, and tailoring that never adds a
skill the candidate lacks. No network, no database."""

import asyncio
import json
from typing import Any

import httpx
import pytest

from orbit_api.auto_apply import bank, forms, letters, resolve, rules, tailor
from orbit_api.auto_apply.forms import FormQuestion, Option
from orbit_api.auto_apply.pdf import resume_pdf
from orbit_api.auto_apply.planner import salary_top
from orbit_api.auto_apply.setup import Facts, WorkAuth, in_quiet_hours
from orbit_api.providers.llm.base import LLMRequest, LLMResponse, Usage
from orbit_api.resumes.schema import ResumeData
from tests.autoapply_helpers import ASHBY_ID, LEVER_ID, fixture_json, form_transport, lever_page, resume

FACTS = Facts(first_name="Asha", last_name="Rao", email="asha@example.com", phone="+91 98765 43210",
              city="Bengaluru", country="IN", linkedin="https://linkedin.com/in/asha", years_experience=5,
              notice_period_days=30, willing_to_relocate=False,
              work_auth=[WorkAuth(country="US", authorized=False, needs_sponsorship=True),
                         WorkAuth(country="IN", authorized=True, needs_sponsorship=False)])


def ctx(**kw: Any) -> bank.Context:
    base: dict[str, Any] = dict(facts=FACTS, resume=resume(), bank={}, company="Anthropic",
                                company_key="anthropic", title="Account Executive", job_country="US", job_cities=[],
                                direct=True, generated={"why_company": "Because of the work.",
                                                        "cover_letter": "Dear team, ..."})
    base.update(kw)
    return bank.Context(**base)


def answers(questions: list[FormQuestion], c: bank.Context) -> tuple[dict[str, bank.Answer], dict[str, bank.Missing]]:
    got: dict[str, bank.Answer] = {}
    missing: dict[str, bank.Missing] = {}
    for q in questions:
        a = bank.answer(q, c)
        if isinstance(a, bank.Answer):
            got[q.label] = a
        elif isinstance(a, bank.Missing):
            missing[q.label] = a
    return got, missing


# ---- reading each ATS's form -------------------------------------------------------------------------------------


def test_greenhouse_questions_compliance_and_standard_fields() -> None:
    qs = forms.greenhouse_form(fixture_json("greenhouse_job_questions.json"))
    by = {q.label: q for q in qs}
    assert by["First Name"].standard == "first_name" and by["First Name"].required
    assert by["Resume/CV"].kind == "file" and by["Resume/CV"].standard == "resume"
    assert by["LinkedIn Profile"].standard == "linkedin" and not by["LinkedIn Profile"].required
    arb = by["Agreement to Arbitrate"]
    assert arb.kind == "select" and arb.required and arb.id.startswith("question_")
    assert [q.section for q in qs if q.label in ("Gender", "Race", "VeteranStatus")] == ["eeo"] * 3
    assert by["Why Anthropic?"].kind == "textarea" and "200-400 words" in by["Why Anthropic?"].description


def test_a_choice_that_names_the_current_employer_is_not_the_current_company_field() -> None:
    # GitLab asks "Are you subject to any employment agreements ... with your current employer?" (Yes/No): answering it
    # with the candidate's company name would be wrong. The ids are the page's own (question_<n>), as the extension
    # reads them from the recorded page (tools/e2e/ats-fixtures/greenhouse-gitlab.html).
    from pathlib import Path

    data = json.loads((Path(__file__).resolve().parents[3] / "tools" / "e2e" / "apply-integrated"
                       / "greenhouse-gitlab.json").read_text("utf8"))
    by = {q.id: q for q in forms.greenhouse_form(data)}
    agreements = by["question_38624170002"]
    assert agreements.kind == "select" and agreements.standard is None
    assert by["question_38624168002"].standard == "linkedin"
    assert {"gender", "hispanic_ethnicity", "veteran_status"} <= {i for i, q in by.items() if q.section == "eeo"}


def test_lever_standard_fields_custom_cards_and_links() -> None:
    qs = forms.lever_form(lever_page())
    by = {q.label: q for q in qs}
    assert by["Full name"].required and by["Full name"].standard == "full_name"
    assert by["Current company"].required and by["Current company"].standard == "current_company"
    assert by["Current location"].required is False
    assert by["LinkedIn"].kind == "url" and by["LinkedIn"].standard == "linkedin"
    notice = by["Notice Period (In days)"]
    assert notice.required and notice.id.startswith("cards[") and notice.id.endswith("][field6]")
    heard = by["How did you get to know about this role?"]
    assert heard.kind == "select" and len(heard.options) >= 3


def test_ashby_system_fields_custom_fields_and_survey() -> None:
    qs = forms.ashby_form(fixture_json("ashby_job_posting.json"))
    by = {q.label: q for q in qs}
    assert by["Full Name"].standard == "full_name" and by["Resume"].standard == "resume"
    assert by["Phone"].standard == "phone" and by["Location"].standard == "location"
    sponsor = next(q for q in qs if q.label.startswith("Will you now or in the future require Notion"))
    assert sponsor.kind == "boolean" and sponsor.required
    assert {q.label for q in qs if q.section == "eeo"} == {"Gender", "Race", "Veteran Status"}
    with pytest.raises(forms.FormError):
        forms.ashby_form({"data": {"jobPosting": None}})


def test_forms_are_fetched_only_from_the_ats_hosts() -> None:
    calls: list[str] = []

    async def go() -> tuple[int, int, int]:
        async with forms.FormClient(form_transport(calls)) as c:
            gh = await forms.fetch_form(c, "greenhouse", "anthropic", "111")
            lv = await forms.fetch_form(c, "lever", "meesho", LEVER_ID)
            ab = await forms.fetch_form(c, "ashby", "sarvam", ASHBY_ID)
            with pytest.raises(forms.FormError):
                await c.get_json("https://evil.example.com/steal")
            with pytest.raises(forms.FormError):
                await forms.fetch_form(c, "greenhouse", "anthropic", "404")
            return len(gh), len(lv), len(ab)

    sizes = asyncio.run(go())
    assert all(n >= 5 for n in sizes)
    assert calls[0] == "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/111?questions=true"
    assert calls[1] == f"https://jobs.lever.co/meesho/{LEVER_ID}/apply"
    assert calls[2].startswith("https://jobs.ashbyhq.com/api/non-user-graphql")
    assert not any("evil" in c for c in calls)
    assert [q.standard for q in forms.standard_form("greenhouse")][:2] == ["first_name", "last_name"]


# ---- answering: truthful only ------------------------------------------------------------------------------------


def test_greenhouse_answers_come_only_from_approved_data() -> None:
    got, missing = answers(forms.greenhouse_form(fixture_json("greenhouse_job_questions.json")), ctx())
    assert got["First Name"].value == "Asha" and got["Email"].source == "profile"
    # The job is in the US, where the candidate said they need sponsorship.
    sponsor = next(a for label, a in got.items() if "sponsorship" in label)
    assert sponsor.value == "Yes" and sponsor.source == "profile"
    assert got["Why Anthropic?"].source == "generated"
    assert got["Additional Information"].value == "Dear team, ..."
    assert got["VeteranStatus"].value == "I don't wish to answer"
    # Legal attestations and what only the candidate knows stop the packet.
    assert missing["Agreement to Arbitrate"].legal and missing["AI Policy for Application"].legal
    assert missing["Agreement to Arbitrate"].bank_key == "arbitration@anthropic"
    assert "Have you ever interviewed at Anthropic before?" in missing
    assert any("experience selling" in label for label in missing)
    assert any("4 days/week" in label for label in missing)
    # Not located in SF/NYC and not open to relocating: answered "No", truthfully.
    assert got["Are you currently located in SF/NYC or open to relocation, if not?"].value == "No"


def test_salary_history_notice_and_years_are_never_invented() -> None:
    got, missing = answers(forms.lever_form(lever_page()), ctx(company="Meesho", company_key="meesho",
                                                               job_country="IN"))
    assert "Current Compensation (Yearly)" in missing and "Expected Compensation (Yearly)" in missing
    assert got["Notice Period (In days)"].value == "30" and got["Total Years of experience"].value == "5"
    assert got["Are you based out of Bangalore ?"].value == "Yes"
    assert got["Are you willing to relocate to Bangalore?"].value == "No"
    gender = next(a for label, a in got.items() if "gender" in label.lower())
    assert gender.value == "Prefer not to disclose"
    assert "Current company" in missing  # a required fact the candidate didn't give
    # With the candidate's own answers, they're used (and only theirs).
    facts = FACTS.model_copy(update={"current_salary": "18 LPA", "expected_salary": "25 LPA",
                                     "current_company": "PayNest"})
    got, missing = answers(forms.lever_form(lever_page()), ctx(facts=facts, company="Meesho", job_country="IN"))
    assert got["Current Compensation (Yearly)"].value == "18 LPA" and "Current company" not in missing
    # Years with one skill are the candidate's to say.
    q = FormQuestion(id="q", label="How many years of experience do you have with Kubernetes?", kind="number",
                     required=True)
    assert isinstance(bank.answer(q, ctx()), bank.Missing)


def test_work_authorisation_is_per_country_and_never_assumed() -> None:
    q = FormQuestion(id="q", label="Are you legally authorized to work in Germany?", kind="select", required=True,
                     options=[Option(label="Yes", value="1"), Option(label="No", value="0")])
    a = bank.answer(q, ctx())
    assert isinstance(a, bank.Missing) and a.legal  # nothing said about Germany
    q2 = q.model_copy(update={"label": "Are you legally authorized to work in the United States?"})
    a2 = bank.answer(q2, ctx())
    assert isinstance(a2, bank.Answer) and a2.value == "No"
    # A bank answer never stands in for a legal one the facts don't support... unless the candidate set it.
    legal = FormQuestion(id="c", label="I certify that the information I have provided is true and complete.",
                         kind="checkbox", required=True)
    assert isinstance(bank.answer(legal, ctx()), bank.Missing)
    assert isinstance(bank.answer(legal, ctx(bank={"certify_true": "Yes"})), bank.Answer)


def test_self_identification_declines_and_stops_when_it_cant() -> None:
    q = FormQuestion(id="g", label="Gender", kind="select", required=True, section="eeo",
                     options=[Option(label="Male", value="m"), Option(label="Female", value="f")])
    a = bank.answer(q, ctx())
    assert isinstance(a, bank.Missing)  # required, and no way to decline
    q.options.append(Option(label="I prefer not to say", value="x"))
    a = bank.answer(q, ctx())
    assert isinstance(a, bank.Answer) and a.value == "I prefer not to say"
    a = bank.answer(q, ctx(bank={"eeo_gender": "Female"}))
    assert isinstance(a, bank.Answer) and a.value == "Female" and a.source == "bank"


def test_an_agreement_answered_for_one_company_isnt_used_for_another() -> None:
    q = next(q for q in forms.greenhouse_form(fixture_json("greenhouse_job_questions.json"))
             if q.label == "Agreement to Arbitrate")
    agreed = {"arbitration@anthropic": q.options[0].label}
    assert isinstance(bank.answer(q, ctx(bank=agreed)), bank.Answer)
    assert isinstance(bank.answer(q, ctx(bank=agreed, company="Acme", company_key="acme")), bank.Missing)


def test_ashby_answers() -> None:
    got, missing = answers(forms.ashby_form(fixture_json("ashby_job_posting.json")),
                           ctx(company="Notion", company_key="notion"))
    assert got["Full Name"].value == "Asha Rao" and got["Location"].value == "Bengaluru, IN"
    sponsor = next(a for label, a in got.items() if "sponsor" in label)
    assert sponsor.value == "Yes" and sponsor.kind == "boolean"
    heard = next(a for label, a in got.items() if label.startswith("How did you hear"))
    assert heard.value == ["Notion Website"] and heard.source == "generated"
    assert any(label.startswith("We work from our offices") for label in missing)
    assert got["Gender"].value == "Decline to self-identify"


# ---- where to apply ----------------------------------------------------------------------------------------------


def test_boards_are_handed_off_and_ats_links_resolved() -> None:
    gh = resolve.from_url("https://job-boards.greenhouse.io/acme/jobs/4970739101?gh_src=x")
    assert gh is not None and (gh.ats, gh.tenant, gh.job_ref) == ("greenhouse", "acme", "4970739101")
    emb = resolve.from_url("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")
    assert emb is not None and (emb.tenant, emb.job_ref) == ("acme", "123")
    lv = resolve.from_url(f"https://jobs.lever.co/meesho/{LEVER_ID}")
    assert lv is not None and lv.ats == "lever" and lv.apply_url.endswith("/apply")
    ab = resolve.from_url(f"https://jobs.ashbyhq.com/sarvam/{ASHBY_ID}")
    assert ab is not None and ab.ats == "ashby" and ab.apply_url.endswith("/application")
    for url, site in (("https://www.linkedin.com/jobs/view/1", "LinkedIn"), ("https://in.indeed.com/viewjob?jk=1",
                                                                            "Indeed"),
                      ("https://www.naukri.com/job-listings-1", "Naukri"), ("https://www.glassdoor.co.in/job/1",
                                                                             "Glassdoor")):
        t = resolve.from_url(url)
        assert t is not None and t.ats == "board" and t.site == site and not t.automatic
    other = resolve.from_url("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1")
    assert other is not None and other.ats == "other" and not other.automatic


# ---- tailoring never adds what the candidate lacks ---------------------------------------------------------------

JOB = ("Backend Engineer at Acme. You'll build Python services on PostgreSQL and AWS, design REST APIs, and run "
       "them on Kubernetes with Kafka and Terraform. Mentoring is a plus.")


def _gen(text: str) -> Any:
    async def generate(req: LLMRequest) -> LLMResponse:
        return LLMResponse(text=text, model="mock", usage=Usage(), provider="mock")
    return generate


def test_reordering_puts_what_the_job_asks_first_and_changes_nothing_else() -> None:
    master = resume()
    out, changes = tailor.reorder(master, JOB)
    bullets = out.experience[0].bullets
    assert sorted(bullets) == sorted(master.experience[0].bullets)
    assert bullets[0].startswith("Built Python services on PostgreSQL")  # the job's words first
    assert out.skills[0].items[0] in ("Python", "PostgreSQL", "AWS")
    assert sorted(out.skills[0].items) == sorted(master.skills[0].items)
    assert {c.kind for c in changes} == {"reorder"}
    assert tailor.truth_violations(master, out, JOB) == []


@pytest.mark.parametrize("after", [
    "Built Python services on PostgreSQL and Kubernetes handling 2M payments a day",  # a tool the resume lacks
    "Built Python services on PostgreSQL handling 9M payments a day",  # a figure the resume never gave
    "Built Python and Kafka services on PostgreSQL handling 2M payments a day",
])
def test_an_ai_rewrite_that_adds_a_skill_or_a_figure_is_never_kept(after: str) -> None:
    master = resume()
    role = master.experience[0]
    path = f"experience.{role.id}.bullets.1"
    reply = json.dumps({"suggestions": [{"path": path, "after": after, "reason": "Matches the job"},
                                        {"path": "basics.summary", "after": "Backend engineer with Terraform and "
                                         "Kubernetes experience building Python services.", "reason": "x"}]})
    out = asyncio.run(tailor.tailor(master, JOB, _gen(reply)))
    text = json.dumps(out.data.model_dump())
    for skill in ("Kubernetes", "Kafka", "Terraform", "9M"):
        assert skill not in text
    assert sorted(i for g in out.data.skills for i in g.items) == sorted(i for g in master.skills for i in g.items)
    assert tailor.truth_violations(master, out.data, JOB) == []


def test_a_truthful_ai_rewrite_is_kept_and_shown_in_the_diff() -> None:
    master = resume()
    role = master.experience[0]
    reply = json.dumps({"suggestions": [{"path": f"experience.{role.id}.bullets.2",
                                         "after": "Designed the REST APIs that 40 partner banks use every day",
                                         "reason": "Plainer"}]})
    out = asyncio.run(tailor.tailor(master, JOB, _gen(reply)))
    assert out.ai_used
    change = next(c for c in out.changes if c.kind == "rephrase")
    assert change.before == "Designed REST APIs used by 40 partner banks"
    assert "Designed the REST APIs that 40 partner banks use every day" in out.data.experience[0].bullets


def test_truth_violations_catch_any_added_skill_or_role() -> None:
    master = resume()
    worse = master.model_copy(deep=True)
    worse.skills[0].items.append("Kubernetes")
    assert "the skills changed" in tailor.truth_violations(master, worse, JOB)
    worse = master.model_copy(deep=True)
    worse.experience[0].title = "Staff Engineer"
    assert "roles, schools or dates changed" in tailor.truth_violations(master, worse, JOB)


def test_cover_letters_from_the_ai_are_checked_and_carry_the_ai_line() -> None:
    master = resume()
    placeholder = "Dear team,\n\n" + "I cut costs by [a number] in my last role. " * 8
    letter, by_ai = asyncio.run(letters.cover_letter(master, FACTS, "Acme", "Backend Engineer", JOB,
                                                     _gen(placeholder), ai_line=True))
    assert not by_ai and "[a number]" not in letter and letter.endswith(rules.AI_LINE)
    assert "Asha Rao" in letter and "Backend Engineer" in letter
    claim = ("Dear Hiring Manager,\n\nI build Python services on PostgreSQL for payments at PayNest. I have run "
             "Kubernetes clusters for years. I design REST APIs used by partner banks, and mentor engineers.\n\n"
             "I'd welcome the chance to talk about the role and the team.\n\nSincerely,\nAsha Rao")
    letter, by_ai = asyncio.run(letters.cover_letter(master, FACTS, "Acme", "Backend Engineer", JOB, _gen(claim),
                                                     ai_line=False))
    assert by_ai and "Kubernetes" not in letter and not letter.endswith(rules.AI_LINE)
    why, _ = asyncio.run(letters.why_company(master, FACTS, "Acme", "Backend Engineer", JOB, None))
    assert "Acme" in why and "Kubernetes" not in why


def test_the_resume_pdf_is_text() -> None:
    pdf = resume_pdf(resume())
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert b"(Asha Rao)" in pdf and b"PostgreSQL" in pdf
    long = resume().model_copy(deep=True)
    long.experience[0].bullets = [f"Bullet {i} " + "word " * 30 for i in range(12)]
    long.experience = long.experience * 5
    assert resume_pdf(ResumeData.model_validate(long.model_dump())).count(b"/Type /Page ") >= 2


def test_salary_lines_and_quiet_hours() -> None:
    assert salary_top("₹18L - ₹30L") == 3_000_000
    assert salary_top("$150,000 - $190,000") == 190_000
    assert salary_top("$60 - $80 hourly") is None and salary_top(None) is None
    assert salary_top("₹1,50,000 per month") == 1_800_000
    assert in_quiet_hours(22 * 60, 7 * 60, 23 * 60) and in_quiet_hours(22 * 60, 7 * 60, 60)
    assert not in_quiet_hours(22 * 60, 7 * 60, 12 * 60) and not in_quiet_hours(None, None, 0)


def test_the_caps_are_hard_numbers() -> None:
    assert rules.MAX_DAILY_LIMIT == 25 and rules.PER_COMPANY_LIMIT == 2 and rules.MAX_FRESH_DAYS == 30
    assert rules.TENANT_GAP_S == (180, 480) and rules.MIN_GAP.total_seconds() == 60
    assert rules.LEASE.total_seconds() == 15 * 60 and rules.MAX_SCREENSHOT_BYTES == 1_500_000
    _ = httpx  # the transport type lives in tests.autoapply_helpers
