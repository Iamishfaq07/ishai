"""Build a reviewed application email and send once. Never retry uncertain delivery."""
import base64
import io
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import parsedate_to_datetime
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ApplicationEmail(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recipient: EmailStr
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=20, max_length=20000)

    @field_validator("subject")
    @classmethod
    def one_line(cls, value: str) -> str:
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Use a single-line subject")
        return value


@dataclass(frozen=True)
class ResumeAttachment:
    filename: str
    content: bytes


def compose(message: ApplicationEmail, sender: str, attempt_id: str,
            attachment: ResumeAttachment | None = None) -> bytes:
    # Sender must come from the connected Google account, never a caller-supplied From header.
    sender = str(ApplicationEmail(recipient=sender, subject="Validate sender",
                                  body="Sender validation only.").recipient)
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
    if not attempt_id or any(c not in allowed for c in attempt_id):
        raise ValueError("Invalid attempt identity")
    mail = EmailMessage(policy=SMTP)
    mail["From"] = sender
    mail["To"] = str(message.recipient)
    mail["Subject"] = message.subject
    mail["Message-ID"] = f"<orbit-{attempt_id}@{sender.split('@')[1]}>"
    mail.set_content(message.body)
    if attachment:
        if any(c in attachment.filename for c in "/\\\r\n") or len(attachment.content) > 5_000_000:
            raise ValueError("Choose a resume file of at most 5 MB without path separators")
        if attachment.filename.lower().endswith(".pdf") and attachment.content.startswith(b"%PDF-"):
            subtype = "pdf"
        elif attachment.filename.lower().endswith(".docx"):
            try:
                with zipfile.ZipFile(io.BytesIO(attachment.content)) as archive:
                    if "word/document.xml" not in archive.namelist():
                        raise ValueError("Not a Word document")
            except zipfile.BadZipFile as exc:
                raise ValueError("Not a Word document") from exc
            subtype = "vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            raise ValueError("Choose a PDF or DOCX resume")
        mail.add_attachment(attachment.content, maintype="application", subtype=subtype, filename=attachment.filename)
    return mail.as_bytes()


@dataclass(frozen=True)
class DeliveryResult:
    status: Literal["sent", "rejected", "uncertain"]
    message_id: str | None = None
    reason: str | None = None
    retryable: bool = False
    retry_after: str | None = None
    http_status: int | None = None


async def send_once(client: httpx.AsyncClient, access_token: str, mime: bytes) -> DeliveryResult:
    """Caller persists the attempt BEFORE invoking this function. An uncertain result blocks automatic resend."""
    try:
        response = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"raw": base64.urlsafe_b64encode(mime).decode()}, timeout=30, follow_redirects=False)
    except httpx.HTTPError:
        return DeliveryResult("uncertain", reason="Connection interrupted; Gmail may have accepted the email.")
    if response.status_code == 200:
        try:
            payload = response.json()
            identity = payload.get("id") if isinstance(payload, dict) else None
            if isinstance(identity, str) and identity:
                return DeliveryResult("sent", message_id=identity)
        except ValueError:
            pass
        return DeliveryResult("uncertain", reason="Gmail returned success without a readable message receipt.")
    if 400 <= response.status_code < 500 and response.status_code != 408:
        retryable = response.status_code in {401, 403, 429}
        now = datetime.now(UTC)
        wait_until = now + timedelta(seconds=60 if response.status_code in {403, 429} else 0)
        retry_header = response.headers.get("Retry-After", "")
        try:
            if retry_header.isdecimal():
                requested = now + timedelta(seconds=int(retry_header))
            else:
                requested = parsedate_to_datetime(retry_header)
                if requested.tzinfo is None:
                    requested = requested.replace(tzinfo=UTC)
            wait_until = max(wait_until, requested)
        except (ValueError, TypeError, OverflowError):
            if retry_header:
                # An unreadable provider cooldown must not result in an immediate retry.
                wait_until = max(wait_until, now + timedelta(days=1))
        return DeliveryResult("rejected", reason=f"Gmail rejected this request ({response.status_code}).",
                              retryable=retryable, retry_after=wait_until.isoformat() if retryable else None,
                              http_status=response.status_code)
    return DeliveryResult("uncertain", reason=f"Gmail returned an inconclusive response ({response.status_code}).")
