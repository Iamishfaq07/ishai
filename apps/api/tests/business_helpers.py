"""Helpers for the Orbit for Business tests: accounts, companies, jobs and applications."""

import io
import json
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.business import rules
from orbit_api.providers.email import DevOutbox, OutgoingEmail, get_email_sender


def make_client(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    monkeypatch.setenv("ORBIT_BUSINESS_AI", "fake")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        get_settings.cache_clear()


def db_call(client: TestClient, fn: Any) -> Any:
    from orbit_api.db import sessionmaker

    async def go() -> Any:
        async with sessionmaker()() as db:
            out = await fn(db)
            await db.commit()
            return out

    return client.portal.call(go)  # type: ignore[union-attr]


def outbox() -> DevOutbox:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    return sender


def mail_to(address: str) -> list[OutgoingEmail]:
    return [m for m in outbox().sent if m.to == address]


def tag() -> str:
    return uuid.uuid4().hex[:8]


def register(client: TestClient, email: str, name: str = "Ana Rao", verified: bool = True) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery", "name": name})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    user_id = r.json()["user"]["id"]
    if verified:
        from orbit_api.models import User

        async def go(db: Any) -> None:
            u = await db.get(User, user_id)
            u.email_verified = True

        db_call(client, go)
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-User-Id": user_id}


def uid(h: dict[str, str]) -> str:
    return h["X-User-Id"]


def auth(h: dict[str, str]) -> dict[str, str]:
    return {"Authorization": h["Authorization"]}


def new_company(client: TestClient, verified: bool = True, **over: Any) -> tuple[dict[str, str], dict[str, Any], str]:
    """An owner (email at the company's domain), their company, and the domain."""
    domain = f"acme-{tag()}.com"
    owner = register(client, f"owner@{domain}", "Olivia Owner")
    body = {"name": f"Acme {domain[:10]}", "website": f"https://www.{domain}/about", "size": "11-50",
            "country": "IN", "about": "We make rockets.", **over}
    r = client.post("/v1/business/companies", headers=auth(owner), json=body)
    assert r.status_code == 201, r.text
    company = r.json()
    if verified:
        v = client.post(f"/v1/business/companies/{company['id']}/verification/account", headers=auth(owner))
        assert v.status_code == 200, v.text
        assert v.json()["verified"] is True
    return owner, company, domain


def grant(client: TestClient, company_id: str, plan: str) -> None:
    from orbit_api.models import BizCompany

    async def go(db: Any) -> None:
        c = await db.get(BizCompany, company_id)
        c.plan = plan

    db_call(client, go)


JOB = {
    "title": "Senior Backend Engineer",
    "description_html": "<p>Build the <strong>APIs</strong> behind our rockets.</p><script>alert(1)</script>"
                        "<ul><li>Python services</li><li>Postgres</li></ul>",
    "department": "Engineering",
    "locations": ["Bengaluru, Karnataka, IN"],
    "workplace": "hybrid",
    "employment_type": "full_time",
    "experience": "senior",
    "salary_min": 3000000, "salary_max": 4500000, "salary_currency": "INR", "salary_period": "year",
    "show_salary": True,
    "must_haves": ["Python", "Postgres", "Kubernetes"],
    "nice_to_haves": ["Rust"],
    "questions": [
        {"id": "auth", "text": "Are you authorised to work in India?", "kind": "yes_no", "required": True,
         "knockout": {"equals": "yes"}},
        {"id": "years", "text": "Years of backend experience?", "kind": "number", "required": True,
         "knockout": {"min": 4}},
    ],
}


def new_job(client: TestClient, h: dict[str, str], company_id: str, publish: bool = True,
            **over: Any) -> dict[str, Any]:
    r = client.post(f"/v1/business/companies/{company_id}/jobs", headers=auth(h), json={**JOB, **over})
    assert r.status_code == 201, r.text
    job = r.json()
    if publish:
        p = client.post(f"/v1/business/companies/{company_id}/jobs/{job['id']}/publish", headers=auth(h))
        assert p.status_code == 200, p.text
        job = p.json()
    return job


def docx_bytes(text: str) -> bytes:
    from docx import Document as Docx

    d = Docx()
    for line in text.splitlines():
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


RESUME = ("Priya Sharma\nBackend engineer\npriya@example.com | +91 98765 43210\n\nEXPERIENCE\n"
          "Senior Engineer, Rocketly 2018 - present\n- Built Python services on Postgres\n\nSKILLS\n"
          "Python, Postgres, Docker\n")

GOOD_ANSWERS = [{"question_id": "auth", "answer": "yes"}, {"question_id": "years", "answer": "6"}]


def apply_signed_out(client: TestClient, job_id: str, email: str, answers: list[dict[str, str]] | None = None,
                     **over: Any) -> Any:
    client.cookies.clear()
    data = {"name": "Priya Sharma", "email": email, "phone": "+91 98765 43210",
            "answers": json.dumps(GOOD_ANSWERS if answers is None else answers), "consent": "true",
            "notice_version": rules.NOTICE_VERSION, "source": "careers", **over}
    files = {"file": ("resume.docx", docx_bytes(RESUME),
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    return client.post(f"/v1/public/business/jobs/{job_id}/apply", data=data, files=files)


def status_token(email: str) -> str:
    """The status-page token in the latest email to this address that carries one."""
    import re

    mail = [m for m in mail_to(email) if "/application/" in m.text][-1]
    found = re.search(r"/application/([\w-]+)", mail.text)
    assert found is not None
    return found.group(1)


def confirm_applicant(client: TestClient, email: str) -> str:
    """The applicant opens the link in Orbit's confirmation email (their address is confirmed); returns the token."""
    token = status_token(email)
    r = client.post(f"/v1/public/business/applications/{token}/confirm")
    assert r.status_code == 200 and r.json()["email_confirmed"] is True, r.text
    return token


def wait_ranked(client: TestClient, h: dict[str, str], company_id: str, app_id: str) -> dict[str, Any]:
    for _ in range(100):
        d = client.get(f"/v1/business/companies/{company_id}/applications/{app_id}", headers=auth(h)).json()
        if d["ranking_status"] != "pending":
            return dict(d)
        time.sleep(0.05)
    raise AssertionError("never ranked")


def applications(client: TestClient, h: dict[str, str], company_id: str, job_id: str, **params: Any) -> dict[str, Any]:
    r = client.get(f"/v1/business/companies/{company_id}/jobs/{job_id}/applications", headers=auth(h), params=params)
    assert r.status_code == 200, r.text
    return dict(r.json())
