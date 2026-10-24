from email import policy
from email.parser import BytesParser

import httpx
import pytest
from pydantic import ValidationError

from orbit_api.gmail.delivery import ApplicationEmail, ResumeAttachment, compose, send_once


def test_application_mime_preserves_reviewed_content_and_attachment() -> None:
    reviewed = ApplicationEmail(recipient="hiring@example.com", subject="Application: Backend Engineer",
                                body="Please find my reviewed application attached.")
    raw = compose(reviewed, "candidate@example.com", "attempt-123", ResumeAttachment("resume.pdf", b"%PDF-1.7 test"))
    mail = BytesParser(policy=policy.default).parsebytes(raw)
    assert mail["To"] == "hiring@example.com"
    assert mail["From"] == "candidate@example.com"
    assert mail["Message-ID"] == "<orbit-attempt-123@example.com>"
    assert next(mail.iter_attachments()).get_payload(decode=True) == b"%PDF-1.7 test"
    with pytest.raises(ValidationError):
        ApplicationEmail(recipient="hiring@example.com", subject="Hello\r\nBcc: evil@example.com",
                         body="Long enough body content.")
    with pytest.raises(ValueError):
        compose(reviewed, "candidate@example.com", "bad\r\nheader")


@pytest.mark.parametrize(("code", "payload", "expected"), [
    (200, {"id": "gmail-id"}, "sent"), (200, {}, "uncertain"),
    (401, {}, "rejected"), (429, {}, "rejected"), (503, {}, "uncertain"), (408, {}, "uncertain"),
])
async def test_send_never_retries(code: int, payload: dict[str, str], expected: str) -> None:
    calls = 0
    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(code, json=payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await send_once(client, "test-token", b"mime")
    assert result.status == expected and calls == 1


async def test_connection_loss_is_uncertain() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Lost response")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert (await send_once(client, "test-token", b"mime")).status == "uncertain"
