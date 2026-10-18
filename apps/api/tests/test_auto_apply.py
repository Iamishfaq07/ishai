"""Orbit Apply end to end on the API (auto_apply/, D84): setup and consent, the planner (filters, threshold, dedupe,
caps, hand-offs), needs_answer, Review-first, the executor contract (lease, result, proof, tracker, quota), pacing,
the kill switch, and what an extension-scoped token can and can't reach."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update

from orbit_api import credits
from orbit_api.auto_apply import pacing, planner, rules
from orbit_api.db import sessionmaker
from orbit_api.job_portal import ranking
from orbit_api.models import (
    ApplicationPacket,
    ApplyProof,
    ApplySiteState,
    AutoApplySetup,
    CreditEntry,
    JobApplication,
    Resume,
    User,
)
from tests.autoapply_helpers import (
    LEVER_ID,
    account,
    ext_token,
    form_transport,
    jobs,
    png,
    user_id,
    verify_email,
)
from tests.test_api import _register
from tests.test_jobs import _clear_jobs, _listing, run
from tests.test_signup_approval import _outbox


async def _clear_apply() -> None:
    async with sessionmaker()() as db:
        for model in (ApplyProof, ApplicationPacket, ApplySiteState):
            await db.execute(delete(model))
        await db.commit()


@pytest.fixture
def app(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    run(client, _clear_jobs)
    run(client, _clear_apply)
    _register(client)  # outside production the first account is the admin: not one of these candidates
    ranking.clear_cache()
    calls: list[str] = []
    monkeypatch.setattr(planner, "FORM_TRANSPORT", form_transport(calls))
    client.form_calls = calls  # type: ignore[attr-defined]
    yield client
    ranking.clear_cache()
    run(client, _clear_apply)


def plan(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    r = client.post("/v1/apply/plan", headers=h)
    assert r.status_code == 200, r.text
    return dict(r.json())


def packets(client: TestClient, h: dict[str, str], group: str | None = None) -> list[dict[str, Any]]:
    r = client.get("/v1/apply/packets", headers=h, params={"group": group} if group else None)
    assert r.status_code == 200, r.text
    return list(r.json())


def by_company(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {p["company"]: p for p in items}


def packet_row(client: TestClient, packet_id: str) -> ApplicationPacket:
    async def go() -> ApplicationPacket:
        async with sessionmaker()() as db:
            p = await db.get(ApplicationPacket, packet_id)
            assert p is not None
            return p

    return run(client, go)  # type: ignore[no-any-return]


def edit_packets(client: TestClient, user: str, **values: Any) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(ApplicationPacket).where(ApplicationPacket.user_id == user).values(**values))
            await db.commit()

    run(client, go)


def answer_all(client: TestClient, h: dict[str, str], packet_id: str) -> dict[str, Any]:
    """Answer every open question of a packet the way a candidate would: "Yes", or the first option."""
    detail = client.get(f"/v1/apply/packets/{packet_id}", headers=h).json()
    given = []
    for m in detail["missing_questions"]:
        value = (m["options"] or ["Yes"])[0] if m["kind"] in ("select", "multiselect", "boolean") else "Yes"
        if "compensation" in m["label"].lower():
            value = "18 LPA"
        given.append({"question_id": m["question_id"], "value": value})
    r = client.post(f"/v1/apply/packets/{packet_id}/answers", headers=h, json={"answers": given})
    assert r.status_code == 200, r.text
    return dict(r.json())


# ---- setup -------------------------------------------------------------------------------------------------------


def test_setup_suggests_facts_from_the_resume_and_needs_an_approved_resume_and_consent(app: TestClient) -> None:
    from tests.autoapply_helpers import make_resume, setup_body

    h = _register(app)
    rid = make_resume(app, h)
    s = app.get("/v1/apply/setup", headers=h).json()
    assert s["configured"] is False and s["facts_suggested"] is True
    f = s["facts"]
    assert (f["first_name"], f["last_name"], f["email"], f["city"]) == ("Asha", "Rao", "asha@example.com",
                                                                          "Bengaluru")
    assert f["current_company"] == "PayNest" and f["years_experience"] >= 4
    # Only the candidate can state these.
    assert f["work_auth"] == [] and f["current_salary"] == "" and f["expected_salary"] == ""
    assert s["caps"]["max_daily_limit"] == 25 and s["daily_limit"] == 10 and s["mode"] == "automatic"
    assert s["quota"]["trial"] is True and s["quota"]["included"] == rules.FREE_TRIAL_APPLICATIONS
    # Consent without approving the resume is refused; the limits are hard.
    r = app.put("/v1/apply/setup", headers=h, json=setup_body(rid, approve_resume=False))
    assert r.status_code == 422
    assert app.put("/v1/apply/setup", headers=h, json=setup_body(rid, daily_limit=26)).status_code == 422
    assert app.put("/v1/apply/setup", headers=h, json=setup_body(rid, threshold=30)).status_code == 422
    assert app.put("/v1/apply/setup", headers=h, json=setup_body(
        rid, filters={"days": 45})).status_code == 422
    s = app.put("/v1/apply/setup", headers=h, json=setup_body(rid)).json()
    assert s["configured"] is True and s["resume"]["approved"] is True and s["ai_line"] is True
    assert s["consent_text"].startswith("I ask Orbit to apply to jobs for me, as my agent")
    # Editing the resume after approving it stops planning until it's approved again.
    async def edit() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(Resume).where(Resume.id == rid).values(
                data={"basics": {"name": "Asha Rao", "headline": "Now a staff engineer"}}))
            await db.commit()

    run(app, edit)
    s = app.get("/v1/apply/setup", headers=h).json()
    assert s["resume"]["changed_since"] is True and s["resume"]["approved"] is False
    assert plan(app, h)["blocked"].startswith("Your resume changed")
    s = app.put("/v1/apply/setup", headers=h, json=setup_body(rid)).json()
    assert s["resume"]["approved"] is True


def test_the_bank_lists_the_common_questions_with_decline_for_self_identification(app: TestClient) -> None:
    h, _ = account(app)
    items = app.get("/v1/apply/bank", headers=h).json()
    keys = {i["key"]: i for i in items}
    assert len(items) >= 18
    assert keys["eeo_gender"]["default"] == "Decline to self-identify" and keys["eeo_gender"]["group"] == "eeo"
    assert keys["background_check"]["group"] == "legal" and keys["background_check"]["value"] == ""
    r = app.put("/v1/apply/bank", headers=h, json=[{"norm": "background_check", "value": "Yes"},
                                                    {"norm": "travel", "value": "No"}])
    keys = {i["key"]: i for i in r.json()}
    assert keys["background_check"]["value"] == "Yes" and keys["travel"]["value"] == "No"
    # An empty value removes the answer again.
    keys = {i["key"]: i for i in app.put("/v1/apply/bank", headers=h,
                                         json=[{"norm": "travel", "value": ""}]).json()}
    assert keys["travel"]["value"] == ""


# ---- the planner -------------------------------------------------------------------------------------------------


def test_the_planner_prepares_one_packet_per_matching_job_from_each_ats(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    report = plan(app, h)
    assert report["blocked"] is None and report["created"] == 3, report
    items = by_company(packets(app, h))
    gh, lever, ashby = items["Acme"], items["Meesho"], items["Sarvam AI"]
    assert (gh["ats"], lever["ats"], ashby["ats"]) == ("greenhouse", "lever", "ashby")
    # Every packet says why it was picked.
    assert all(p["match_score"] >= 50 and "% match" in p["match_reason"] for p in items.values())
    # Anthropic's real form asks legal questions (arbitration, its AI policy) and things only the candidate knows.
    assert gh["status"] == "needs_answer" and gh["missing"] >= 4
    detail = app.get(f"/v1/apply/packets/{gh['id']}", headers=h).json()
    labels = {m["label"]: m for m in detail["missing_questions"]}
    assert labels["Agreement to Arbitrate"]["legal"] is True
    assert labels["AI Policy for Application"]["legal"] is True
    assert any("experience selling API" in label for label in labels)
    answers = {a["label"]: a for a in detail["answers"]}
    assert answers["First Name"]["value"] == "Asha" and answers["First Name"]["source"] == "profile"
    # Sponsorship comes from the candidate's own per-country answer (the job is in India here: authorised, no visa).
    sponsor = next(a for label, a in answers.items() if "sponsorship" in label)
    assert sponsor["value"] == "No" and sponsor["source"] == "profile"
    assert answers["Why Anthropic?"]["source"] == "generated"
    assert answers["Gender"]["value"].lower().startswith("decline")
    # Lever's form asks for current compensation: salary history is never filled in for the candidate.
    ldetail = app.get(f"/v1/apply/packets/{lever['id']}", headers=h).json()
    assert any(m["label"].startswith("Current Compensation") for m in ldetail["missing_questions"])
    lanswers = {a["label"]: a["value"] for a in ldetail["answers"]}
    assert lanswers["Notice Period (In days)"] == "30" and lanswers["Total Years of experience"] == "5"
    assert lanswers["Are you based out of Bangalore ?"] == "Yes"
    # Sarvam's short Ashby form has nothing the candidate must answer: ready for the browser.
    assert ashby["status"] == "ready"
    adetail = app.get(f"/v1/apply/packets/{ashby['id']}", headers=h).json()
    assert adetail["cover_letter"].endswith(rules.AI_LINE)
    assert adetail["fields"]["first_name"] == "Asha" and adetail["form_source"] == "fetched"
    assert any(c["kind"] == "reorder" for c in adetail["resume_diff"])
    # Planning again makes nothing twice.
    assert plan(app, h)["created"] == 0


def test_filters_threshold_freshness_salary_floor_and_exclusions(app: TestClient) -> None:
    h, _ = account(app, filters={"titles": ["Backend Engineer"], "days": 14, "salary_floor": 2_000_000,
                                   "exclude_companies": ["Globex"]})
    now = datetime.now(UTC)
    kw: dict[str, Any] = dict(keywords=["Python", "PostgreSQL", "AWS"], description="Python services. " * 30)
    jobs(app, old=_listing(company="Initech", external_id="o1", posted_at=now - timedelta(days=20), **kw),
         cheap=_listing(company="Hooli", external_id="c1", salary="₹8L - ₹12L", **kw),
         excluded=_listing(company="Globex", external_id="x1", **kw),
         off=_listing(company="Umbrella", external_id="f1", title="Chartered Accountant",
                      keywords=["Tally", "GST", "Audit"]),
         reposted=_listing(company="Vandelay", external_id="r1", created_at=now - timedelta(days=20),
                           posted_at=now - timedelta(hours=2), **kw))
    report = plan(app, h)
    made = {p["company"] for p in packets(app, h)}
    assert made == {"Acme", "Meesho", "Sarvam AI"}, report
    reasons = {s["company"]: s["reason"] for s in report["skipped"]}
    assert "salary floor" in reasons["Hooli"] and "excluded" in reasons["Globex"]
    assert "reposted" in reasons["Vandelay"]


def test_two_per_company_in_30_days_and_dont_apply_is_remembered(app: TestClient) -> None:
    h, _ = account(app)
    kw: dict[str, Any] = dict(keywords=["Python", "PostgreSQL", "AWS"], description="Python services. " * 30,
                              company="Acme", board="acme", source="greenhouse")
    jobs(app, gh2=_listing(external_id="222", title="Senior Backend Engineer",
                           url="https://job-boards.greenhouse.io/acme/jobs/222", **kw),
         gh3=_listing(external_id="333", title="Backend Engineer II",
                      url="https://job-boards.greenhouse.io/acme/jobs/333", **kw))
    report = plan(app, h)
    acme = [p for p in packets(app, h) if p["company"] == "Acme"]
    assert len(acme) == 2
    assert any("two applications to this company" in s["reason"] for s in report["skipped"])
    r = app.post(f"/v1/apply/packets/{acme[0]['id']}/dont-apply", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["group"] == "skipped"
    plan(app, h)
    again = [p for p in packets(app, h) if p["company"] == "Acme"]
    assert {p["id"] for p in again} >= {acme[0]["id"]} and next(
        p for p in again if p["id"] == acme[0]["id"])["status"] == "cancelled"


def test_job_boards_are_never_automated_but_resolved_to_the_employers_ats(app: TestClient) -> None:
    h, _ = account(app)
    kw: dict[str, Any] = dict(keywords=["Python", "PostgreSQL", "AWS"], description="Python services. " * 30)
    li = _listing(source="jsearch", board="search", external_id="li1", company="Initech", title="Backend Engineer",
                  url="https://www.linkedin.com/jobs/view/123", apply_url="https://www.linkedin.com/jobs/view/123",
                  **kw)
    # The same job on Naukri and on the employer's own Lever board: applied to on Lever.
    nk = _listing(source="jsearch", board="search", external_id="nk1", company="Hooli", title="Backend Engineer", url="https://www.naukri.com/job-listings-123",
                  apply_url="https://www.naukri.com/job-listings-123", **kw)
    own = _listing(source="lever", board="hooli", external_id="0d4a1c9e-1111-4222-8333-944455556666",
                   company="Hooli", title="Backend Engineer", posted_at=nk.posted_at,
                   url="https://jobs.lever.co/hooli/0d4a1c9e-1111-4222-8333-944455556666", **kw)
    own.dedupe_key = nk.dedupe_key
    jobs(app, li=li, nk=nk, own=own)
    plan(app, h)
    items = by_company(packets(app, h))
    assert items["Initech"]["status"] == "handoff" and items["Initech"]["site"] == "LinkedIn"
    assert "Needs you: apply on LinkedIn" in items["Initech"]["reason"]
    assert items["Initech"]["group"] == "needs_you"
    detail = app.get(f"/v1/apply/packets/{items['Initech']['id']}", headers=h).json()
    assert any(a["label"] == "Why this company?" for a in detail["answers"])  # ready to copy
    assert items["Hooli"]["ats"] == "lever" and items["Hooli"]["apply_url"].startswith("https://jobs.lever.co/hooli/")
    # A hand-off is never leased to a browser.
    edit_packets(app, user_id(app, h), status="cancelled")
    async def handoff_only() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(ApplicationPacket).where(ApplicationPacket.id == items["Initech"]["id"])
                             .values(status="handoff"))
            await db.commit()
    run(app, handoff_only)
    assert app.get("/v1/apply/next", headers=ext_token(app, h)).status_code == 204


# ---- needs_answer and review -------------------------------------------------------------------------------------


def test_answering_once_unblocks_the_packet_and_is_saved_to_the_bank(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    lever = by_company(packets(app, h))["Meesho"]
    assert lever["status"] == "needs_answer"
    detail = answer_all(app, h, lever["id"])
    assert detail["status"] == "ready" and detail["missing_questions"] == []
    answers = {a["label"]: a for a in detail["answers"]}
    assert answers["Current Compensation (Yearly)"]["value"] == "18 LPA"
    assert answers["Current Compensation (Yearly)"]["source"] == "profile" or \
        answers["Current Compensation (Yearly)"]["source"] == "bank"
    bank = {i["norm"]: i for i in app.get("/v1/apply/bank", headers=h).json()}
    assert bank["current_salary"]["value"] == "18 LPA" and bank["current_salary"]["group"] == "custom"
    # A legal agreement is answered per company: Acme's arbitration answer isn't used for anyone else.
    gh = by_company(packets(app, h))["Acme"]
    answer_all(app, h, gh["id"])
    keys = [i["norm"] for i in app.get("/v1/apply/bank", headers=h).json()]
    assert any(k.startswith("arbitration@acme") for k in keys)


def test_review_first_waits_for_approval(app: TestClient) -> None:
    h, _ = account(app, mode="review")
    jobs(app)
    plan(app, h)
    ashby = by_company(packets(app, h))["Sarvam AI"]
    assert ashby["status"] == "review" and ashby["group"] == "prepared"
    ext = ext_token(app, h)
    assert app.get("/v1/apply/next", headers=ext).status_code == 204
    r = app.post(f"/v1/apply/packets/{ashby['id']}/approve", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "ready"
    assert app.get("/v1/apply/next", headers=ext).status_code == 200


# ---- the executor contract ---------------------------------------------------------------------------------------


def test_lease_submit_with_proof_updates_the_tracker_and_counts_the_quota(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    r = app.get("/v1/apply/next", headers=ext)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["job"]["ats"] == "ashby" and p["job"]["company"] == "Sarvam AI"
    assert p["fields"]["email"] == "asha@example.com" and p["eeo"] == "decline"
    assert p["resume"]["filename"].endswith(".pdf") and "sig=" in p["resume"]["download_url"]
    assert {a["source"] for a in p["answers"]} <= {"bank", "profile", "generated"}
    assert p["cover_letter"] and p["not_before"] and p["expires_at"] and p["lease_expires_at"]
    # The signed resume link needs no session; a changed signature is refused.
    path = p["resume"]["download_url"].split("testserver", 1)[-1]
    pdf = app.get(path)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and b"Asha Rao" in pdf.content
    assert pdf.headers["content-type"] == "application/pdf"
    assert p["resume"]["filename"] == "Asha Rao - Resume.pdf"
    assert app.get(path.replace("sig=", "sig=0")).status_code == 403
    # Asking again from the same browser (a restarted service worker) gets the same packet back, lease unchanged and
    # not held twice; another browser of the same candidate is told it's busy (one application at a time).
    again = app.get("/v1/apply/next", headers=ext)
    assert again.status_code == 200, again.text
    same = again.json()
    assert same["id"] == p["id"] and same["lease_expires_at"] == p["lease_expires_at"]
    assert {k: v for k, v in same.items() if k != "resume"} == {k: v for k, v in p.items() if k != "resume"}
    assert app.get("/v1/apply/setup", headers=h).json()["quota"]["used"] == 1  # held once, not twice
    other = ext_token(app, h)
    busy = app.get("/v1/apply/next", headers=other)
    assert busy.status_code == 204 and busy.headers["X-Orbit-Apply-Why"] == "busy"
    assert 0 < int(busy.headers["Retry-After"]) <= 15 * 60
    s = app.get("/v1/apply/status", headers=ext).json()
    assert s["today"] == 1 and s["limit"] == 10
    r = app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={
        "status": "submitted", "reason": None, "confirmation_text": "Thanks for applying to Sarvam AI!",
        "final_url": "https://jobs.ashbyhq.com/sarvam/x/application?submitted=true", "screenshot_png_b64": png(),
        "submitted": {"fields": {"_systemfield_name": "Asha Rao"}, "answers": [{"label": "Email",
                                                                                "value": "asha@example.com"}]}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "submitted" and out["charged"] is True and out["tracker_id"]
    detail = app.get(f"/v1/apply/packets/{p['id']}", headers=h).json()
    assert detail["group"] == "applied" and detail["confirmation_text"].startswith("Thanks")
    assert detail["submitted"]["fields"]["_systemfield_name"] == "Asha Rao"
    shot = app.get(detail["screenshot_url"], headers=h)
    assert shot.status_code == 200 and shot.headers["content-type"] == "image/png"
    tracker = {e["id"]: e for e in app.get("/v1/jobs/tracker", headers=h).json()}
    entry = tracker[out["tracker_id"]]
    assert entry["status"] == "applied" and entry["applied_via"] == "orbit_apply"
    assert "Applied (Orbit Apply)" in entry["notes"]
    events = app.get(f"/v1/jobs/tracker/{entry['id']}/timeline", headers=h).json()
    assert any(e["title"] == "Applied (Orbit Apply)" for e in events)
    q = app.get("/v1/apply/setup", headers=h).json()["quota"]
    assert q["used"] == 1 and q["left"] == rules.FREE_TRIAL_APPLICATIONS - 1
    # The same result can't be posted twice.
    again = app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={"status": "submitted"})
    assert again.status_code == 409


def test_needs_you_refunds_notifies_and_unknown_questions_come_back_to_the_candidate(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    verify_email(app, uid)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    p = app.get("/v1/apply/next", headers=ext).json()
    r = app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={
        "status": "needs_you", "reason": "unknown_question",
        "unknown_questions": [{"label": "Do you have a valid passport?", "kind": "select", "options": ["Yes", "No"]}],
        "screenshot_png_b64": png()})
    assert r.status_code == 200 and r.json()["status"] == "needs_you" and r.json()["charged"] is False
    detail = app.get(f"/v1/apply/packets/{p['id']}", headers=h).json()
    assert detail["group"] == "needs_you" and "answer" in detail["reason"].lower()
    assert [m["label"] for m in detail["missing_questions"]] == ["Do you have a valid passport?"]
    email = app.get("/v1/auth/me", headers=h).json()["email"]
    mail = [m for m in _outbox().sent if m.to == email and "Orbit Apply needs you" in m.subject]
    assert mail and "Finish in one click" in mail[-1].text
    assert app.get("/v1/apply/setup", headers=h).json()["quota"]["used"] == 0  # not charged
    # The candidate answers once; retry sends it back to the queue with the answer.
    app.post(f"/v1/apply/packets/{p['id']}/answers", headers=h, json={"answers": [
        {"question_id": detail["missing_questions"][0]["question_id"], "value": "Yes"}]})
    r = app.post(f"/v1/apply/packets/{p['id']}/retry", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "ready"
    assert any(a["label"] == "Do you have a valid passport?" and a["value"] == "Yes" for a in r.json()["answers"])
    # A captcha: never solved, handed to the candidate, who can finish it by hand (not charged).
    edit_packets(app, uid, leased_at=None)
    p2 = app.get("/v1/apply/next", headers=ext).json()
    r = app.post(f"/v1/apply/{p2['id']}/result", headers=ext, json={"status": "needs_you", "reason": "captcha"})
    assert "captcha" in app.get(f"/v1/apply/packets/{p2['id']}", headers=h).json()["reason"]
    done = app.post(f"/v1/apply/packets/{p2['id']}/done", headers=h).json()
    assert done["status"] == "applied" and done["group"] == "applied" and done["tracker_id"]


def test_bad_results_are_refused(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    ashby = by_company(packets(app, h))["Sarvam AI"]
    assert app.post(f"/v1/apply/{ashby['id']}/result", headers=ext, json={"status": "submitted"}).status_code == 409
    p = app.get("/v1/apply/next", headers=ext).json()
    jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx"
    assert app.post(f"/v1/apply/{p['id']}/result", headers=ext,
                    json={"status": "submitted", "screenshot_png_b64": jpeg}).status_code == 422
    assert app.post(f"/v1/apply/{p['id']}/result", headers=ext,
                    json={"status": "maybe"}).status_code == 422
    # Someone else's packet is not found.
    other = _register(app)
    assert app.post(f"/v1/apply/{p['id']}/result", headers=ext_token(app, other),
                    json={"status": "submitted"}).status_code == 404


def test_a_lease_that_runs_out_goes_back_and_a_late_submit_still_counts(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    p = app.get("/v1/apply/next", headers=ext).json()
    edit_packets(app, uid, lease_until=datetime.now(UTC) - timedelta(minutes=1))
    assert app.get("/v1/apply/status", headers=ext).json()["today"] == 0  # the hold is given back
    assert packet_row(app, p["id"]).status == "ready"
    # The browser had in fact submitted it: the late result is recorded, not applied to twice.
    r = app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={"status": "submitted", "screenshot_png_b64": png()})
    assert r.status_code == 200 and r.json()["status"] == "submitted" and r.json()["charged"] is True


# ---- pacing, caps and the kill switch ----------------------------------------------------------------------------


def _due(client: TestClient, uid: str, now: datetime) -> pacing.Due:
    async def go() -> pacing.Due:
        async with sessionmaker()() as db:
            user = await db.get(User, uid)
            assert user is not None
            due = await pacing.next_due(db, user, now)
            await db.commit()
            return due

    return run(client, go)  # type: ignore[no-any-return]


def _ready_packets(client: TestClient, uid: str, n: int, tenants: list[str], **kw: Any) -> list[str]:
    async def go() -> list[str]:
        async with sessionmaker()() as db:
            ids = []
            for i in range(n):
                p = ApplicationPacket(user_id=uid, listing_id=f"t-{uuid.uuid4().hex[:20]}",
                                      status="ready", ats=kw.get("ats", "lever"), tenant=tenants[i % len(tenants)],
                                      company=f"Co {i}", company_key=kw.get("company_key", f"co {i}"),
                                      title="Engineer", url="https://jobs.lever.co/x/y", apply_url="https://x",
                                      not_before=datetime.now(UTC) - timedelta(hours=1),
                                      expires_at=datetime.now(UTC) + timedelta(days=1), tenant_gap_s=300)
                db.add(p)
                await db.flush()
                ids.append(p.id)
            await db.commit()
            return ids

    return run(client, go)  # type: ignore[no-any-return]


def _result(client: TestClient, packet_id: str, status: str, reason: str | None, when: datetime) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            p = await db.get(ApplicationPacket, packet_id)
            assert p is not None
            p.status, p.result_status, p.result_reason, p.result_at, p.lease_until = (
                "submitted" if status == "submitted" else status, status, reason, when, None)
            p.submitted_at = when if status == "submitted" else None
            await db.commit()

    run(client, go)


def test_pacing_spaces_submissions_per_tenant_and_overall(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    ids = _ready_packets(app, uid, 3, ["acme", "acme", "globex"])
    t0 = datetime.now(UTC)
    first = _due(app, uid, t0).packet
    assert first is not None and first.tenant == "acme"
    _result(app, first.id, "submitted", None, t0 + timedelta(seconds=30))
    # Under 60 s since the last one: nothing, and when to ask again.
    d = _due(app, uid, t0 + timedelta(seconds=40))
    assert d.packet is None and d.why == "pacing" and d.next_at == t0 + rules.MIN_GAP
    # After 60 s: not acme again (its 3-8 minutes haven't passed), so globex.
    second = _due(app, uid, t0 + timedelta(seconds=90)).packet
    assert second is not None and second.tenant == "globex"
    _result(app, second.id, "submitted", None, t0 + timedelta(seconds=100))
    d = _due(app, uid, t0 + timedelta(seconds=200))
    assert d.packet is None and d.why == "pacing" and d.next_at is not None
    third = _due(app, uid, t0 + timedelta(seconds=400)).packet
    assert third is not None and third.tenant == "acme" and third.id in ids


def test_daily_limit_quiet_hours_and_pause(app: TestClient) -> None:
    h, _ = account(app, daily_limit=1)
    uid = user_id(app, h)
    _ready_packets(app, uid, 3, ["a", "b", "c"])
    t0 = datetime.now(UTC)
    p = _due(app, uid, t0).packet
    assert p is not None
    _result(app, p.id, "submitted", None, t0)
    d = _due(app, uid, t0 + timedelta(minutes=30))
    assert d.why == "daily_limit" and d.next_at is not None and d.next_at > t0
    # Quiet hours, in the candidate's own time.
    async def quiet() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(AutoApplySetup).where(AutoApplySetup.user_id == uid).values(
                daily_limit=10, quiet_start=0, quiet_end=1439, tz_offset_min=330))
            await db.commit()
    run(app, quiet)
    assert _due(app, uid, t0 + timedelta(minutes=30)).why == "quiet_hours"
    assert app.post("/v1/apply/pause", headers=h).json() == {"paused": True}
    assert _due(app, uid, t0 + timedelta(minutes=30)).why == "paused"
    assert app.get("/v1/apply/status", headers=h).json()["paused"] is True


def test_the_company_cap_holds_at_lease_time_too(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    ids = _ready_packets(app, uid, 3, ["a", "b", "c"], company_key="acme")
    t0 = datetime.now(UTC)
    _result(app, ids[0], "submitted", None, t0 - timedelta(days=3))
    _result(app, ids[1], "submitted", None, t0 - timedelta(days=2))
    d = _due(app, uid, t0)
    assert d.packet is None
    assert packet_row(app, ids[2]).status == "skipped"


def test_the_kill_switch_pauses_a_site_with_too_many_captchas_and_the_admin_can_lift_it(
        app: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    t0 = datetime.now(UTC)
    bad = _ready_packets(app, uid, 10, ["t1", "t2"], ats="greenhouse")
    for i, pid in enumerate(bad):
        _result(app, pid, "needs_you" if i % 3 else "failed", "captcha" if i % 3 else "error",
                t0 - timedelta(minutes=i))

    async def evaluate() -> bool:
        async with sessionmaker()() as db:
            paused = await pacing.evaluate_site(db, "greenhouse", t0)
            await db.commit()
            return paused

    assert run(app, evaluate) is True
    good = _ready_packets(app, uid, 1, ["t3"], ats="greenhouse")
    lever = _ready_packets(app, uid, 1, ["l1"], ats="lever")
    d = _due(app, uid, t0 + timedelta(minutes=5))
    assert d.packet is not None and d.packet.id == lever[0]  # greenhouse is paused, lever isn't
    assert "greenhouse" in app.get("/v1/apply/status", headers=h).json()["sites_paused"]
    # The admin sees it and lifts it.
    from orbit_api.admin import routes as admin_routes

    async def yes(*_: Any) -> bool:
        return True

    assert app.get("/v1/admin/apply/sites", headers=h).status_code == 403
    monkeypatch.setattr(admin_routes, "is_admin", yes)
    sites = {s["site"]: s for s in app.get("/v1/admin/apply/sites", headers=h).json()}
    assert sites["greenhouse"]["auto_paused_until"] and sites["greenhouse"]["bad"] >= 8
    sites = {s["site"]: s for s in app.put("/v1/admin/apply/sites/greenhouse", headers=h,
                                           json={"paused": False, "clear_auto": True}).json()}
    assert sites["greenhouse"]["auto_paused_until"] is None
    sites = {s["site"]: s for s in app.put("/v1/admin/apply/sites/lever", headers=h,
                                           json={"paused": True, "reason": "Lever changed its form"}).json()}
    assert sites["lever"]["admin_paused"] is True
    assert "lever" in app.get("/v1/apply/status", headers=h).json()["sites_paused"]
    assert good


def test_only_confirmed_submissions_are_charged_and_top_up_credits_come_back_on_failure(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    ids = _ready_packets(app, uid, rules.FREE_TRIAL_APPLICATIONS + 2, [f"t{i}" for i in range(10)])
    t0 = datetime.now(UTC) - timedelta(days=2)
    for i, pid in enumerate(ids[:rules.FREE_TRIAL_APPLICATIONS]):
        async def charge(pid: str = pid) -> None:
            async with sessionmaker()() as db:
                await db.execute(update(ApplicationPacket).where(ApplicationPacket.id == pid).values(charge="plan"))
                await db.commit()
        run(app, charge)
        _result(app, pid, "submitted", None, t0 - timedelta(minutes=i))
    # The Free trial is used up: nothing is leased.
    assert _due(app, uid, datetime.now(UTC)).why == "no_quota"
    # A top-up credit is held for the lease and given back when it fails.
    async def top_up() -> None:
        async with sessionmaker()() as db:
            credits.add(db, uid, "apply", 1, "admin")
            await db.commit()
    run(app, top_up)
    ext = ext_token(app, h)
    p = app.get("/v1/apply/next", headers=ext).json()
    assert app.get("/v1/apply/setup", headers=h).json()["quota"]["credits"] == 0
    app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={"status": "failed", "reason": "form_changed"})
    assert app.get("/v1/apply/setup", headers=h).json()["quota"]["credits"] == 1

    async def ledger() -> list[tuple[int, str]]:
        async with sessionmaker()() as db:
            rows = (await db.scalars(select(CreditEntry).where(CreditEntry.user_id == uid,
                                                               CreditEntry.kind == "apply"))).all()
            return [(r.amount, r.reason) for r in rows]
    assert sorted(run(app, ledger)) == [(-1, "apply_hold"), (1, "admin"), (1, "apply_refund")]


# ---- the extension's token ---------------------------------------------------------------------------------------


def test_an_extension_token_reaches_only_the_executor_routes(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    pid = packets(app, h)[0]["id"]
    for method, path in (("GET", "/v1/apply/setup"), ("PUT", "/v1/apply/setup"), ("GET", "/v1/apply/bank"),
                         ("PUT", "/v1/apply/bank"), ("POST", "/v1/apply/plan"), ("GET", "/v1/apply/packets"),
                         ("GET", f"/v1/apply/packets/{pid}"), ("POST", f"/v1/apply/packets/{pid}/answers"),
                         ("POST", f"/v1/apply/packets/{pid}/done"), ("POST", f"/v1/apply/packets/{pid}/retry"),
                         ("GET", f"/v1/apply/packets/{pid}/resume.pdf"), ("GET", "/v1/admin/apply/sites"),
                         ("POST", f"/v1/apply/{pid}/result/extra"), ("GET", "/v1/jobs/tracker")):
        r = app.request(method, path, headers=ext, json={})
        assert r.status_code in (403, 404, 405), (method, path, r.status_code)
        assert r.status_code != 200
    for path in ("/v1/apply/status", "/v1/apply/next"):
        assert app.get(path, headers=ext).status_code in (200, 204), path
    # A full sign-in can drive the executor too (the Windows app will).
    assert app.get("/v1/apply/status", headers=h).status_code == 200
    # Signed out: nothing.
    assert app.get("/v1/apply/next").status_code == 401


def test_the_extension_pauses_and_resumes_the_same_switch_the_web_app_shows(app: TestClient) -> None:
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    assert app.get("/v1/apply/setup", headers=h).json()["executor_seen_at"] is None
    ext = ext_token(app, h)
    r = app.post("/v1/apply/pause", headers=ext)
    assert r.status_code == 200 and r.json() == {"paused": True}
    assert app.get("/v1/apply/setup", headers=h).json()["paused"] is True
    s = app.get("/v1/apply/status", headers=ext).json()
    assert s["paused"] is True and s["why_not"] == "paused"
    nothing = app.get("/v1/apply/next", headers=ext)
    assert nothing.status_code == 204 and nothing.headers["X-Orbit-Apply-Why"] == "paused"
    # The web app sees that an extension is asking for work (it tells the candidate to set one up until then).
    assert app.get("/v1/apply/setup", headers=h).json()["executor_seen_at"]
    assert app.post("/v1/apply/resume", headers=ext).json() == {"paused": False}
    assert app.get("/v1/apply/setup", headers=h).json()["paused"] is False
    assert app.get("/v1/apply/next", headers=ext).status_code == 200


def test_a_submission_without_a_screenshot_keeps_the_confirmation_as_proof(app: TestClient) -> None:
    # The extension can't capture the page (no access to every site): the confirmation text and address are the proof.
    h, _ = account(app)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    p = app.get("/v1/apply/next", headers=ext).json()
    r = app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={
        "status": "submitted", "reason": None, "unknown_questions": [], "screenshot_png_b64": None,
        "confirmation_text": "Thank you for applying.", "final_url": "https://jobs.ashbyhq.com/sarvam/x/application",
        "submitted": {"fields": {"email": "asha@example.com"}, "answers": [{"question_id": "q1", "label": "Sponsorship",
                                                                            "value": "No"}]}})
    assert r.status_code == 200 and r.json()["charged"] is True
    detail = app.get(f"/v1/apply/packets/{p['id']}", headers=h).json()
    assert detail["has_proof"] is True and detail["screenshot_url"] is None
    assert detail["confirmation_text"] == "Thank you for applying." and detail["final_url"].startswith("https://")
    summary = next(x for x in app.get("/v1/apply/packets?group=applied", headers=h).json() if x["id"] == p["id"])
    assert summary["has_proof"] is True


def test_deleting_the_account_deletes_its_packets_and_proof(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    jobs(app)
    plan(app, h)
    ext = ext_token(app, h)
    p = app.get("/v1/apply/next", headers=ext).json()
    app.post(f"/v1/apply/{p['id']}/result", headers=ext, json={"status": "submitted", "screenshot_png_b64": png()})
    r = app.request("DELETE", "/v1/auth/me", headers=h, json={"password": "correct horse battery"})
    assert r.status_code == 204, r.text

    async def left() -> tuple[int, int, int]:
        async with sessionmaker()() as db:
            return (len((await db.scalars(select(ApplicationPacket).where(ApplicationPacket.user_id == uid))).all()),
                    len((await db.scalars(select(ApplyProof).where(ApplyProof.user_id == uid))).all()),
                    len((await db.scalars(select(JobApplication).where(JobApplication.user_id == uid))).all()))
    assert run(app, left) == (0, 0, 0)


def test_the_lever_fixture_job_id_matches(app: TestClient) -> None:
    # Keeps the recorded Lever page and the fixture listing in step.
    from tests.autoapply_helpers import lever_page

    assert LEVER_ID and "cards[" in lever_page()
