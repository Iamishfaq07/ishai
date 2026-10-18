"""Orbit for Business, hiring (D82): jobs and their public pages (Google for Jobs JSON-LD while open, gone when
closed, the sitemap), applying signed out and in one click (consent recorded with its version, dedupe by email, the
confirmation email and status page), the candidate's tracker following the company's moves, candidate data never
reaching a company, background ranking with reasons (no protected attributes in, never an automatic rejection),
knock-out flags, rejection emails, scorecards, scheduling with an .ics, blind review, analytics, export, delete on
request, retention, the AI writer, the description sanitizer and the Indexing API."""

import csv
import io
import json
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business import ai_port, indexing, rules
from orbit_api.business.ai_port import QA, FakeBusinessAI, JobSpec, ParsedResume, Ranking
from orbit_api.business.retention import sweep
from orbit_api.models import BizApplication, BizAudit, BizJob, Document, Job, JobApplication, Resume
from tests.business_helpers import (
    GOOD_ANSWERS,
    applications,
    apply_signed_out,
    auth,
    db_call,
    grant,
    mail_to,
    make_client,
    new_company,
    new_job,
    register,
    tag,
    uid,
    wait_ranked,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    gen = make_client(monkeypatch, ORBIT_ADMIN_EMAIL=f"admin-{uuid.uuid4().hex[:8]}@example.com",
                      ORBIT_WEB_URL="https://orbitanswer.test")
    c = next(gen)
    yield c
    gen.close()


def _status_token(email: str) -> str:
    mail = [m for m in mail_to(email) if "/application/" in m.text][-1]
    return re.search(r"/application/([\w-]+)", mail.text).group(1)  # type: ignore[union-attr]


def _one(client: TestClient, h: dict[str, str], cid: str, jid: str) -> dict[str, Any]:
    [item] = applications(client, h, cid, jid)["items"]
    return item


def _orbit_resume(client: TestClient, h: dict[str, str], title: str = "My resume") -> str:
    data = {"basics": {"name": "Kiran Rao", "headline": "Backend engineer", "email": "kiran@example.com",
                       "phone": "+91 90000 11111", "location": "Pune"},
            "experience": [{"title": "Engineer", "company": "Rocketly", "start": "2019", "current": True,
                            "bullets": ["Built Python services on Postgres and Kubernetes"]}],
            "skills": [{"name": "Backend", "items": ["Python", "Postgres", "Kubernetes"]}]}

    async def go(db: Any) -> str:
        r = Resume(user_id=uid(h), title=title, data=data, design={})
        db.add(r)
        await db.flush()
        return str(r.id)

    return str(db_call(client, go))


# ---- the description, JSON-LD, public pages ------------------------------------------------------------------------


def test_the_description_is_sanitized() -> None:
    dirty = ('<p onclick="x()">Hi <b>there</b><script>steal()</script></p><a href="javascript:alert(1)">x</a>'
             '<a href="https://acme.com/about">about</a><img src=x onerror=alert(1)><style>p{}</style><h1>T</h1>')
    clean = rules.sanitize_html(dirty)
    assert "script" not in clean and "onclick" not in clean and "javascript" not in clean and "<img" not in clean
    assert "steal" not in clean and "p{}" not in clean
    assert "<p>Hi <strong>there</strong></p>" in clean
    assert '<a href="https://acme.com/about" rel="nofollow noopener" target="_blank">about</a>' in clean
    md = rules.markdown_to_html("Intro **bold**\n\n### What you'll do\n- Ship <x>\n- Learn\n\n1. One")
    assert md == ("<p>Intro <strong>bold</strong></p><h3>What you'll do</h3><ul><li>Ship &lt;x&gt;</li>"
                  "<li>Learn</li></ul><ol><li>One</li></ol>")


def test_knockout_rules() -> None:
    q = {"text": "Authorised?", "kind": "yes_no", "knockout": {"equals": "yes"}}
    assert rules.knockout_failure(q, "yes") is None and "answered no" in (rules.knockout_failure(q, "no") or "")
    n = {"text": "Years?", "kind": "number", "knockout": {"min": 3, "max": 10}}
    assert rules.knockout_failure(n, "5") is None and rules.knockout_failure(n, "2") and rules.knockout_failure(n, "11")
    c = {"text": "Shift?", "kind": "choice", "knockout": {"any_of": ["Day"]}}
    assert rules.knockout_failure(c, "Day") is None and rules.knockout_failure(c, "Night")
    assert rules.knockout_failure({"text": "Free text", "kind": "short_text"}, "anything") is None


def test_job_page_json_ld_while_open_and_none_when_closed(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    assert "<script" not in job["description_html"] and "<strong>APIs</strong>" in job["description_html"]
    page = client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}")
    assert page.status_code == 200 and "max-age" in page.headers["cache-control"]
    body = page.json()
    ld = body["json_ld"]
    assert ld["@type"] == "JobPosting" and ld["title"] == job["title"] and ld["directApply"] is True
    assert ld["description"] == job["description_html"] and ld["datePosted"] == job["published_at"][:10]
    assert ld["validThrough"] and ld["identifier"]["value"] == job["id"]
    assert ld["hiringOrganization"]["name"] == company["name"]
    assert ld["hiringOrganization"]["sameAs"].startswith("https://www.acme-")
    assert ld["jobLocation"][0]["address"] == {"@type": "PostalAddress", "addressLocality": "Bengaluru",
                                               "addressCountry": "IN", "addressRegion": "Karnataka"}
    assert ld["baseSalary"] == {"@type": "MonetaryAmount", "currency": "INR", "value": {
        "@type": "QuantitativeValue", "unitText": "YEAR", "minValue": 3000000, "maxValue": 4500000}}
    assert ld["employmentType"] == "FULL_TIME" and ld["url"] == body["url"]
    assert body["url"] == f"https://orbitanswer.test/company/{company['slug']}/jobs/{job['slug']}"
    assert body["notice"]["version"] == rules.NOTICE_VERSION and "a person" in body["notice"]["text"].lower()
    assert all("knockout" not in q for q in body["questions"])  # the rules stay with the company
    careers = client.get(f"/v1/public/business/companies/{company['slug']}").json()
    assert [j["id"] for j in careers["jobs"]] == [job["id"]] and careers["verified"] is True
    sitemap = client.get("/v1/public/business/sitemap").json()
    assert {"loc": body["url"], "lastmod": job["updated_at"][:10]} in sitemap
    # Closed: the page says so, with no markup, no questions, and it leaves the careers page and the sitemap.
    client.post(f"/v1/business/companies/{company['id']}/jobs/{job['id']}/close", headers=auth(owner))
    closed = client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}").json()
    assert closed["status"] == "closed" and closed["json_ld"] is None and closed["questions"] == []
    assert client.get(f"/v1/public/business/companies/{company['slug']}").json()["jobs"] == []
    assert body["url"] not in [e["loc"] for e in client.get("/v1/public/business/sitemap").json()]


def test_remote_job_json_ld_uses_telecommute_and_countries(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"], workplace="remote", locations=[], allowed_countries=["in", "AE"],
                  show_salary=False)
    ld = client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}").json()["json_ld"]
    assert ld["jobLocationType"] == "TELECOMMUTE"
    assert ld["applicantLocationRequirements"] == [{"@type": "Country", "name": "IN"},
                                                   {"@type": "Country", "name": "AE"}]
    assert "baseSalary" not in ld and "jobLocation" not in ld


def test_drafts_are_not_public(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"], publish=False)
    assert client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}").status_code == 404
    assert apply_signed_out(client, job["id"], f"x-{tag()}@example.com").status_code == 404


# ---- applying ------------------------------------------------------------------------------------------------------


def test_signed_out_apply_records_consent_and_dedupes(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    email = f"Priya-{tag()}@Example.com"
    assert apply_signed_out(client, job["id"], email, consent="false").status_code == 422
    stale = apply_signed_out(client, job["id"], email, notice_version="2020-01-01")
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "biz_notice_changed"
    missing = apply_signed_out(client, job["id"], email, answers=[{"question_id": "auth", "answer": "yes"}])
    assert missing.status_code == 422  # a required question unanswered
    txt = client.post(f"/v1/public/business/jobs/{job['id']}/apply", data={
        "name": "P", "email": email, "consent": "true", "notice_version": rules.NOTICE_VERSION,
        "answers": json.dumps(GOOD_ANSWERS)}, files={"file": ("r.txt", b"plain text", "text/plain")})
    assert txt.status_code == 422  # PDF or DOCX only
    ok = apply_signed_out(client, job["id"], email)
    assert ok.status_code == 200 and ok.json()["status"] == "applied"
    again = apply_signed_out(client, job["id"], email.upper())
    assert again.status_code == 200 and again.json()["status"] == "applied"  # never says the address applied
    item = _one(client, owner, company["id"], job["id"])
    assert item["email"] == email.lower() and item["email_confirmed"] is False and item["source"] == "careers"
    assert item["knockout_failed"] is False and item["via_orbit"] is False

    async def consent(db: Any) -> dict[str, Any]:
        app = await db.get(BizApplication, item["id"])
        return dict(app.consent)

    c = db_call(client, consent)
    assert c["notice_version"] == rules.NOTICE_VERSION and c["accepted_at"] and len(c["text_sha256"]) == 64
    mails = mail_to(email.lower())
    assert any("already applied" in m.subject for m in mails)
    received = next(m for m in mails if "received your application" in m.subject)
    assert received.footer and company["name"] in received.footer and "/application/" in received.text
    # The status page, from the email's link; opening it with confirm confirms the address.
    token = _status_token(email.lower())
    st = client.get(f"/v1/public/business/applications/{token}").json()
    assert st["stage_label"] == "Received" and st["job_title"] == job["title"] and st["email_confirmed"] is False
    assert client.post(f"/v1/public/business/applications/{token}/confirm").json()["email_confirmed"] is True
    assert client.get("/v1/public/business/applications/not-a-token").status_code == 404


def test_honeypot_pretends_and_keeps_nothing(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    r = apply_signed_out(client, job["id"], f"bot-{tag()}@example.com", website="http://spam")
    assert r.status_code == 200 and r.json()["status"] == "applied"
    assert applications(client, owner, company["id"], job["id"])["items"] == []


def test_knockout_failures_are_flagged_and_sorted_last_never_rejected(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    apply_signed_out(client, job["id"], f"no-{tag()}@example.com",
                     answers=[{"question_id": "auth", "answer": "no"}, {"question_id": "years", "answer": "2"}])
    apply_signed_out(client, job["id"], f"yes-{tag()}@example.com")
    items = applications(client, owner, company["id"], job["id"])["items"]
    assert [i["knockout_failed"] for i in items] == [False, True]
    flagged = items[1]
    assert flagged["status"] == "active" and flagged["stage_id"] == "applied" and len(flagged["knockout_reasons"]) == 2


def test_one_click_apply_shares_only_the_chosen_resume_and_follows_in_the_tracker(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    cand = register(client, f"kiran-{tag()}@example.com", "Kiran Rao")
    resume_id = _orbit_resume(client, cand)
    secret = f"PRIVATE-NOTES-{tag()}"

    async def private_doc(db: Any) -> None:
        db.add(Document(user_id=uid(cand), title="Copilot notes", kind="notes", status="ready", source_text=secret))

    db_call(client, private_doc)
    prev = client.get(f"/v1/business/apply/{job['id']}/preview", headers=auth(cand), params={"resume_id": resume_id})
    assert prev.status_code == 200
    p = prev.json()
    assert p["resume_title"] == "My resume" and "Rocketly" in p["resume_text"] and secret not in json.dumps(p)
    assert [r["id"] for r in p["resumes"]] == [resume_id] and p["already_applied"] is False
    other = register(client, f"other-{tag()}@example.com")
    stolen = client.get(f"/v1/business/apply/{job['id']}/preview", headers=auth(other),
                        params={"resume_id": resume_id})
    assert stolen.status_code == 404  # someone else's resume
    body = {"resume_id": resume_id, "answers": GOOD_ANSWERS, "consent": True, "notice_version": rules.NOTICE_VERSION,
            "source": "orbit"}
    r = client.post(f"/v1/business/apply/{job['id']}", headers=auth(cand), json=body)
    assert r.status_code == 200 and r.json()["status"] == "applied" and r.json()["tracker_id"]
    assert r.json()["status_url"].startswith("https://orbitanswer.test/application/")
    dup = client.post(f"/v1/business/apply/{job['id']}", headers=auth(cand), json=body).json()
    assert dup["status"] == "already_applied"
    tracker = client.get("/v1/jobs/tracker", headers=auth(cand)).json()
    entry = next(t for t in tracker if t["id"] == r.json()["tracker_id"])
    assert entry["source"] == "orbit_direct" and entry["status"] == "applied" and entry["company"] == company["name"]
    assert entry["url"].endswith(f"/company/{company['slug']}/jobs/{job['slug']}")
    # The company sees the application, never the account behind it or anything else of it.
    cid = company["id"]
    item = _one(client, owner, cid, job["id"])
    assert item["via_orbit"] is True and item["email_confirmed"] is True
    detail = client.get(f"/v1/business/companies/{cid}/applications/{item['id']}", headers=auth(owner)).json()
    everything = json.dumps(detail) + json.dumps(applications(client, owner, cid, job["id"]))
    everything += client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/export.csv", headers=auth(owner)).text
    assert secret not in everything and uid(cand) not in everything and "user_id" not in detail
    assert detail["resume_source"] == "orbit_resume" and "Rocketly" in detail["resume_text"]
    # The company moves it: the candidate's tracker follows, in plain statuses.
    client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                json={"ids": [item["id"]], "stage_id": "interview"}).raise_for_status()
    tracker = {t["id"]: t for t in client.get("/v1/jobs/tracker", headers=auth(cand)).json()}
    assert tracker[r.json()["tracker_id"]]["status"] == "interviewing"
    client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner),
                json={"ids": [item["id"]], "send_email": False}).raise_for_status()
    tracker = {t["id"]: t for t in client.get("/v1/jobs/tracker", headers=auth(cand)).json()}
    assert tracker[r.json()["tracker_id"]]["status"] == "rejected"


def test_a_member_who_is_also_a_candidate_keeps_the_two_apart(client: TestClient) -> None:
    a_owner, a, _ = new_company(client)
    b_owner, b, _ = new_company(client)
    job_a = new_job(client, a_owner, a["id"])
    job_b = new_job(client, b_owner, b["id"])
    # B's owner applies to A as a candidate, with the same Orbit login.
    resume_id = _orbit_resume(client, b_owner, "Owner's own resume")
    client.post(f"/v1/business/apply/{job_a['id']}", headers=auth(b_owner), json={
        "resume_id": resume_id, "answers": GOOD_ANSWERS, "consent": True,
        "notice_version": rules.NOTICE_VERSION}).raise_for_status()
    # A sees it; B (their own company) sees nothing of it.
    assert len(applications(client, a_owner, a["id"], job_a["id"])["items"]) == 1
    assert applications(client, b_owner, b["id"], job_b["id"])["items"] == []
    assert client.get(f"/v1/business/companies/{a['id']}/jobs/{job_a['id']}/applications",
                      headers=auth(b_owner)).status_code == 404


# ---- ranking -------------------------------------------------------------------------------------------------------


class SpyAI(FakeBusinessAI):
    def __init__(self) -> None:
        self.ranked: list[ParsedResume] = []

    async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking:
        self.ranked.append(resume)
        return await super().rank_applicant(job, resume, answers)


def test_ranking_runs_in_the_background_with_reasons_and_no_protected_inputs(client: TestClient) -> None:
    spy = SpyAI()
    ai_port.set_business_ai(spy)
    try:
        owner, company, _ = new_company(client)
        job = new_job(client, owner, company["id"])
        apply_signed_out(client, job["id"], f"priya-{tag()}@example.com").raise_for_status()
        item = _one(client, owner, company["id"], job["id"])
        detail = wait_ranked(client, owner, company["id"], item["id"])
    finally:
        ai_port.set_business_ai(None)
    assert detail["ranking_status"] == "done"
    rk = detail["ranking"]
    assert "model_version" not in rk and 0 <= rk["score"] <= 100  # it names the model: audit log only
    assert detail["basic_match"] is True  # the fake is keyword matching, as business_ai's fallback is
    met = {m["requirement"]: m["met"] for m in rk["must_haves"]}
    assert met == {"Python": "yes", "Postgres": "yes", "Kubernetes": "no"}
    assert detail["match_label"] == "Matches 2/3 must-haves" and detail["must_haves_met"] == 2
    assert any(m["evidence"] for m in rk["must_haves"] if m["met"] == "yes")
    assert "Python" in detail["parsed"]["skills"]
    assert spy.ranked  # every resume ranked meanwhile (other tests' too) went in without who the person is
    assert all(r.name is None and r.email is None and r.phone is None and r.location is None for r in spy.ranked)
    assert set(ParsedResume.model_fields) == {"name", "email", "phone", "location", "headline", "summary",
                                              "total_years",
                                              "skills", "experience", "education"}  # nothing protected to fill in
    assert detail["status"] == "active"  # a score never rejects anyone
    log = client.get(f"/v1/business/companies/{company['id']}/audit", headers=auth(owner)).json()
    ranked = next(e for e in log if e["action"] == "ranking.completed")
    assert ai_port.FAKE_MODEL_VERSION not in json.dumps(detail)  # members see "basic match", never the version
    assert ranked["detail"]["model_version"] == ai_port.FAKE_MODEL_VERSION and ranked["target"] == detail["reference"]


def test_failed_ranking_is_marked_and_can_be_rerun(client: TestClient) -> None:
    class Broken(FakeBusinessAI):
        async def parse_applicant_resume(self, text: str) -> ParsedResume:
            raise RuntimeError("provider down")

    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    ai_port.set_business_ai(Broken())
    try:
        apply_signed_out(client, job["id"], f"p-{tag()}@example.com").raise_for_status()
        item = _one(client, owner, company["id"], job["id"])
        assert wait_ranked(client, owner, company["id"], item["id"])["ranking_status"] == "failed"
    finally:
        ai_port.set_business_ai(None)
    r = client.post(f"/v1/business/companies/{company['id']}/applications/{item['id']}/rerank", headers=auth(owner))
    assert r.json()["ranking_status"] == "pending"
    assert wait_ranked(client, owner, company["id"], item["id"])["ranking_status"] == "done"


def test_the_ai_writer_drafts_from_a_brief(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    r = client.post(f"/v1/business/companies/{company['id']}/jobs/draft", headers=auth(owner), json={
        "title": "Data Analyst", "seniority": "Junior", "location": "Pune", "employment_type": "full_time",
        "must_haves": ["SQL", "Excel"], "nice_to_haves": ["Python"], "notes": "", "language": "en"})
    assert r.status_code == 200
    d = r.json()
    assert d["title"] == "Data Analyst" and d["must_haves"] == ["SQL", "Excel"]
    assert "<li>SQL</li>" in d["description_html"] and "We make rockets." in d["summary"]
    assert d["suggested_screening_questions"][0]["kind"] == "yes_no"
    assert d["source"] == "ai" and d["inclusive_language_notes"] == []


# ---- the pipeline --------------------------------------------------------------------------------------------------


def test_reject_with_email_from_the_recruiter_and_bulk_moves(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    emails = [f"c{i}-{tag()}@example.com" for i in range(3)]
    for e in emails:
        apply_signed_out(client, job["id"], e).raise_for_status()
    ids = [i["id"] for i in applications(client, owner, cid, job["id"])["items"]]
    m = client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                    json={"ids": ids[:2], "stage_id": "screen", "notify": True})
    assert m.status_code == 200 and m.json()["moved"] == 2
    bad = client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                      json={"ids": ids[:1], "stage_id": "nope"})
    assert bad.status_code == 422
    rej = client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner), json={
        "ids": [ids[2]], "send_email": True, "body": "Hi {{candidate_name}}, not this time for {{job_title}}."})
    assert rej.status_code == 200 and rej.json()["items"][0]["status"] == "rejected"
    rejected = next(i for i in applications(client, owner, cid, job["id"])["items"] if i["id"] == ids[2])
    target = next(e for e in emails if e == rejected["email"])
    mail = next(m for m in mail_to(target) if "Your application for" in m.subject)
    assert mail.reply_to and mail.reply_to.startswith("owner@") and "not this time for Senior Backend" in mail.text
    assert sum(1 for e in emails for m in mail_to(e) if "update on your application" in m.subject.lower()) == 2
    detail = client.get(f"/v1/business/companies/{cid}/applications/{ids[2]}", headers=auth(owner)).json()
    kinds = [e["kind"] for e in detail["timeline"]]
    assert kinds[0] == "applied" and "rejected" in kinds and "email" in kinds
    back = client.post(f"/v1/business/companies/{cid}/applications/{ids[2]}/unreject", headers=auth(owner))
    assert back.json()["status"] == "active" and back.json()["stage_id"] == "applied"
    actions = [e["action"] for e in client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()]
    assert "application.rejected" in actions and "application.moved" in actions


def test_scorecards_tags_and_interview_booking_with_a_calendar_file(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    email = f"booker-{tag()}@example.com"
    apply_signed_out(client, job["id"], email).raise_for_status()
    item = _one(client, owner, cid, job["id"])
    base = f"/v1/business/companies/{cid}/applications/{item['id']}"
    t = client.patch(base, headers=auth(owner), json={"tags": ["strong", "referral", "strong"]})
    assert t.json()["tags"] == ["strong", "referral"]
    assert applications(client, owner, cid, job["id"], tag="referral")["items"][0]["id"] == item["id"]
    bad = client.post(f"{base}/scorecards", headers=auth(owner), json={
        "stage_id": "interview", "ratings": [{"criterion": "x", "score": 5}], "recommendation": "hire"})
    assert bad.status_code == 422
    card = client.post(f"{base}/scorecards", headers=auth(owner), json={
        "stage_id": "interview", "ratings": [{"criterion": "Python", "score": 3}, {"criterion": "Design", "score": 4}],
        "notes": "Solid", "recommendation": "hire"})
    assert card.status_code == 201 and len(card.json()["scorecards"]) == 1
    card2 = client.post(f"{base}/scorecards", headers=auth(owner), json={
        "stage_id": "interview", "ratings": [{"criterion": "Python", "score": 2}], "recommendation": "no_hire"})
    assert len(card2.json()["scorecards"]) == 1 and card2.json()["scorecards"][0]["recommendation"] == "no_hire"
    soon = datetime.now(UTC) + timedelta(days=2)
    slots = [(soon + timedelta(hours=h)).replace(microsecond=0).isoformat() for h in (0, 2, 4)]
    assert client.post(f"{base}/interview", headers=auth(owner), json={
        "slots": slots[:2], "duration_min": 30, "location": "https://meet.example.com/x"}).status_code == 422
    iv = client.post(f"{base}/interview", headers=auth(owner), json={
        "slots": slots, "duration_min": 45, "location": "https://meet.example.com/x"})
    assert iv.status_code == 201 and len(iv.json()["interview"]["slots"]) == 3
    invite = next(m for m in mail_to(email) if "pick a time" in m.subject)
    assert "/application/" in invite.text and invite.reply_to and invite.reply_to.startswith("owner@")
    token = _status_token(email)
    st = client.get(f"/v1/public/business/applications/{token}").json()
    chosen = st["interview"]["slots"][1]
    assert client.post(f"/v1/public/business/applications/{token}/book", json={"slot": "2031-01-01T00:00:00Z"}
                       ).status_code == 422
    b = client.post(f"/v1/public/business/applications/{token}/book", json={"slot": chosen})
    assert b.status_code == 200 and b.json()["interview"]["chosen"]
    booked = next(m for m in mail_to(email) if m.subject.startswith("Interview booked"))
    [(name, mime, data)] = booked.attachments
    assert name == "interview.ics" and mime == "text/calendar"
    ics = data.decode()
    assert "BEGIN:VEVENT" in ics and "DTSTART:" in ics and "\r\n" in ics and "meet.example.com" in ics
    recruiter = [m for m in mail_to(invite.reply_to or "") if "booked" in m.subject]
    assert recruiter and recruiter[0].attachments


def test_blind_review_hides_who_they_are(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    client.patch(f"/v1/business/companies/{cid}", headers=auth(owner), json={"blind_review": True}).raise_for_status()
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"priya-{tag()}@example.com").raise_for_status()
    lst = applications(client, owner, cid, job["id"])
    item = lst["items"][0]
    assert lst["blind"] is True and item["name"].startswith("Candidate A-") and item["email"] is None
    d = client.get(f"/v1/business/companies/{cid}/applications/{item['id']}", headers=auth(owner)).json()
    assert "Priya" not in d["resume_text"] and "priya@example.com" not in d["resume_text"] and d["phone"] is None
    assert "Python services" in d["resume_text"]
    shown = client.get(f"/v1/business/companies/{cid}/applications/{item['id']}?reveal=true", headers=auth(owner))
    assert shown.json()["name"] == "Priya Sharma"
    log = client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()
    assert any(e["action"] == "application.revealed" for e in log)


def test_analytics_funnel_and_first_response(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    for i in range(4):
        apply_signed_out(client, job["id"], f"a{i}-{tag()}@example.com").raise_for_status()
    ids = [i["id"] for i in applications(client, owner, cid, job["id"])["items"]]
    client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                json={"ids": ids[:2], "stage_id": "interview"}).raise_for_status()
    client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                json={"ids": ids[:1], "stage_id": "hired"}).raise_for_status()
    client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner),
                json={"ids": [ids[3]]}).raise_for_status()
    a = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/analytics", headers=auth(owner)).json()
    reached = {f["stage_id"]: f["reached"] for f in a["funnel"]}
    assert reached == {"applied": 4, "screen": 2, "interview": 2, "offer": 1, "hired": 1, "rejected": 1}
    assert a["applicants"] == 4 and a["by_source"] == {"careers": 4} and a["responded"] == 3
    assert a["median_first_response_hours"] is not None
    c = client.get(f"/v1/business/companies/{cid}/analytics", headers=auth(owner)).json()
    assert c["open_jobs"] == 1 and c["applicants_total"] == 4 and c["hired"] == 1 and len(c["daily"]) == 30
    assert c["applicants_30d"] == 4


def test_export_csv_and_delete_on_request(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    email = f"del-{tag()}@example.com"
    apply_signed_out(client, job["id"], email, name="=HYPERLINK(evil)").raise_for_status()
    item = _one(client, owner, cid, job["id"])
    export = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/export.csv", headers=auth(owner))
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(export.text)))
    assert rows[0][:3] == ["reference", "name", "email"] and rows[1][1] == "'=HYPERLINK(evil)" and rows[1][2] == email
    token = _status_token(email)
    st = client.post(f"/v1/public/business/applications/{token}/delete-request")
    assert st.json()["deletion_requested"] is True
    assert _one(client, owner, cid, job["id"])["deletion_requested"] is True
    assert any("asked for their application to be deleted" in m.subject for m in mail_to(f"owner@{_domain(company)}"))
    gone = client.delete(f"/v1/business/companies/{cid}/applications/{item['id']}", headers=auth(owner))
    assert gone.status_code == 204
    assert applications(client, owner, cid, job["id"])["items"] == []
    assert client.get(f"/v1/public/business/applications/{token}").status_code == 404

    async def leftovers(db: Any) -> list[BizAudit]:
        return list((await db.scalars(select(BizAudit).where(BizAudit.company_id == cid))).all())

    log = db_call(client, leftovers)
    assert any(r.action == "application.deleted" and r.target == item["reference"] for r in log)
    text = json.dumps([[r.target, r.detail, r.actor_name] for r in log])
    assert email not in text and "HYPERLINK" not in text  # the log names applicants by reference only


def _domain(company: dict[str, Any]) -> str:
    return str(company["domain"])


def test_retention_deletes_old_rejections_and_closes_expired_jobs(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    for i in range(3):
        apply_signed_out(client, job["id"], f"r{i}-{tag()}@example.com").raise_for_status()
    ids = [i["id"] for i in applications(client, owner, cid, job["id"])["items"]]
    client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner),
                json={"ids": ids[:2]}).raise_for_status()

    async def age(db: Any) -> None:
        old = await db.get(BizApplication, ids[0])
        old.rejected_at = datetime.now(UTC) - timedelta(days=400)
        recent = await db.get(BizApplication, ids[1])
        recent.rejected_at = datetime.now(UTC) - timedelta(days=30)
        j = await db.get(BizJob, job["id"])
        j.valid_through = datetime.now(UTC) - timedelta(minutes=1)

    db_call(client, age)
    out = client.portal.call(sweep)  # type: ignore[union-attr]
    assert out["deleted"] >= 1 and out["closed"] >= 1
    left = {i["id"] for i in applications(client, owner, cid, job["id"])["items"]}
    assert left == {ids[1], ids[2]}
    closed = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(owner)).json()
    assert closed["status"] == "closed"
    actions = [e["action"] for e in client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()]
    assert "retention.deleted" in actions and "job.expired" in actions


def test_stages_are_editable_but_not_out_from_under_applicants(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"s-{tag()}@example.com").raise_for_status()
    stages = [*job["stages"][:3], {"id": "tech", "name": "Tech round", "kind": "interview"}, *job["stages"][3:]]
    r = client.patch(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(owner), json={"stages": stages})
    assert r.status_code == 200 and [s["id"] for s in r.json()["stages"]][3] == "tech"
    no_applied = [s for s in stages if s["id"] != "applied"]
    assert client.patch(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(owner),
                        json={"stages": no_applied}).status_code in {409, 422}


def test_templates_are_editable_and_resettable(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    lst = client.get(f"/v1/business/companies/{cid}/templates", headers=auth(owner)).json()
    assert {t["kind"] for t in lst} == {"received", "stage", "rejection", "interview"}
    assert all(t["is_default"] for t in lst) and "{{status_link}}" in lst[0]["body"]
    put = client.put(f"/v1/business/companies/{cid}/templates/received", headers=auth(owner),
                     json={"subject": "Thanks, {{candidate_name}}", "body": "We got it: {{status_link}}"})
    assert put.json()["is_default"] is False
    job = new_job(client, owner, cid)
    email = f"tpl-{tag()}@example.com"
    apply_signed_out(client, job["id"], email).raise_for_status()
    assert any(m.subject == "Thanks, Priya" for m in mail_to(email))
    reset = client.delete(f"/v1/business/companies/{cid}/templates/received", headers=auth(owner)).json()
    assert reset["is_default"] is True


def test_indexing_api_is_off_without_a_key_and_pings_with_one(client: TestClient,
                                                              monkeypatch: pytest.MonkeyPatch) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from orbit_api.config import get_settings

    owner, company, _ = new_company(client)
    grant(client, company["id"], "starter")

    async def kinds(db: Any) -> list[str]:
        return [j.kind for j in (await db.scalars(select(Job).where(Job.kind == indexing.KIND))).all()]

    before = len(db_call(client, kinds))
    new_job(client, owner, company["id"])
    assert len(db_call(client, kinds)) == before  # off: nothing queued
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    monkeypatch.setenv("ORBIT_GOOGLE_INDEXING_SA_JSON", json.dumps({
        "client_email": "indexer@orbit.iam.gserviceaccount.com", "private_key": key}))
    get_settings.cache_clear()
    sent: list[dict[str, Any]] = []

    async def fake_publish(url: str, kind: str) -> None:
        sent.append({"url": url, "type": kind})

    monkeypatch.setattr(indexing, "publish", fake_publish)
    job = new_job(client, owner, company["id"], title="Indexed role")
    client.post(f"/v1/business/companies/{company['id']}/jobs/{job['id']}/close", headers=auth(owner))

    async def queued(db: Any) -> list[dict[str, Any]]:
        rows = (await db.scalars(select(Job).where(Job.kind == indexing.KIND))).all()
        return [dict(j.payload) for j in rows if j.payload.get("url") == job["public_url"]]

    payloads = db_call(client, queued)
    assert payloads == [{"url": job["public_url"], "type": "URL_DELETED"}]  # one per URL: the latest state wins
    client.portal.call(indexing._run, payloads[0])  # type: ignore[union-attr]
    assert {"url": job["public_url"], "type": "URL_DELETED"} in sent
    assert indexing.enabled()


def test_closed_jobs_take_no_applications(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    client.post(f"/v1/business/companies/{company['id']}/jobs/{job['id']}/pause", headers=auth(owner))
    r = apply_signed_out(client, job["id"], f"late-{tag()}@example.com")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "biz_job_closed"
    paused = client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}").json()
    assert paused["status"] == "paused" and paused["json_ld"] is None


def test_tracker_rows_belong_to_the_candidate_only(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    cand = register(client, f"t-{tag()}@example.com")
    rid = _orbit_resume(client, cand)
    r = client.post(f"/v1/business/apply/{job['id']}", headers=auth(cand), json={
        "resume_id": rid, "answers": GOOD_ANSWERS, "consent": True, "notice_version": rules.NOTICE_VERSION}).json()

    async def row(db: Any) -> JobApplication:
        return await db.get(JobApplication, r["tracker_id"])

    entry = db_call(client, row)
    assert entry.user_id == uid(cand) and entry.listing_id.startswith("biz:") and len(entry.listing_id) <= 36


RESUME_TEXT = "Asha Rao\nAnalyst\nasha@example.com\n\nSKILLS\nSQL, Excel\n"


async def test_the_real_business_ai_behind_the_port_records_usage_per_call() -> None:
    """ModuleAI drives orbit_api.business_ai (D83) with this port's models, and every model call it makes lands in
    recording() for the company's usage. With the test suite's mock model the answers aren't usable JSON, so each
    function falls back to its deterministic path, which the port reports as a basic match."""
    import orbit_api.business_ai as real

    port = ai_port.ModuleAI(real)
    with ai_port.recording() as calls:
        draft = await port.write_job_description(ai_port.JobBrief(title="Data Analyst", must_haves=["SQL"]))
        parsed = await port.parse_applicant_resume(RESUME_TEXT)
        ranking = await port.rank_applicant(
            JobSpec(title="Data Analyst", must_haves=["SQL"], experience_band="junior"), parsed,
            [QA(question="Authorised to work in India?", answer="yes")])
    assert draft.title and draft.source in {"ai", "template"} and isinstance(draft.inclusive_language_notes, list)
    assert "SQL" in " ".join(parsed.skills) and 0 <= ranking.score <= 100
    assert ranking.must_haves[0].requirement == "SQL"
    assert calls and all(c.request_type.startswith("business") for c in calls)
    assert ai_port.basic_match(ranking.model_version) == ranking.model_version.endswith("deterministic-only")
    assert ai_port.location_text(ai_port.LocationRules(workplace="remote", allowed_countries=["IN"])) == (
        "Remote; open to applicants in IN")


def test_ranking_usage_is_stored_against_the_company(client: TestClient) -> None:
    from orbit_api.models import ProviderRequest

    class Counting(FakeBusinessAI):
        async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking:
            calls = ai_port._recording.get()
            assert calls is not None  # the ranking job records what the AI calls
            calls.append(ai_port.UsageRecord("mock", "mock-model", "business_rank", 10, 5, 0, 3, True))
            return await super().rank_applicant(job, resume, answers)

    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    ai_port.set_business_ai(Counting())
    try:
        apply_signed_out(client, job["id"], f"u-{tag()}@example.com").raise_for_status()
        item = _one(client, owner, company["id"], job["id"])
        wait_ranked(client, owner, company["id"], item["id"])
    finally:
        ai_port.set_business_ai(None)

    async def rows(db: Any) -> list[ProviderRequest]:
        return list((await db.scalars(select(ProviderRequest).where(
            ProviderRequest.company_id == company["id"]))).all())

    [row] = db_call(client, rows)
    assert row.request_type == "business_rank" and row.input_tokens == 10 and row.user_id is None
