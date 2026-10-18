"""Orbit for Business, the workspace (D82): creating a company, verification (account email, work-email code, DNS;
free-mail and hosting domains refused; unverified companies draft but can't publish), members and invites with
seats, roles enforced in the API, tenant isolation between companies, plan limits, the Orbit admin's review
(suspend, verify, grant a plan, take a job down, reports), the append-only audit log, and the migration."""

import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.business import companies as companies_mod
from orbit_api.business import rules
from orbit_api.business.access import AuditImmutable
from orbit_api.models import BizAudit
from tests.business_helpers import (
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
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    gen = make_client(monkeypatch, ORBIT_ADMIN_EMAIL=f"admin-{uuid.uuid4().hex[:8]}@example.com")
    c = next(gen)
    yield c
    gen.close()


def _admin(client: TestClient) -> dict[str, str]:
    from orbit_api.config import get_settings

    return register(client, get_settings().admin_email or "", "Orbit Admin")


# ---- rules ---------------------------------------------------------------------------------------------------------


def test_domains_free_mail_and_hosting_cannot_prove_a_company() -> None:
    assert rules.domain_of("https://www.Acme.com/careers") == "acme.com"
    assert rules.domain_of("acme.co.in") == "acme.co.in"
    for bad in ("http://127.0.0.1", "ftp://acme.com", "localhost", "https://intranet.local"):
        with pytest.raises(rules.DomainError):
            rules.domain_of(bad)
    for blocked in ("gmail.com", "outlook.com", "sites.google.com", "acme.github.io", "acme.wixsite.com"):
        assert rules.blocked_domain(blocked), blocked
    assert not rules.blocked_domain("acme.com")
    assert rules.email_matches_domain("Ana@Acme.com", "acme.com")
    # A subdomain mailbox verifies only by DNS (finding 3).
    assert not rules.email_matches_domain("Ana@Eng.Acme.com", "acme.com")
    assert not rules.email_matches_domain("ana@acme.com.evil.io", "acme.com")
    assert not rules.email_matches_domain("ana@gmail.com", "gmail.com")


def test_permissions_table() -> None:
    assert rules.can("owner", "manage_plan") and not rules.can("admin", "manage_plan")
    assert rules.can("recruiter", "manage_jobs") and not rules.can("recruiter", "manage_members")
    assert rules.can("hiring_manager", "move_applicants") and not rules.can("hiring_manager", "all_jobs")
    assert not rules.can("interviewer", "move_applicants") and rules.can("interviewer", "scorecards_only")


# ---- companies and verification -------------------------------------------------------------------------------------


def test_create_company_needs_a_real_website_and_an_unproven_inbox_cannot_verify(client: TestClient) -> None:
    domain = f"nope-{tag()}.com"
    h = register(client, f"x@{domain}", verified=False)
    body = {"name": "Nope", "website": domain, "size": "1-10", "country": "IN"}
    c = client.post("/v1/business/companies", headers=auth(h), json=body).json()
    v = client.get(f"/v1/business/companies/{c['id']}/verification", headers=auth(h)).json()
    assert v["account_email_matches"] is False  # the address is at the domain, but its inbox isn't proven
    assert client.post(f"/v1/business/companies/{c['id']}/verification/account", headers=auth(h)).status_code == 422
    h2 = register(client, f"y-{tag()}@example.com")
    bad = client.post("/v1/business/companies", headers=auth(h2), json={**body, "website": "http://10.0.0.1"})
    assert bad.status_code == 422
    ok = client.post("/v1/business/companies", headers=auth(h2), json=body)
    assert ok.status_code == 201 and ok.json()["role"] == "owner" and ok.json()["verified"] is False
    assert ok.json()["slug"].startswith("nope") and ok.json()["permissions"]["manage_plan"] is True
    me = client.get("/v1/business/me", headers=auth(h2)).json()
    assert [c["id"] for c in me["companies"]] == [ok.json()["id"]]


def test_unverified_company_drafts_but_cannot_publish(client: TestClient) -> None:
    owner, company, _ = new_company(client, verified=False)
    job = new_job(client, owner, company["id"], publish=False)
    assert job["status"] == "draft"
    r = client.post(f"/v1/business/companies/{company['id']}/jobs/{job['id']}/publish", headers=auth(owner))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "biz_unverified"


def test_free_mail_website_can_never_verify(client: TestClient) -> None:
    h = register(client, f"someone-{tag()}@gmail.com")
    c = client.post("/v1/business/companies", headers=auth(h), json={
        "name": "Gmail Co", "website": "gmail.com", "size": "1-10", "country": "IN"}).json()
    v = client.get(f"/v1/business/companies/{c['id']}/verification", headers=auth(h)).json()
    assert v["blocked_domain"] is True and v["account_email_matches"] is False
    for path, body in (("account", None), ("email", {"email": "boss@gmail.com"}), ("dns", None)):
        r = client.post(f"/v1/business/companies/{c['id']}/verification/{path}", headers=auth(h), json=body)
        assert r.status_code == 422, path


def test_verify_by_work_email_code(client: TestClient) -> None:
    h = register(client, f"founder-{tag()}@example.com")
    domain = f"widgets-{tag()}.io"
    c = client.post("/v1/business/companies", headers=auth(h), json={
        "name": "Widgets", "website": domain, "size": "1-10", "country": "US"}).json()
    base = f"/v1/business/companies/{c['id']}/verification"
    assert client.post(f"{base}/account", headers=auth(h)).status_code == 422  # their login isn't at the domain
    assert client.post(f"{base}/email", headers=auth(h), json={"email": "a@other.io"}).status_code == 422
    r = client.post(f"{base}/email", headers=auth(h), json={"email": f"hr@{domain}"})
    assert r.status_code == 200 and r.json()["pending_email"].endswith(domain)
    [mail] = mail_to(f"hr@{domain}")
    code = re.search(r"Code: (\d{6})", mail.text).group(1)  # type: ignore[union-attr]
    wrong = "000000" if code != "000000" else "111111"
    assert client.post(f"{base}/email/confirm", headers=auth(h), json={"code": wrong}).status_code == 400
    ok = client.post(f"{base}/email/confirm", headers=auth(h), json={"code": code})
    assert ok.status_code == 200 and ok.json()["verified"] is True and ok.json()["method"] == "email"


def test_verify_by_dns_txt_record(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner, company, domain = new_company(client, verified=False)
    v = client.get(f"/v1/business/companies/{company['id']}/verification", headers=auth(owner)).json()
    assert v["dns"]["value"].startswith("orbit-verify=")
    records: dict[str, list[str]] = {}

    async def fake_txt(name: str) -> list[str]:
        return records.get(name, [])

    monkeypatch.setattr(companies_mod, "txt_records", fake_txt)
    miss = client.post(f"/v1/business/companies/{company['id']}/verification/dns", headers=auth(owner))
    assert miss.status_code == 422 and miss.json()["detail"]["code"] == "biz_dns_missing"
    records[f"_orbit-verify.{domain}"] = ["v=spf1 -all", v["dns"]["value"]]
    ok = client.post(f"/v1/business/companies/{company['id']}/verification/dns", headers=auth(owner))
    assert ok.status_code == 200 and ok.json()["verified"] and ok.json()["method"] == "dns"


def test_changing_the_website_domain_drops_verification(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    r = client.patch(f"/v1/business/companies/{company['id']}", headers=auth(owner),
                     json={"website": "https://another-domain.com"})
    assert r.status_code == 200 and r.json()["verified"] is False and r.json()["domain"] == "another-domain.com"


@pytest.mark.parametrize("target", ["https://google.com", "https://victim-brand.com"])
def test_a_code_sent_for_one_domain_never_verifies_another(client: TestClient, target: str) -> None:
    h = register(client, f"founder-{tag()}@example.com")
    domain = f"attacker-{tag()}.com"
    c = client.post("/v1/business/companies", headers=auth(h), json={
        "name": "Google", "website": domain, "size": "1-10", "country": "US"}).json()
    base = f"/v1/business/companies/{c['id']}/verification"
    assert client.post(f"{base}/email", headers=auth(h), json={"email": f"x@{domain}"}).status_code == 200
    [mail] = mail_to(f"x@{domain}")
    code = re.search(r"Code: (\d{6})", mail.text).group(1)  # type: ignore[union-attr]
    moved = client.patch(f"/v1/business/companies/{c['id']}", headers=auth(h), json={"website": target})
    assert moved.status_code == 200 and moved.json()["verified"] is False
    r = client.post(f"{base}/email/confirm", headers=auth(h), json={"code": code})
    assert r.status_code in (400, 422)
    v = client.get(base, headers=auth(h)).json()
    assert v["verified"] is False and v["pending_email"] is None


def test_the_domain_cant_change_under_open_jobs(client: TestClient) -> None:
    owner, company, domain = new_company(client)
    job = new_job(client, owner, company["id"])
    assert job["status"] == "open"
    r = client.patch(f"/v1/business/companies/{company['id']}", headers=auth(owner),
                     json={"website": "https://another-domain.com"})
    assert r.status_code == 409
    me = client.get(f"/v1/business/companies/{company['id']}", headers=auth(owner)).json()
    assert me["verified"] is True and me["domain"] == domain


def test_the_customer_audit_log_never_names_the_ai_model() -> None:
    detail = {"score": 80, "model_version": "rank-v1+score-v1+some-model", "ranking_model": "x", "stage": "Screen"}
    assert companies_mod.customer_detail(detail) == {"score": 80, "stage": "Screen"}
    assert companies_mod.customer_detail(None) == {}


def test_logo_upload_is_validated_and_public(client: TestClient) -> None:
    import io

    from PIL import Image

    owner, company, _ = new_company(client)
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, format="PNG")
    bad = client.put(f"/v1/business/companies/{company['id']}/logo", headers=auth(owner),
                     files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 422
    r = client.put(f"/v1/business/companies/{company['id']}/logo", headers=auth(owner),
                   files={"file": ("logo.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200 and r.json()["logo_url"]
    pub = client.get(f"/v1/public/business/companies/{company['slug']}/logo")
    assert pub.status_code == 200 and pub.headers["content-type"] == "image/png"


# ---- members, invites, seats ---------------------------------------------------------------------------------------


def _invite(client: TestClient, owner: dict[str, str], company_id: str, email: str, role: str) -> Any:
    return client.post(f"/v1/business/companies/{company_id}/invites", headers=auth(owner),
                       json={"email": email, "role": role})


def _accept(client: TestClient, h: dict[str, str], email: str) -> Any:
    mail = [m for m in mail_to(email) if "/business/invite/" in m.text][-1]
    token = re.search(r"/business/invite/([\w-]+)", mail.text).group(1)  # type: ignore[union-attr]
    return client.post("/v1/business/invites/accept", headers=auth(h), json={"token": token}), token


def add_member(client: TestClient, owner: dict[str, str], company_id: str, role: str,
               email: str | None = None) -> dict[str, str]:
    email = email or f"{role}-{tag()}@example.com"
    r = _invite(client, owner, company_id, email, role)
    assert r.status_code == 201, r.text
    h = register(client, email, f"{role.title()} Person")
    accepted, _ = _accept(client, h, email)
    assert accepted.status_code == 200, accepted.text
    return h


def test_free_plan_has_one_seat_and_a_granted_plan_adds_more(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    r = _invite(client, owner, company["id"], f"r-{tag()}@example.com", "recruiter")
    assert r.status_code == 402 and r.json()["detail"]["code"] == "biz_limit"
    assert r.json()["detail"]["limit"] == "seats"
    grant(client, company["id"], "starter")
    for i in range(2):
        assert _invite(client, owner, company["id"], f"r{i}-{tag()}@example.com", "recruiter").status_code == 201
    assert _invite(client, owner, company["id"], f"r9-{tag()}@example.com", "recruiter").status_code == 402
    members = client.get(f"/v1/business/companies/{company['id']}/members", headers=auth(owner)).json()
    assert members["seats"] == 3 and members["seats_used"] == 3 and len(members["invites"]) == 2


def test_invite_accept_only_by_the_invited_address(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    grant(client, company["id"], "starter")
    email = f"rec-{tag()}@example.com"
    assert _invite(client, owner, company["id"], email, "recruiter").status_code == 201
    other = register(client, f"other-{tag()}@example.com")
    wrong, token = _accept(client, other, email)
    assert wrong.status_code == 403 and wrong.json()["detail"]["code"] == "biz_invite_other_email"
    look = client.get(f"/v1/public/business/invites/{token}").json()
    assert look["company_name"] == company["name"] and look["role"] == "recruiter" and "*" in look["email_masked"]
    rec = register(client, email)
    ok, _ = _accept(client, rec, email)
    assert ok.status_code == 200 and ok.json()["role"] == "recruiter"
    again, _ = _accept(client, rec, email)
    assert again.status_code == 400  # single use


def test_roles_are_enforced_by_the_api(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    grant(client, company["id"], "growth")
    cid = company["id"]
    rec = add_member(client, owner, cid, "recruiter")
    hm = add_member(client, owner, cid, "hiring_manager")
    iv = add_member(client, owner, cid, "interviewer")
    admin = add_member(client, owner, cid, "admin")
    # Recruiters manage jobs but not people, settings or the audit log.
    assert _invite(client, rec, cid, f"z-{tag()}@example.com", "interviewer").status_code == 403
    assert client.patch(f"/v1/business/companies/{cid}", headers=auth(rec), json={"about": "x"}).status_code == 403
    assert client.get(f"/v1/business/companies/{cid}/audit", headers=auth(rec)).status_code == 403
    job = new_job(client, rec, cid)
    other_job = new_job(client, rec, cid, title="Designer")
    # Hiring managers see only the jobs whose hiring team they're on.
    hm_job = client.post(f"/v1/business/companies/{cid}/jobs", headers=auth(hm), json={"title": "Any role"})
    assert hm_job.status_code == 403
    assert client.get(f"/v1/business/companies/{cid}/jobs", headers=auth(hm)).json() == []
    client.patch(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(rec),
                 json={"hiring_team": [uid(hm)]}).raise_for_status()
    assert [j["id"] for j in client.get(f"/v1/business/companies/{cid}/jobs", headers=auth(hm)).json()] == [job["id"]]
    assert client.get(f"/v1/business/companies/{cid}/jobs/{other_job['id']}/applications",
                      headers=auth(hm)).status_code == 404
    apply_signed_out(client, job["id"], f"cand-{tag()}@example.com").raise_for_status()
    apply_signed_out(client, other_job["id"], f"cand-{tag()}@example.com").raise_for_status()
    [app] = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/applications",
                       headers=auth(hm)).json()["items"]
    # Interviewers see only the applicants they're assigned to, and can't move anyone.
    assert client.get(f"/v1/business/companies/{cid}/applications/{app['id']}", headers=auth(iv)).status_code == 404
    client.patch(f"/v1/business/companies/{cid}/applications/{app['id']}", headers=auth(hm),
                 json={"interviewers": [uid(iv)]}).raise_for_status()
    assert client.get(f"/v1/business/companies/{cid}/applications/{app['id']}", headers=auth(iv)).status_code == 200
    assert [j["id"] for j in client.get(f"/v1/business/companies/{cid}/jobs", headers=auth(iv)).json()] == [job["id"]]
    assert client.get(f"/v1/business/companies/{cid}/jobs/{other_job['id']}", headers=auth(iv)).status_code == 404
    move = client.post(f"/v1/business/companies/{cid}/applications/move", headers=auth(iv),
                       json={"ids": [app["id"]], "stage_id": "screen"})
    assert move.status_code == 403
    assert client.post(f"/v1/business/companies/{cid}/applications/reject", headers=auth(iv),
                       json={"ids": [app["id"]]}).status_code == 403
    assert client.get(f"/v1/business/companies/{cid}/analytics", headers=auth(iv)).status_code == 403
    note = client.post(f"/v1/business/companies/{cid}/applications/{app['id']}/notes", headers=auth(iv),
                       json={"body": "Strong on systems design."})
    assert note.status_code == 201
    card = client.post(f"/v1/business/companies/{cid}/applications/{app['id']}/scorecards", headers=auth(iv),
                       json={"stage_id": "interview", "ratings": [{"criterion": "Systems", "score": 4}],
                             "notes": "Good", "recommendation": "hire"})
    assert card.status_code == 201 and card.json()["scorecards"][0]["author_id"] == uid(iv)
    # Only the owner makes admins, transfers ownership or sees the plan's request button work.
    assert _invite(client, admin, cid, f"a2-{tag()}@example.com", "admin").status_code == 403
    assert client.post(f"/v1/business/companies/{cid}/plan/request", headers=auth(admin),
                       json={"plan": "starter"}).status_code == 403
    members = client.get(f"/v1/business/companies/{cid}/members", headers=auth(owner)).json()["members"]
    admin_member = next(m for m in members if m["user_id"] == uid(admin))
    t = client.post(f"/v1/business/companies/{cid}/transfer", headers=auth(admin),
                    json={"member_id": admin_member["id"]})
    assert t.status_code == 403
    t = client.post(f"/v1/business/companies/{cid}/transfer", headers=auth(owner),
                    json={"member_id": admin_member["id"]})
    assert t.status_code == 200
    roles = {m["user_id"]: m["role"] for m in t.json()["members"]}
    assert roles[uid(admin)] == "owner" and roles[uid(owner)] == "admin"
    # The new owner can remove the recruiter; nobody can remove the owner.
    rec_member = next(m for m in members if m["user_id"] == uid(rec))
    assert client.delete(f"/v1/business/companies/{cid}/members/{rec_member['id']}",
                         headers=auth(admin)).status_code == 200
    assert client.get(f"/v1/business/companies/{cid}", headers=auth(rec)).status_code == 404
    owner_member = next(m for m in t.json()["members"] if m["role"] == "owner")
    assert client.delete(f"/v1/business/companies/{cid}/members/{owner_member['id']}",
                         headers=auth(admin)).status_code == 409


def test_company_a_never_reads_company_b(client: TestClient) -> None:
    a_owner, a, _ = new_company(client)
    b_owner, b, _ = new_company(client)
    job_a = new_job(client, a_owner, a["id"])
    apply_signed_out(client, job_a["id"], f"c-{tag()}@example.com").raise_for_status()
    [app] = client.get(f"/v1/business/companies/{a['id']}/jobs/{job_a['id']}/applications",
                       headers=auth(a_owner)).json()["items"]
    stranger = register(client, f"stranger-{tag()}@example.com")
    for h in (b_owner, stranger):
        for path in (f"/{a['id']}", f"/{a['id']}/jobs", f"/{a['id']}/jobs/{job_a['id']}",
                     f"/{a['id']}/jobs/{job_a['id']}/applications", f"/{a['id']}/applications/{app['id']}",
                     f"/{a['id']}/jobs/{job_a['id']}/export.csv", f"/{a['id']}/analytics", f"/{a['id']}/audit",
                     f"/{a['id']}/members", f"/{a['id']}/templates", f"/{a['id']}/verification"):
            assert client.get(f"/v1/business/companies{path}", headers=auth(h)).status_code == 404, path
    # B's own ids can't be used to reach A's rows either.
    assert client.get(f"/v1/business/companies/{b['id']}/applications/{app['id']}",
                      headers=auth(b_owner)).status_code == 404
    assert client.get(f"/v1/business/companies/{b['id']}/jobs/{job_a['id']}", headers=auth(b_owner)).status_code == 404
    assert client.post(f"/v1/business/companies/{b['id']}/applications/move", headers=auth(b_owner),
                       json={"ids": [app["id"]], "stage_id": "screen"}).status_code == 404
    assert client.delete(f"/v1/business/companies/{b['id']}/applications/{app['id']}",
                         headers=auth(b_owner)).status_code == 404


def test_free_plan_allows_one_active_job(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    new_job(client, owner, company["id"])
    second = new_job(client, owner, company["id"], publish=False, title="Another role")
    r = client.post(f"/v1/business/companies/{company['id']}/jobs/{second['id']}/publish", headers=auth(owner))
    assert r.status_code == 402 and r.json()["detail"]["limit"] == "jobs"
    plan = client.get(f"/v1/business/companies/{company['id']}/plan", headers=auth(owner)).json()
    assert plan["limits"] == {"jobs": 1, "seats": 1} and plan["active_jobs"] == 1 and plan["checkout"] == "request"
    prices = {p["id"]: (p["price_inr"], p["price_usd"], p["invite_only"]) for p in plan["plans"]}
    assert prices == {"free": (0, 0, False), "starter": (2999, 39, False), "growth": (9999, 129, True)}
    grant(client, company["id"], "starter")
    assert client.post(f"/v1/business/companies/{company['id']}/jobs/{second['id']}/publish",
                       headers=auth(owner)).status_code == 200


def test_plan_request_and_admin_grant(client: TestClient) -> None:
    admin = _admin(client)
    owner, company, _ = new_company(client)
    r = client.post(f"/v1/business/companies/{company['id']}/plan/request", headers=auth(owner),
                    json={"plan": "starter"})
    assert r.status_code == 200 and r.json()["pending_request"]["plan"] == "starter"
    assert client.get("/v1/admin/business/companies", headers=auth(owner)).status_code == 403
    listed = client.get("/v1/admin/business/companies?status=requests", headers=auth(admin)).json()
    assert company["id"] in [c["id"] for c in listed]
    g = client.post(f"/v1/admin/business/companies/{company['id']}/plan", headers=auth(admin),
                    json={"plan": "starter", "days": 30})
    assert g.status_code == 200 and g.json()["plan"] == "starter" and g.json()["pending_plan_request"] is None
    plan = client.get(f"/v1/business/companies/{company['id']}/plan", headers=auth(owner)).json()
    assert plan["limits"] == {"jobs": 5, "seats": 3} and plan["plan_until"]


def test_an_expired_plan_is_free_again(client: TestClient) -> None:
    from datetime import UTC, datetime, timedelta

    from orbit_api.models import BizCompany

    owner, company, _ = new_company(client)

    async def go(db: Any) -> None:
        c = await db.get(BizCompany, company["id"])
        c.plan, c.plan_until = "starter", datetime.now(UTC) - timedelta(days=1)

    db_call(client, go)
    assert client.get(f"/v1/business/companies/{company['id']}/plan", headers=auth(owner)).json()["plan"] == "free"


def test_admin_suspends_a_company_and_takes_a_job_down(client: TestClient) -> None:
    admin = _admin(client)
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    slug = company["slug"]
    assert client.get(f"/v1/public/business/companies/{slug}").status_code == 200
    # Report this job, from the public page.
    rep = client.post(f"/v1/public/business/jobs/{job['id']}/report", json={"reason": "scam", "details": "Asks fees"})
    assert rep.status_code == 201
    reports = client.get("/v1/admin/business/reports", headers=auth(admin)).json()
    mine = [r for r in reports if r["job_id"] == job["id"]]
    assert mine and mine[0]["reason"] == "scam"
    assert client.post(f"/v1/admin/business/reports/{mine[0]['id']}", headers=auth(admin),
                       json={"status": "actioned"}).json()["status"] == "actioned"
    # Take the job down: its page is gone and it can't be republished.
    td = client.post(f"/v1/admin/business/jobs/{job['id']}/take-down", headers=auth(admin),
                     json={"reason": "Charges applicants a fee"})
    assert td.status_code == 200
    assert client.get(f"/v1/public/business/companies/{slug}/jobs/{job['slug']}").status_code == 404
    again = client.post(f"/v1/business/companies/{company['id']}/jobs/{job['id']}/publish", headers=auth(owner))
    assert again.status_code == 403 and again.json()["detail"]["code"] == "biz_taken_down"
    client.post(f"/v1/admin/business/jobs/{job['id']}/restore", headers=auth(admin)).raise_for_status()
    # Suspend the company: public pages 404, writes refused, reads still work for its members.
    s = client.post(f"/v1/admin/business/companies/{company['id']}/suspend", headers=auth(admin),
                    json={"reason": "Fake employer"})
    assert s.status_code == 200 and s.json()["status"] == "suspended"
    assert client.get(f"/v1/public/business/companies/{slug}").status_code == 404
    w = client.post(f"/v1/business/companies/{company['id']}/jobs", headers=auth(owner), json={"title": "New one"})
    assert w.status_code == 403 and w.json()["detail"]["code"] == "biz_suspended"
    assert client.get(f"/v1/business/companies/{company['id']}", headers=auth(owner)).json()["status"] == "suspended"
    client.post(f"/v1/admin/business/companies/{company['id']}/unsuspend", headers=auth(admin)).raise_for_status()
    detail = client.get(f"/v1/admin/business/companies/{company['id']}", headers=auth(admin)).json()
    assert detail["status"] == "active" and detail["owner_email"] and detail["jobs"][0]["id"] == job["id"]


def test_admin_can_verify_by_hand(client: TestClient) -> None:
    admin = _admin(client)
    h = register(client, f"f-{tag()}@example.com")
    c = client.post("/v1/business/companies", headers=auth(h), json={
        "name": "Hand Verified", "website": f"hand-{tag()}.com", "size": "1-10", "country": "IN"}).json()
    r = client.post(f"/v1/admin/business/companies/{c['id']}/verify", headers=auth(admin))
    assert r.json()["verified"] is True and r.json()["verification_method"] == "admin"


def test_the_audit_log_is_append_only(client: TestClient) -> None:
    from sqlalchemy import select

    owner, company, _ = new_company(client)
    log = client.get(f"/v1/business/companies/{company['id']}/audit", headers=auth(owner)).json()
    assert {e["action"] for e in log} >= {"company.created", "company.verified"}

    async def edit(db: Any) -> None:
        row = (await db.scalars(select(BizAudit).where(BizAudit.company_id == company["id"]))).first()
        row.action = "tampered"
        await db.flush()

    with pytest.raises(AuditImmutable):
        db_call(client, edit)

    async def remove(db: Any) -> None:
        row = (await db.scalars(select(BizAudit).where(BizAudit.company_id == company["id"]))).first()
        await db.delete(row)
        await db.flush()

    with pytest.raises(AuditImmutable):
        db_call(client, remove)


def test_mentions_notify_only_members_who_can_see_the_applicant(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    grant(client, company["id"], "growth")
    cid = company["id"]
    rec = add_member(client, owner, cid, "recruiter", email=f"rhea-{tag()}@example.com")
    hm = add_member(client, owner, cid, "hiring_manager", email=f"hari-{tag()}@example.com")
    job = new_job(client, owner, cid)
    apply_signed_out(client, job["id"], f"c-{tag()}@example.com").raise_for_status()
    [app] = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/applications",
                       headers=auth(owner)).json()["items"]
    me_rec = client.get("/v1/auth/me", headers=auth(rec)).json()["email"]
    me_hm = client.get("/v1/auth/me", headers=auth(hm)).json()["email"]
    r = client.post(f"/v1/business/companies/{cid}/applications/{app['id']}/notes", headers=auth(owner),
                    json={"body": f"@{me_rec} and @{me_hm} please look"})
    assert r.status_code == 201
    assert r.json()["notes"][0]["mentions"] == [uid(rec)]  # the hiring manager isn't on this job's team
    notes = client.get("/v1/business/notifications", headers=auth(rec)).json()
    assert notes and notes[0]["link"].endswith(app["id"]) and not notes[0]["read"]
    assert client.get("/v1/business/notifications", headers=auth(hm)).json() == []
    client.post("/v1/business/notifications/read", headers=auth(rec), json={"ids": []}).raise_for_status()
    assert client.get("/v1/business/notifications", headers=auth(rec)).json()[0]["read"] is True


def test_migration_up_and_down() -> None:
    api = Path(__file__).resolve().parents[1]
    db = Path(tempfile.mkdtemp(prefix="orbit-biz-")) / "m.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def tables() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    alembic("upgrade", "head")
    biz = {"biz_companies", "biz_members", "biz_invites", "biz_jobs", "biz_applications", "biz_notes",
           "biz_scorecards", "biz_events", "biz_interviews", "biz_templates", "biz_notifications", "biz_reports",
           "biz_audit"}
    assert biz <= tables()
    alembic("downgrade", "35a47e5f80ca")
    assert not biz & tables()
    alembic("upgrade", "head")
    assert biz <= tables()


def test_deleting_the_owners_account_hands_the_company_over(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    grant(client, company["id"], "starter")
    rec = add_member(client, owner, company["id"], "recruiter")
    adm = add_member(client, owner, company["id"], "admin")
    r = client.request("DELETE", "/v1/auth/me", headers=auth(owner), json={"password": "correct horse battery"})
    assert r.status_code == 204, r.text
    members = client.get(f"/v1/business/companies/{company['id']}/members", headers=auth(adm)).json()["members"]
    assert {m["user_id"]: m["role"] for m in members} == {uid(rec): "recruiter", uid(adm): "owner"}
    # A company with nobody else in it goes with its owner.
    solo, alone, _ = new_company(client)
    client.request("DELETE", "/v1/auth/me", headers=auth(solo), json={"password": "correct horse battery"})
    assert client.get(f"/v1/public/business/companies/{alone['slug']}").status_code == 404
