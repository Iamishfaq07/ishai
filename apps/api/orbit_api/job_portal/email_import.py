"""Local email-file extraction and short-lived, purpose-bound review receipts. No mailbox access."""
import hashlib
import hmac
import re
from datetime import UTC, datetime, timedelta
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from html.parser import HTMLParser
from typing import Any

import jwt
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from orbit_api.config import get_settings

MAX_BYTES = 512_000
MAX_TEXT = 10_000
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")


def clean(value: str) -> str:
    return _CONTROL.sub("", value).strip()


class PlainHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "head", "template"}:
            self.hidden += 1
        if not self.hidden and tag in {"p", "div", "br", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "head", "template"} and self.hidden:
            self.hidden -= 1
        if not self.hidden and tag in {"p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


class ImportedEmail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str
    sender: str
    subject: str
    sent_at: str
    source_key: str


def parse(raw: bytes) -> ImportedEmail:
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(413, "Choose an .eml file of at most 512 KB.")
    try:
        mail = BytesParser(policy=policy.default).parsebytes(raw)
        if not isinstance(mail, EmailMessage) or not (mail.get("From") or mail.get("Subject")):
            raise ValueError("Missing email headers")
        # get_body chooses the main MIME body and excludes attachments, including attached forwarded messages.
        part = mail.get_body(preferencelist=("plain", "html"))
        if part is None or part.get_content_type() not in {"text/plain", "text/html"}:
            raise ValueError("No readable body")
        content = part.get_content()
        if not isinstance(content, str):
            raise ValueError("Not text")
        if part.get_content_type() == "text/html":
            parser = PlainHTML()
            parser.feed(content)
            content = "".join(parser.parts)
        message = clean(content)
        if not 20 <= len(message) <= MAX_TEXT:
            raise ValueError("Body length")
        sender = clean(str(mail.get("From", "")))[:300]
        subject = clean(str(mail.get("Subject", "")))[:300]
        sent_at = clean(str(mail.get("Date", "")))[:120]
        ids = mail.get_all("Message-ID", [])
        if len(ids) > 1:
            raise ValueError("Multiple identities")
        message_id = clean(str(ids[0])) if ids else ""
        identity = "message-id:" + message_id if message_id else f"content:{sender}\n{subject}\n{message}"
        return ImportedEmail(message=message, sender=sender, subject=subject, sent_at=sent_at,
                             source_key=hashlib.sha256(identity.encode()).hexdigest())
    except (ValueError, LookupError, TypeError, RecursionError) as e:
        raise HTTPException(422, "Could not read one email body of 20–10,000 characters. "
                            "Export a single .eml message or paste the relevant text instead.") from e


def _key() -> bytes:
    return hmac.digest(get_settings().jwt_secret.get_secret_value().encode(), b"career-email-import/v1", "sha256")


class Receipt(BaseModel):
    sub: str
    entry: str
    source_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    sender: str = Field(max_length=300)
    subject: str = Field(max_length=300)
    sent_at: str = Field(max_length=120)


def sign(email: ImportedEmail, user_id: str, entry_id: str) -> str:
    now = datetime.now(UTC)
    payload = {**email.model_dump(exclude={"message"}), "digest": hashlib.sha256(email.message.encode()).hexdigest(),
               "sub": user_id, "entry": entry_id, "aud": "career-email-import", "iss": "orbit",
               "iat": now, "exp": now + timedelta(minutes=30)}
    return jwt.encode(payload, _key(), algorithm="HS256")


def verify(token: str, user_id: str, entry_id: str, message: str | None = None) -> Receipt:
    try:
        payload: dict[str, Any] = jwt.decode(token, _key(), algorithms=["HS256"], audience="career-email-import",
            issuer="orbit", options={"require": ["exp", "iat", "sub", "aud", "iss"]})
        receipt = Receipt.model_validate(payload)
        if receipt.sub != user_id or receipt.entry != entry_id:
            raise ValueError("Wrong review context")
        if message is not None and receipt.digest != hashlib.sha256(message.encode()).hexdigest():
            raise ValueError("Edited imported text")
        return receipt
    except (jwt.PyJWTError, ValidationError, ValueError) as e:
        raise HTTPException(409, "This email review expired or changed. Import the file again, "
                            "or review edited text as a pasted message.") from e
