"""Transactional email. SMTP when configured; otherwise a dev outbox that logs the message.

The dev outbox is refused in production by `Settings` (ORBIT_SMTP_HOST is required there), so
verification/reset links — which are credentials — are never written to production logs.
"""

import asyncio
import logging
import smtplib
import ssl
from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache

from orbit_api.config import get_settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str


class EmailSender(ABC):
    name: str

    @abstractmethod
    async def send(self, email: OutgoingEmail) -> None: ...


class DevOutbox(EmailSender):
    """Keeps sent mail in memory (tests read it) and logs it so local dev can click the link."""

    name = "dev-outbox"

    def __init__(self) -> None:
        self.sent: list[OutgoingEmail] = []

    async def send(self, email: OutgoingEmail) -> None:
        self.sent.append(email)
        del self.sent[:-100]
        log.info("DEV EMAIL to=%s subject=%r\n%s", email.to, email.subject, email.text)


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
        msg.set_content(email.text)
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
        log.info("email disabled (no SMTP configured); dropping %r to %s", email.subject, email.to)


@lru_cache
def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.smtp_host:
        return SmtpSender(s.smtp_host, s.smtp_port, s.smtp_username,
                          s.smtp_password.get_secret_value() if s.smtp_password else None,
                          s.smtp_starttls, s.email_from)
    # Dev outbox logs the link (handy locally); never do that in production.
    return DevOutbox() if s.env != "production" else NoEmailSender()


async def send_safely(email: OutgoingEmail) -> None:
    """Email failures must never leak into auth responses (that would reveal account existence)."""
    try:
        await get_email_sender().send(email)
    except Exception:
        log.exception("failed to send %r email", email.subject)
