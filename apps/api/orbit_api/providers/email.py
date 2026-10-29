"""Transactional email. SMTP when configured; otherwise a dev outbox that logs the message.

The dev outbox is refused in production by `Settings` (ORBIT_SMTP_HOST is required there), so
verification/reset links — which are credentials — are never written to production logs.
"""

import asyncio
import logging
import os
import smtplib
import ssl
import tempfile
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache
from pathlib import Path

from orbit_api.config import get_settings
from orbit_api.providers import health

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    # Where the recipient's "Reply" goes, when not back to ORBIT_EMAIL_FROM (an Inbox reply: to the admin).
    reply_to: str | None = None
    # Files sent with it: (filename, MIME type, bytes). Orbit for Business's interview invites carry an .ics.
    attachments: tuple[tuple[str, str, bytes], ...] = ()
    # The line under the message, when it isn't about the recipient's Orbit account (an applicant's email from a
    # company on Orbit for Business). None: the account footer.
    footer: str | None = None
    # The stop link of an email someone chose to get (the weekly tips email): the List-Unsubscribe header points
    # there. None: account mail, whose header points to the contact page.
    unsubscribe: str | None = None


class EmailSender(ABC):
    name: str

    @abstractmethod
    async def send(self, email: OutgoingEmail) -> None: ...


class DevOutbox(EmailSender):
    """Keeps sent mail in memory (tests read it) and appends it to a local file so dev can click the link.
    Logs carry only a pointer: log redaction masks `token=` values, which would make the links unusable."""

    name = "dev-outbox"

    def __init__(self) -> None:
        self.sent: list[OutgoingEmail] = []

    async def send(self, email: OutgoingEmail) -> None:
        self.sent.append(email)
        del self.sent[:-100]
        path = dev_outbox_path()
        with path.open("a", encoding="utf-8") as fh:
            reply = f" reply_to={email.reply_to}" if email.reply_to else ""
            fh.write(f"--- to={email.to}{reply} subject={email.subject!r}\n{email.text}\n\n")
        log.info("DEV EMAIL to=%s subject=%r (full text with links in %s)", email.to, email.subject, path)


def dev_outbox_path() -> Path:
    return Path(os.environ.get("ORBIT_DEV_OUTBOX") or Path(tempfile.gettempdir()) / "orbit-dev-outbox.txt")


class SmtpSender(EmailSender):
    name = "smtp"

    def __init__(self, host: str, port: int, username: str | None, password: str | None, starttls: bool,
                 sender: str) -> None:
        self._host, self._port = host, port
        self._username, self._password = username, password
        self._starttls, self._from = starttls, sender

    def _send_sync(self, email: OutgoingEmail) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self._from, email.to, email.subject
        if email.reply_to:
            msg["Reply-To"] = email.reply_to
        # The weekly tips email (opt-in) carries its stop link; account mail, the contact page.
        msg["List-Unsubscribe"] = f"<{email.unsubscribe or 'https://orbitanswer.com/contact'}>"
        footer = email.footer if email.footer is not None else (
            "This email is about your Orbit account. Orbit sends its weekly tips email only to people who choose it. "
            "To download or delete your data, use Settings, or the contact page on the site.")
        msg.set_content(email.text.rstrip() + f"\n\n--\n{footer}\n")
        for filename, mime, data in email.attachments:
            maintype, _, subtype = mime.partition("/")
            msg.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream",
                               filename=filename)
        ctx = ssl.create_default_context()
        if self._port == 465:
            with smtplib.SMTP_SSL(self._host, self._port, context=ctx, timeout=15) as smtp:
                self._login_and_send(smtp, msg)
        else:
            with smtplib.SMTP(self._host, self._port, timeout=15) as smtp:
                if self._starttls:
                    smtp.starttls(context=ctx)
                self._login_and_send(smtp, msg)

    def _login_and_send(self, smtp: smtplib.SMTP, msg: EmailMessage) -> None:
        if self._username and self._password:
            smtp.login(self._username, self._password)
        smtp.send_message(msg)

    async def send(self, email: OutgoingEmail) -> None:
        await asyncio.to_thread(self._send_sync, email)


class NoEmailSender(EmailSender):
    """Production without SMTP: email features are disabled. Drops mail and logs a notice — crucially it
    never logs the link/token (unlike the dev outbox), so verification/reset tokens don't leak to logs."""

    name = "disabled"

    async def send(self, email: OutgoingEmail) -> None:
        log.info("email disabled (no SMTP configured); dropping %r to %s", email.subject, mask_email(email.to))


def mask_email(address: str) -> str:
    """`jane.doe@example.com` → `j***@example.com`: enough to tell recipients apart in logs, not a mailing list."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


@lru_cache
def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.smtp_host:
        return SmtpSender(s.smtp_host, s.smtp_port, s.smtp_username,
                          s.smtp_password.get_secret_value() if s.smtp_password else None,
                          s.smtp_starttls, s.email_from)
    # Dev outbox logs the link (handy locally); never do that in production.
    return DevOutbox() if s.env != "production" else NoEmailSender()


def can_deliver() -> bool:
    """False when production has no SMTP: mail is dropped, so nothing may depend on someone reading it."""
    return not isinstance(get_email_sender(), NoEmailSender)


async def send_now(email: OutgoingEmail) -> bool:
    """Send it in this request and say whether it went: for an admin who is told "sent" (an Inbox reply), where a
    failure must show instead of vanishing into the log. Never raises."""
    sender = get_email_sender()
    started = time.monotonic()
    try:
        await sender.send(email)
    except Exception as e:
        health.record(sender.name, "email", False, error=type(e).__name__)
        log.exception("failed to send %r email", email.subject)
        return False
    health.record(sender.name, "email", True, int((time.monotonic() - started) * 1000))
    return True


async def send_safely(email: OutgoingEmail) -> None:
    """Email failures must never leak into auth responses (that would reveal account existence)."""
    sender = get_email_sender()
    started = time.monotonic()
    try:
        await sender.send(email)
    except Exception as e:
        health.record(sender.name, "email", False, error=type(e).__name__)
        log.exception("failed to send %r email", email.subject)
    else:
        health.record(sender.name, "email", True, int((time.monotonic() - started) * 1000))
