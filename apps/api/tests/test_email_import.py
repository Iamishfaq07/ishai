"""Email files remain untrusted input; only explicit, current, owned reviews change a tracker."""
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from orbit_api.job_portal import email_import
from tests.business_helpers import auth
from tests.test_message_updates import current, setup


def mail(text: str = "We would like to invite you to an interview.", message_id: str = "one@example.test") -> bytes:
    message = EmailMessage()
    message["From"] = "Recruiting <hiring@example.test>"
    message["Subject"] = "Interview for backend role"
    message["Message-ID"] = f"<{message_id}>"
    message.set_content(text)
    return message.as_bytes()


def upload(client: TestClient, user: dict[str, str], entry: str, raw: bytes | None = None):  # type: ignore[no-untyped-def]
    return client.post(f"/v1/jobs/tracker/{entry}/message-update/import", headers=auth(user),
                       files={"file": ("message.eml", raw if raw is not None else mail(), "message/rfc822")})


def confirm(client: TestClient, user: dict[str, str], entry: str, token: str, version: str | None = None):  # type: ignore[no-untyped-def]
    return client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user),
        json={"version": version or current(client, user, entry)["version"], "confirmed": True,
              "status": "interviewing", "source_receipt": token})


def test_parser_ignores_attachments_and_remote_html() -> None:
    message = EmailMessage()
    message["From"] = "Recruiter <sender@example.test>"
    message["Subject"] = "A plain-text update"
    message.set_content("We have received your application. Thank you for your time.")
    message.add_attachment(b"We are pleased to offer you the role.", 
                           maintype="text", subtype="plain", filename="offer.txt")
    parsed = email_import.parse(message.as_bytes())
    assert "offer" not in parsed.message
    html = EmailMessage()
    html["From"] = "Recruiter <sender@example.test>"
    html["Subject"] = "HTML invitation"
    html.set_content('<html><head><style>.secret{}</style></head><body><script>fetch("https://evil.test")</script>'
                     '<img src="https://evil.test/pixel"><p>We invite you to an interview.</p></body></html>',
                     subtype="html")
    extracted = email_import.parse(html.as_bytes())
    assert extracted.message == "We invite you to an interview."
    assert email_import.parse(message.as_bytes()).source_key == parsed.source_key
    with pytest.raises(HTTPException) as oversized:
        email_import.parse(b"a" * (email_import.MAX_BYTES + 1))
    assert oversized.value.status_code == 413
    with pytest.raises(HTTPException):
        email_import.parse(b"not an email")
    with pytest.raises(HTTPException):
        email_import.parse(mail("x" * 10001))


def test_import_only_stores_provenance_after_review_and_prevents_reuse(client: TestClient) -> None:
    user, entry = setup(client)
    response = upload(client, user, entry)
    assert response.status_code == 200, response.text
    imported = response.json()
    history = f"/v1/jobs/tracker/{entry}/message-update/imports"
    assert client.get(history, headers=auth(user)).json() == []
    assert current(client, user, entry)["status"] == "applied"
    preview = client.post(f"/v1/jobs/tracker/{entry}/message-update/preview", headers=auth(user), json={
        "message": imported["message"], "version": current(client, user, entry)["version"],
        "source_receipt": imported["source_receipt"]})
    assert preview.status_code == 200, preview.text
    assert preview.json()["event"] == "interview"
    result = confirm(client, user, entry, imported["source_receipt"])
    assert result.status_code == 200, result.text
    saved = client.get(history, headers=auth(user)).json()
    assert len(saved) == 1 and saved[0]["changes"]["status"] == "interviewing"
    assert "message" not in saved[0] and "source_receipt" not in saved[0]
    exported = client.get("/v1/auth/me/export", headers=auth(user)).json()
    assert len(exported["employer_message_imports"]) == 1
    assert len(exported["employer_message_imports"][0]["body_digest"]) == 64
    assert any(event["source"] == "reviewed_email" for event in exported["application_stage_events"])
    assert upload(client, user, entry).status_code == 409
    client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"status": "applied"})
    assert confirm(client, user, entry, imported["source_receipt"]).status_code == 409
    assert current(client, user, entry)["status"] == "applied"


def test_stale_job_rolls_back_import_reservation_and_edits_detach_receipt(client: TestClient) -> None:
    user, entry = setup(client)
    imported = upload(client, user, entry).json()
    version = current(client, user, entry)["version"]
    edited = client.post(f"/v1/jobs/tracker/{entry}/message-update/preview", headers=auth(user), json={
        "message": "We are pleased to offer you the role.", "version": version,
        "source_receipt": imported["source_receipt"]})
    assert edited.status_code == 409
    client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"notes": "Changed in another tab"})
    assert confirm(client, user, entry, imported["source_receipt"], version).status_code == 409
    assert client.get(f"/v1/jobs/tracker/{entry}/message-update/imports", headers=auth(user)).json() == []
    assert confirm(client, user, entry, imported["source_receipt"]).status_code == 200


def test_receipts_are_expiring_and_bound_to_owner_and_job(client: TestClient) -> None:
    user, entry = setup(client)
    other, other_entry = setup(client)
    imported = upload(client, user, entry).json()
    assert upload(client, other, entry).status_code == 404
    assert client.get(f"/v1/jobs/tracker/{entry}/message-update/imports", headers=auth(other)).status_code == 404
    assert confirm(client, other, other_entry, imported["source_receipt"]).status_code == 409
    payload = jwt.decode(imported["source_receipt"], email_import._key(), algorithms=["HS256"],
                         audience="career-email-import", issuer="orbit")
    payload["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    expired = jwt.encode(payload, email_import._key(), algorithm="HS256")
    assert confirm(client, user, entry, expired).status_code == 409
    assert confirm(client, user, entry, imported["source_receipt"] + "tampered").status_code == 409
    assert upload(client, other, other_entry).status_code == 200  # no cross-account dedup disclosure
