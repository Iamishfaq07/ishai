"""Orbit for Business: regression tests for the findings of the PR #400 review that #401 didn't fix (D82, amendments).
Each test names the finding it reproduces. The prompt-injection tests (finding 6) are in test_business_ai.py."""

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.business import emails, rules
from orbit_api.business.retention import sweep
from orbit_api.models import BizApplication, BizJob
from tests.business_helpers import (
    GOOD_ANSWERS,
    applications,
    apply_signed_out,
    auth,
    confirm_applicant,
    db_call,
    grant,
    mail_to,
    make_client,
    new_company,
    new_job,
    register,
    status_token,
    tag,
    uid,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    gen = make_client(monkeypatch, ORBIT_ADMIN_EMAIL=f"admin-{tag()}@example.com",
                      ORBIT_WEB_URL="https://orbitanswer.test")
    c = next(gen)
    yield c
    gen.close()


def _one(client: TestClient, h: dict[str, str], cid: str, jid: str) -> dict[str, Any]:
    [item] = applications(client, h, cid, jid)["items"]
    return item


def _orbit_resume(client: TestClient, h: dict[str, str]) -> str:
    from orbit_api.models import Resume

    data = {"basics": {"name": "Kiran Rao", "headline": "Backend engineer", "email": "kiran@example.com"},
            "experience": [{"title": "Engineer", "company": "Rocketly", "start": "2019", "current": True,
                            "bullets": ["Built Python services on Postgres and Kubernetes"]}],
            "skills": [{"name": "Backend", "items": ["Python", "Postgres", "Kubernetes"]}]}

    async def go(db: Any) -> str:
        r = Resume(user_id=uid(h), title="My resume", data=data, design={})
        db.add(r)
        await db.flush()
        return str(r.id)

    return str(db_call(client, go))


def _one_click(client: TestClient, h: dict[str, str], job_id: str) -> Any:
    return client.post(f"/v1/business/apply/{job_id}", headers=auth(h), json={
        "resume_id": _orbit_resume(client, h), "answers": GOOD_ANSWERS, "consent": True,
        "notice_version": rules.NOTICE_VERSION})


def _admin(client: TestClient) -> dict[str, str]:
    from orbit_api.config import get_settings

    return register(client, get_settings().admin_email or "", "Orbit Admin")


def _invite(client: TestClient, owner: dict[str, str], cid: str, email: str, role: str = "recruiter") -> Any:
    return client.post(f"/v1/business/companies/{cid}/invites", headers=auth(owner),
                       json={"email": email, "role": role})


def _invite_token(email: str) -> str:
    import re

    mail = [m for m in mail_to(email) if "/business/invite/" in m.text][-1]
    found = re.search(r"/business/invite/([\w-]+)", mail.text)
    assert found is not None
    return found.group(1)


def _member(client: TestClient, owner: dict[str, str], cid: str, role: str) -> dict[str, str]:
    email = f"{role}-{tag()}@example.com"
    assert _invite(client, owner, cid, email, role).status_code == 201
    h = register(client, email, f"{role.title()} Person")
    r = client.post("/v1/business/invites/accept", headers=auth(h), json={"token": _invite_token(email)})
    assert r.status_code == 200, r.text
    return h


# ---- 3. free mail, throwaway mail and public suffixes ---------------------------------------------------------------


def test_finding3_public_suffixes_are_refused_and_registrable_domains_compared() -> None:
    for bare in ("co.in", "https://com.au", "github.io", "www.co.uk", "blogspot.com", "vercel.app"):
        with pytest.raises(rules.DomainError):
            rules.domain_of(bare)
    assert rules.domain_of("https://jobs.acme.co.in/openings") == "acme.co.in"
    assert rules.domain_of("careers.acme.com.au") == "acme.com.au"
    assert rules.registrable_domain("eng.acme.com") == "acme.com" and rules.registrable_domain("co.in") is None
    for free in ("hotmail.fr", "hotmail.co.uk", "outlook.de", "outlook.com.br", "live.co.za", "live.in",
                 "yahoo.co.jp", "yahoo.fr", "gmx.at", "gmx.ch", "proton.me", "protonmail.ch", "duck.com",
                 "zohomail.in", "rediffmail.com", "mailinator.com", "10minutemail.com", "guerrillamail.com",
                 "acme.github.io", "acme.blogspot.com", "acme.vercel.app", "sites.google.com"):
        assert rules.blocked_domain(free), free
    for company in ("acme.com", "acme.co.in", "infosys.com", "tcs.com", "protonsoft.com", "livemint.com"):
        assert not rules.blocked_domain(company), company
    # A subdomain mailbox proves nothing by itself: email code and account verification need the domain exactly.
    assert rules.email_matches_domain("ana@acme.co.in", "acme.co.in")
    assert not rules.email_matches_domain("ana@eng.acme.co.in", "acme.co.in")
    assert not rules.email_matches_domain("ana@hotmail.fr", "hotmail.fr")


def test_finding3_bare_suffix_website_is_refused_by_the_api(client: TestClient) -> None:
    owner = register(client, f"o-{tag()}@example.com")
    for site in ("https://co.in", "github.io", "https://com.au/"):
        r = client.post("/v1/business/companies", headers=auth(owner), json={"name": "Acme", "website": site})
        assert r.status_code == 422, site
    r = client.post("/v1/business/companies", headers=auth(owner),
                    json={"name": "Acme", "website": "https://jobs.acme-" + tag() + ".co.in"})
    assert r.status_code == 201 and r.json()["domain"].endswith(".co.in") and "jobs." not in r.json()["domain"]


def test_finding3_subdomain_mailbox_verifies_only_by_dns(client: TestClient) -> None:
    domain = f"acme-{tag()}.com"
    owner = register(client, f"owner@eng.{domain}", "Olivia Owner")
    c = client.post("/v1/business/companies", headers=auth(owner),
                    json={"name": "Acme", "website": f"https://{domain}"}).json()
    base = f"/v1/business/companies/{c['id']}/verification"
    assert client.get(base, headers=auth(owner)).json()["account_email_matches"] is False
    assert client.post(f"{base}/account", headers=auth(owner)).status_code == 422
    sent = client.post(f"{base}/email", headers=auth(owner), json={"email": f"hr@eng.{domain}"})
    assert sent.status_code == 422 and "DNS" in sent.json()["detail"]
    assert client.post(f"{base}/email", headers=auth(owner), json={"email": f"hr@{domain}"}).status_code == 200


def test_finding3_the_public_badge_names_the_verified_domain(client: TestClient) -> None:
    owner, company, domain = new_company(client)
    job = new_job(client, owner, company["id"])
    pub = client.get(f"/v1/public/business/companies/{company['slug']}").json()
    assert pub["verified"] is True and pub["verified_domain"] == domain
    page = client.get(f"/v1/public/business/companies/{company['slug']}/jobs/{job['slug']}").json()
    assert page["company"]["verified_domain"] == domain
    _, unverified, _ = new_company(client, verified=False)
    assert client.get(f"/v1/public/business/companies/{unverified['slug']}").json()["verified_domain"] is None


# ---- 4. no email relay through the apply form -----------------------------------------------------------------------


def test_finding4_company_emails_wait_for_a_confirmed_address(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    client.put(f"/v1/business/companies/{cid}/templates/received", headers=auth(owner),
               json={"subject": "Win a prize", "body": "Click http://evil.example/{{status_link}}"}).raise_for_status()
    job = new_job(client, owner, cid)
    victim = f"victim-{tag()}@example.com"
    apply_signed_out(client, job["id"], victim).raise_for_status()
    [only] = mail_to(victim)
    assert only.subject.startswith("Confirm your application") and "evil.example" not in only.text
    assert "If you didn't apply, ignore this email" in only.text
    app_id = _one(client, owner, cid, job["id"])["id"]
    base = f"/v1/business/companies/{cid}/applications"
    custom = client.post(f"{base}/{app_id}/email", headers=auth(owner),
                         json={"subject": "Hello", "body": "Buy now at http://evil.example"})
    assert custom.status_code == 409 and custom.json()["detail"]["code"] == "biz_email_unconfirmed"
    assert "Waiting for the applicant to confirm their email" in custom.json()["detail"]["message"]
    slots = [(datetime.now(UTC) + timedelta(days=2, hours=h)).replace(microsecond=0).isoformat() for h in (0, 2, 4)]
    iv = client.post(f"{base}/{app_id}/interview", headers=auth(owner),
                     json={"slots": slots, "location": "http://evil.example", "message": "Pay a fee first"})
    assert iv.status_code == 409 and iv.json()["detail"]["code"] == "biz_email_unconfirmed"
    moved = client.post(f"{base}/move", headers=auth(owner), json={"ids": [app_id], "stage_id": "screen",
                                                                   "notify": True})
    assert moved.status_code == 200 and moved.json()["emails_waiting"] == 1
    rej = client.post(f"{base}/reject", headers=auth(owner), json={
        "ids": [app_id], "send_email": True, "subject": "Prize!", "body": "Visit http://evil.example"})
    assert rej.status_code == 200 and rej.json()["emails_waiting"] == 1
    assert len(mail_to(victim)) == 1  # only Orbit's own confirmation ever went out
    # Once the address is confirmed, the company's emails go out.
    confirm_applicant(client, victim)
    client.post(f"{base}/{app_id}/unreject", headers=auth(owner)).raise_for_status()
    ok = client.post(f"{base}/{app_id}/email", headers=auth(owner), json={"subject": "Hello", "body": "Hi there"})
    assert ok.status_code == 200 and any(m.subject == "Hello" for m in mail_to(victim))


def test_finding4_one_click_applicants_count_as_confirmed(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    client.put(f"/v1/business/companies/{cid}/templates/received", headers=auth(owner),
               json={"subject": "Thanks {{candidate_name}}", "body": "Our words: {{status_link}}"}).raise_for_status()
    job = new_job(client, owner, cid)
    email = f"kiran-{tag()}@example.com"
    cand = register(client, email, "Kiran Rao")
    _one_click(client, cand, job["id"]).raise_for_status()
    assert any(m.subject == "Thanks Kiran" for m in mail_to(email))
    app_id = _one(client, owner, cid, job["id"])["id"]
    r = client.post(f"/v1/business/companies/{cid}/applications/{app_id}/email", headers=auth(owner),
                    json={"kind": "stage"})
    assert r.status_code == 200


# ---- 7. retention and deletion ---------------------------------------------------------------------------------------


def _set(client: TestClient, model: Any, row_id: str, **values: Any) -> None:
    async def go(db: Any) -> None:
        row = await db.get(model, row_id)
        for k, v in values.items():
            setattr(row, k, v)

    db_call(client, go)


def _exists(client: TestClient, app_id: str) -> bool:
    async def go(db: Any) -> bool:
        return await db.get(BizApplication, app_id) is not None

    return bool(db_call(client, go))


def test_finding7_retention_is_the_one_in_effect_when_they_applied(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"early-{tag()}@example.com").raise_for_status()
    early = _one(client, owner, cid, job["id"])["id"]
    patched = client.patch(f"/v1/business/companies/{cid}", headers=auth(owner), json={"retention_months": 1})
    assert patched.status_code == 200 and patched.json()["retention_months"] == 1
    apply_signed_out(client, job["id"], f"late-{tag()}@example.com").raise_for_status()
    late = next(i["id"] for i in applications(client, owner, cid, job["id"])["items"] if i["id"] != early)
    client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner),
                json={"ids": [early, late]}).raise_for_status()
    for app_id in (early, late):
        _set(client, BizApplication, app_id, rejected_at=datetime.now(UTC) - timedelta(days=60))
    client.portal.call(sweep)  # type: ignore[union-attr]
    # The early applicant was told 12 months: two months on, a change to 1 month doesn't shorten it.
    assert _exists(client, early) and not _exists(client, late)

    async def kept(db: Any) -> tuple[int, int]:
        app = await db.get(BizApplication, early)
        return app.retention_months, app.consent["retention_months"]

    assert db_call(client, kept) == (12, 12)


def test_finding7_active_applications_on_long_closed_jobs_are_deleted(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    grant(client, cid, "starter")
    old_job = new_job(client, owner, cid, title="Old role")
    new = new_job(client, owner, cid, title="New role")
    for j in (old_job, new):
        apply_signed_out(client, j["id"], f"a-{tag()}@example.com").raise_for_status()
        client.post(f"/v1/business/companies/{cid}/jobs/{j['id']}/close", headers=auth(owner)).raise_for_status()
    stale = _one(client, owner, cid, old_job["id"])["id"]
    recent = _one(client, owner, cid, new["id"])["id"]
    _set(client, BizJob, old_job["id"], closed_at=datetime.now(UTC) - timedelta(days=400))
    _set(client, BizJob, new["id"], closed_at=datetime.now(UTC) - timedelta(days=30))
    out = client.portal.call(sweep)  # type: ignore[union-attr]
    assert out["deleted"] >= 1
    assert not _exists(client, stale) and _exists(client, recent)
    log = client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()
    assert any(e["action"] == "retention.deleted" and e["detail"].get("reason") == "job_closed" for e in log)


def test_finding7_hired_applications_on_closed_jobs_stay(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"h-{tag()}@example.com").raise_for_status()
    app_id = _one(client, owner, cid, job["id"])["id"]
    client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(owner),
                json={"ids": [app_id], "stage_id": "hired"}).raise_for_status()
    client.post(f"/v1/business/companies/{cid}/jobs/{job['id']}/close", headers=auth(owner)).raise_for_status()
    _set(client, BizJob, job["id"], closed_at=datetime.now(UTC) - timedelta(days=800))
    client.portal.call(sweep)  # type: ignore[union-attr]
    assert _exists(client, app_id)


def test_finding7_deletion_requests_are_carried_out_after_30_days_with_reminders(client: TestClient) -> None:
    owner, company, domain = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    email = f"forget-{tag()}@example.com"
    apply_signed_out(client, job["id"], email).raise_for_status()
    token = status_token(email)
    client.post(f"/v1/public/business/applications/{token}/delete-request").raise_for_status()
    app_id = _one(client, owner, cid, job["id"])["id"]
    asked = next(m for m in mail_to(f"owner@{domain}") if "asked for their application to be deleted" in m.subject)
    assert "30 days" in asked.text

    def reminders() -> list[str]:
        return [m.subject for m in mail_to(f"owner@{domain}") if m.subject.startswith("Reminder:")]

    now = datetime.now(UTC)
    _set(client, BizApplication, app_id, deletion_requested_at=now - timedelta(days=10))
    client.portal.call(sweep)  # type: ignore[union-attr]
    assert reminders() == [] and _exists(client, app_id)
    _set(client, BizApplication, app_id, deletion_requested_at=now - timedelta(days=23, hours=1))
    client.portal.call(sweep)  # type: ignore[union-attr]
    client.portal.call(sweep)  # type: ignore[union-attr]  # a second sweep the same day sends nothing new
    assert len(reminders()) == 1 and "7 days" in reminders()[0]
    _set(client, BizApplication, app_id, deletion_requested_at=now - timedelta(days=29, hours=1))
    client.portal.call(sweep)  # type: ignore[union-attr]
    assert len(reminders()) == 2 and "1 day" in reminders()[1] and _exists(client, app_id)
    _set(client, BizApplication, app_id, deletion_requested_at=now - timedelta(days=30, minutes=1))
    client.portal.call(sweep)  # type: ignore[union-attr]
    assert not _exists(client, app_id)
    assert client.get(f"/v1/public/business/applications/{token}").status_code == 404
    log = client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()
    assert any(e["action"] == "retention.deleted" and e["detail"].get("reason") == "request" for e in log)


def test_finding7_the_notice_says_so() -> None:
    text = rules.notice_text("Acme", 6)
    assert "6 months after the job closes" in text and "within 30 days of your request" in text
    assert rules.NOTICE_VERSION != "2026-10-19.1"


# ---- 8. status tokens -----------------------------------------------------------------------------------------------


def test_finding8_status_tokens_are_random_and_stored_sealed(client: TestClient) -> None:
    from orbit_api.config import get_settings

    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    email = f"tok-{tag()}@example.com"
    apply_signed_out(client, job["id"], email).raise_for_status()
    token = confirm_applicant(client, email)
    app_id = _one(client, owner, cid, job["id"])["id"]
    key = get_settings().jwt_secret.get_secret_value().encode()
    legacy = base64.urlsafe_b64encode(hmac.new(key, f"biz-status:{app_id}".encode(), hashlib.sha256).digest()
                                      ).decode().rstrip("=")
    assert token != legacy and len(token) >= 40

    async def row(db: Any) -> tuple[str, str | None]:
        app = await db.get(BizApplication, app_id)
        return app.status_token_hash, app.status_token_sealed

    token_hash, sealed = db_call(client, row)
    assert token_hash == rules.digest(token) and sealed and token not in sealed
    assert rules.open_status_token(sealed, token_hash) == token
    assert rules.open_status_token(sealed, "0" * 64) is None and rules.open_status_token(None, token_hash) is None
    # A later email carries the same link.
    client.post(f"/v1/business/companies/{cid}/applications/{app_id}/email", headers=auth(owner),
                json={"kind": "stage"}).raise_for_status()
    assert status_token(email) == token


def test_finding8_the_migration_keeps_existing_links_working() -> None:
    from cryptography.fernet import Fernet

    from orbit_api.config import get_settings

    api = Path(__file__).resolve().parents[1]
    db = Path(tempfile.mkdtemp(prefix="orbit-biz-m-")) / "m.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    alembic("upgrade", "4a93a7c927ef")  # the parent of 25f71d009e96
    s = get_settings()
    secret = s.jwt_secret.get_secret_value()
    app_id = "00000000-0000-4000-8000-000000000001"
    legacy = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"biz-status:{app_id}".encode(), hashlib.sha256)
                                      .digest()).decode().rstrip("=")
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db) as conn:
        conn.execute("insert into biz_companies (id, slug, name, website, domain, size, country, about, logo_version, "
                     "status, dns_token, email_code_tries, plan, retention_months, blind_review, updated_at, "
                     "created_at) values ('c1', 'acme', 'Acme', 'https://acme.com', 'acme.com', '1-10', 'IN', '', 0, "
                     "'active', 't', 0, 'free', 6, 0, ?, ?)", (now, now))
        conn.execute("insert into biz_applications (id, reference, company_id, job_id, name, email, resume_text, "
                     "resume_source, answers, knockout_failed, knockout_reasons, source, consent, status_token_hash, "
                     "stage_id, status, stage_changed_at, tags, interviewers, ranking_status, updated_at, created_at) "
                     "values (?, 'A-AAAAAA', 'c1', 'j1', 'P', 'p@example.com', '', 'upload', '[]', 0, '[]', 'careers', "
                     "'{}', ?, 'applied', 'active', ?, '[]', '[]', 'done', ?, ?)",
                     (app_id, hashlib.sha256(legacy.encode()).hexdigest(), now, now, now))
    alembic("upgrade", "head")
    with sqlite3.connect(db) as conn:
        sealed, months, reminders = conn.execute(
            "select status_token_sealed, retention_months, deletion_reminders from biz_applications").fetchone()
    source = s.config_secret.get_secret_value() if s.config_secret else "biz-status:" + secret
    opened = Fernet(base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest())).decrypt(sealed.encode())
    assert opened.decode() == legacy and months == 6 and reminders == 0
    alembic("downgrade", "-1")
    with sqlite3.connect(db) as conn:
        cols = {r[1] for r in conn.execute("pragma table_info(biz_applications)")}
        assert "status_token_sealed" not in cols and conn.execute("select count(*) from biz_applications"
                                                                  ).fetchone()[0] == 1
    alembic("upgrade", "head")


# ---- 9. the sanitizer never cuts its output ----------------------------------------------------------------------


def test_finding9_sanitized_output_is_never_sliced() -> None:
    # Text that grows when escaped ("<" becomes "&lt;"): the old code cut the output mid-entity.
    near = "<p>" + "a < b " * 6000 + "</p>"
    with pytest.raises(rules.DescriptionTooLong):
        rules.sanitize_html(near)
    fine = "<p>" + "a &lt; b " * 1000 + "</p>"
    out = rules.sanitize_html(fine)
    assert out.endswith("</p>") and out.count("&lt;") == 1000
    # The input is bounded before parsing, and a result over the limit is refused, never cut.
    with pytest.raises(rules.DescriptionTooLong):
        rules.sanitize_html("<p>" + "x" * (rules.MAX_DESCRIPTION * 3) + "</p>")
    out = rules.sanitize_html("<p>" + "x" * (rules.MAX_DESCRIPTION * 2 - 20) + "</p>")
    assert out.startswith("<p>") and out.endswith("</p>")


def test_finding9_too_long_a_description_is_a_422(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    r = client.post(f"/v1/business/companies/{company['id']}/jobs", headers=auth(owner),
                    json={"title": "Engineer", "description_html": "<p>" + "a < b " * 6000 + "</p>"})
    assert r.status_code == 422 and "too long" in r.text


# ---- 10. control characters out of titles, names and subjects -------------------------------------------------------


def test_finding10_control_characters_are_stripped(client: TestClient) -> None:
    assert rules.one_line("Engineer\r\nBcc: victim@example.com\t\x00") == "Engineer Bcc: victim@example.com"
    owner, company, _ = new_company(client, name="Acme\r\nBcc: x@example.com")
    assert company["name"] == "Acme Bcc: x@example.com"
    cid = company["id"]
    job = new_job(client, owner, cid, title="Backend\r\nX-Injected: 1\tEngineer")
    assert job["title"] == "Backend X-Injected: 1 Engineer"
    renamed = client.patch(f"/v1/business/companies/{cid}", headers=auth(owner), json={"name": "Acme\nLtd"})
    assert renamed.json()["name"] == "Acme Ltd"
    t = client.put(f"/v1/business/companies/{cid}/templates/stage", headers=auth(owner),
                   json={"subject": "Update\r\nBcc: x@example.com {{candidate_name}}", "body": "Hi"})
    assert t.json()["subject"] == "Update Bcc: x@example.com {{candidate_name}}"
    # A rendered subject (the applicant's own name can carry a line break) is one line too.
    email = f"crlf-{tag()}@example.com"
    apply_signed_out(client, job["id"], email, name="Priya\r\nBcc: z@example.com").raise_for_status()
    confirm_applicant(client, email)
    app_id = _one(client, owner, cid, job["id"])["id"]
    client.post(f"/v1/business/companies/{cid}/applications/{app_id}/email", headers=auth(owner),
                json={"subject": "Hi {{candidate_name}}\n{{job_title}}", "body": "x"}).raise_for_status()
    for m in mail_to(email):
        assert "\r" not in m.subject and "\n" not in m.subject, m.subject


# ---- 11. the calendar file ------------------------------------------------------------------------------------------


def test_finding11_ics_escapes_cr_and_folds_at_75_octets() -> None:
    long_place = "Conference room 4, Tower B — Prestige Tech Park, Outer Ring Road, Bengaluru 560103, India · 4th floor"
    cal = emails.ics(uid="u1", start=datetime(2031, 1, 2, 10, tzinfo=UTC), minutes=30,
                     summary="Interview: Engineer\rX-INJECTED:1", description="Line one\r\nLine two\rLine three",
                     location=long_place, organizer="hr@acme.com").decode()
    lines = cal.split("\r\n")
    assert all(len(line.encode()) <= 75 for line in lines)
    assert not any(line.startswith("X-INJECTED") for line in lines) and "\r" not in cal.replace("\r\n", "")
    unfolded = cal.replace("\r\n ", "")
    assert "SUMMARY:Interview: Engineer\\nX-INJECTED:1" in unfolded
    assert "DESCRIPTION:Line one\\nLine two\\nLine three" in unfolded
    assert "LOCATION:" + long_place.replace(",", "\\,") in unfolded  # folded, never split inside a character
    assert cal.endswith("END:VCALENDAR\r\n")


# ---- 12. an unconfirmed application doesn't hold a person's place ----------------------------------------------------


def test_finding12_one_click_replaces_an_unconfirmed_signed_out_application(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    email = f"squat-{tag()}@example.com"
    apply_signed_out(client, job["id"], email, name="Someone Else").raise_for_status()  # a stranger typed it
    squatter = _one(client, owner, cid, job["id"])
    cand = register(client, email, "Kiran Rao")
    prev = client.get(f"/v1/business/apply/{job['id']}/preview", headers=auth(cand)).json()
    assert prev["already_applied"] is False
    r = _one_click(client, cand, job["id"])
    assert r.status_code == 200 and r.json()["status"] == "applied"
    item = _one(client, owner, cid, job["id"])
    assert item["id"] != squatter["id"] and item["via_orbit"] is True and item["email_confirmed"] is True
    log = client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()
    assert any(e["action"] == "application.replaced" and e["target"] == squatter["reference"] for e in log)
    # The one-click application is never replaced by a signed-out one.
    apply_signed_out(client, job["id"], email).raise_for_status()
    assert _one(client, owner, cid, job["id"])["id"] == item["id"]


def test_finding12_the_bot_check_comes_before_the_per_email_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import ratelimit
    from orbit_api.auth import captcha

    async def fake_verify(token: str, ip: str | None) -> bool:
        return token == "good-token"

    from pydantic import SecretStr

    from orbit_api.config import get_settings

    monkeypatch.setattr(captcha, "_verify_turnstile", fake_verify)
    gen = make_client(monkeypatch)
    client = next(gen)
    try:
        owner, company, _ = new_company(client)
        job = new_job(client, owner, company["id"])
        s = get_settings()
        monkeypatch.setattr(s, "captcha_provider", "turnstile")
        monkeypatch.setattr(s, "turnstile_site_key", "k")
        monkeypatch.setattr(s, "turnstile_secret_key", SecretStr("s"))
        assert s.captcha_active
        monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
        monkeypatch.setattr(ratelimit, "client_network", lambda request: f"net-{tag()}")  # not the IP limit
        victim = f"limit-{tag()}@example.com"
        for _ in range(6):  # a bot without a solved check can't use up the address's daily allowance
            assert apply_signed_out(client, job["id"], victim, captcha_token="bad").status_code == 400
        ok = apply_signed_out(client, job["id"], victim, captcha_token="good-token")
        assert ok.status_code == 200 and ok.json()["status"] == "applied"
    finally:
        gen.close()


# ---- 14. plan limits under concurrency -------------------------------------------------------------------------------


def _together(n: int, fn: Any) -> list[Any]:
    barrier = Barrier(n)

    def one(i: int) -> Any:
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(one, range(n)))


def test_finding14_concurrent_publishes_cannot_pass_the_job_limit(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    drafts = [new_job(client, owner, cid, publish=False, title=f"Role {i}") for i in range(4)]
    codes = _together(4, lambda i: client.post(f"/v1/business/companies/{cid}/jobs/{drafts[i]['id']}/publish",
                                               headers=auth(owner)).status_code)
    assert sorted(codes) == [200, 402, 402, 402], codes
    plan = client.get(f"/v1/business/companies/{cid}/plan", headers=auth(owner)).json()
    assert plan["active_jobs"] == 1


def test_finding14_concurrent_invites_cannot_pass_the_seat_limit(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    grant(client, cid, "starter")  # 3 seats: the owner and two more
    codes = _together(5, lambda i: _invite(client, owner, cid, f"seat{i}-{tag()}@example.com").status_code)
    assert sorted(codes) == [201, 201, 402, 402, 402], codes
    assert client.get(f"/v1/business/companies/{cid}/members", headers=auth(owner)).json()["seats_used"] == 3


def test_finding14_concurrent_accepts_are_a_clean_conflict(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    grant(client, cid, "starter")
    email = f"twice-{tag()}@example.com"
    assert _invite(client, owner, cid, email).status_code == 201
    h = register(client, email, "Rae Recruiter")
    token = _invite_token(email)
    codes = _together(4, lambda i: client.post("/v1/business/invites/accept", headers=auth(h),
                                               json={"token": token}).status_code)
    assert codes.count(200) == 1 and all(c in {200, 400, 409} for c in codes), codes
    members = client.get(f"/v1/business/companies/{cid}/members", headers=auth(owner)).json()["members"]
    assert sum(1 for m in members if m["user_id"] == uid(h)) == 1


# ---- 15. suspended companies can't act; re-ranking is limited ----------------------------------------------------


def test_finding15_a_suspended_company_cant_write(client: TestClient) -> None:
    admin = _admin(client)
    owner, company, _ = new_company(client, verified=False)
    cid = company["id"]
    grant(client, cid, "starter")
    rec = _member(client, owner, cid, "recruiter")
    members = client.get(f"/v1/business/companies/{cid}/members", headers=auth(owner)).json()["members"]
    rec_member = next(m["id"] for m in members if m["user_id"] == uid(rec))
    pending = _invite(client, owner, cid, f"p-{tag()}@example.com").json()["invites"][0]["id"]
    client.post(f"/v1/admin/business/companies/{cid}/suspend", headers=auth(admin),
                json={"reason": "Fake employer"}).raise_for_status()
    base = f"/v1/business/companies/{cid}"
    attempts = [
        ("DELETE", f"{base}/logo", None),
        ("DELETE", f"{base}/members/{rec_member}", None),
        ("DELETE", f"{base}/invites/{pending}", None),
        ("POST", f"{base}/verification/account", None),
        ("POST", f"{base}/verification/email", {"email": f"hr@{company['domain']}"}),
        ("POST", f"{base}/verification/email/confirm", {"code": "123456"}),
        ("POST", f"{base}/verification/dns", None),
        ("POST", f"{base}/plan/request", {"plan": "growth"}),
        ("DELETE", f"{base}/templates/stage", None),
    ]
    for method, path, body in attempts:
        r = client.request(method, path, headers=auth(owner), json=body)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "biz_suspended", (path, r.status_code, r.text)
    assert client.get(base, headers=auth(owner)).status_code == 200  # reads still work


def test_finding15_rerank_is_writable_only_and_rate_limited(client: TestClient,
                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import ratelimit

    admin = _admin(client)
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"rr-{tag()}@example.com").raise_for_status()
    app_id = _one(client, owner, cid, job["id"])["id"]
    path = f"/v1/business/companies/{cid}/applications/{app_id}/rerank"
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    assert client.post(path, headers=auth(owner)).status_code == 200
    again = client.post(path, headers=auth(owner))
    assert again.status_code == 429 and "10 minutes" in again.text
    client.post(f"/v1/admin/business/companies/{cid}/suspend", headers=auth(admin),
                json={"reason": "Fake employer"}).raise_for_status()
    s = client.post(path, headers=auth(owner))
    assert s.status_code == 403 and s.json()["detail"]["code"] == "biz_suspended"


# ---- 16. blind review hides the name everywhere ---------------------------------------------------------------------


def test_finding16_blind_review_masks_email_subjects_answers_and_parsed_experience(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    client.patch(f"/v1/business/companies/{cid}", headers=auth(owner), json={"blind_review": True}).raise_for_status()
    job = new_job(client, owner, cid, questions=[
        {"id": "about", "text": "Tell us about yourself", "kind": "short_text", "required": True}])
    email = f"priya-{tag()}@example.com"
    apply_signed_out(client, job["id"], email, answers=[
        {"question_id": "about", "answer": f"I'm Priya Sharma, mail me at {email} or +91 98765 43210, "
                                           "see https://priya.dev. I build Python services."}]).raise_for_status()
    confirm_applicant(client, email)
    item = applications(client, owner, cid, job["id"])["items"][0]
    base = f"/v1/business/companies/{cid}/applications/{item['id']}"
    client.post(f"{base}/email", headers=auth(owner),
                json={"subject": "Hi {{candidate_name}}, next steps", "body": "Talk soon"}).raise_for_status()

    async def parsed(db: Any) -> None:
        app = await db.get(BizApplication, item["id"])
        app.parsed = {"headline": "Priya Sharma, backend engineer", "total_years": 6, "skills": ["Python"],
                      "experience": [{"title": "Engineer", "company": "Rocketly",
                                      "summary": "Priya led the Python platform; priya@example.com"}],
                      "education": []}

    db_call(client, parsed)
    d = client.get(base, headers=auth(owner)).json()
    blob = json.dumps({k: d[k] for k in ("timeline", "answers", "parsed", "headline")})
    for leak in ("Priya", "Sharma", email, "98765", "priya.dev", "priya@example.com"):
        assert leak not in blob, leak
    assert any(e["text"] == "Emailed: Hi {{candidate_name}}, next steps" for e in d["timeline"])
    assert "I build Python services" in d["answers"][0]["answer"]
    assert "Python platform" in d["parsed"]["experience"][0]["summary"]
    # Revealed (and logged), the real subject is there.
    shown = client.get(f"{base}?reveal=true", headers=auth(owner)).json()
    assert any(e["text"] == "Emailed: Hi Priya, next steps" for e in shown["timeline"])
    assert "Priya Sharma" in shown["answers"][0]["answer"]


# ---- 17. a member who leaves leaves every team ----------------------------------------------------------------------


def test_finding17_removing_a_member_takes_them_off_hiring_teams_and_interviews(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    grant(client, cid, "starter")
    hm = _member(client, owner, cid, "hiring_manager")
    iv = _member(client, owner, cid, "interviewer")
    job = new_job(client, owner, cid, hiring_team=[uid(hm), uid(owner)])
    apply_signed_out(client, job["id"], f"t-{tag()}@example.com").raise_for_status()
    app_id = _one(client, owner, cid, job["id"])["id"]
    client.patch(f"/v1/business/companies/{cid}/applications/{app_id}", headers=auth(owner),
                 json={"interviewers": [uid(iv), uid(hm)]}).raise_for_status()
    members = client.get(f"/v1/business/companies/{cid}/members", headers=auth(owner)).json()["members"]
    for h in (hm, iv):
        mid = next(m["id"] for m in members if m["user_id"] == uid(h))
        client.delete(f"/v1/business/companies/{cid}/members/{mid}", headers=auth(owner)).raise_for_status()

    async def lists(db: Any) -> tuple[list[str], list[str]]:
        j = await db.get(BizJob, job["id"])
        a = await db.get(BizApplication, app_id)
        return list(j.hiring_team), list(a.interviewers)

    team, interviewers = db_call(client, lists)
    assert team == [uid(owner)] and interviewers == []


def test_finding17_leaving_does_the_same(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    grant(client, cid, "starter")
    hm = _member(client, owner, cid, "hiring_manager")
    job = new_job(client, owner, cid, hiring_team=[uid(hm)])
    client.post(f"/v1/business/companies/{cid}/leave", headers=auth(hm)).raise_for_status()
    got = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(owner)).json()
    assert got["hiring_team"] == []
