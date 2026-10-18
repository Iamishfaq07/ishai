"""Emails to applicants: templates with variables, sent from Orbit's address with Reply-To the recruiter, and the
interview invite's calendar file (.ics).

Variables: {{candidate_name}}, {{job_title}}, {{company_name}}, {{stage}}, {{status_link}}, {{recruiter_name}}.
Anything else in braces is left as typed. Templates are plain text: nothing in them is HTML.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import rules
from orbit_api.config import get_settings
from orbit_api.models import BizApplication, BizCompany, BizJob, BizTemplate
from orbit_api.providers.email import OutgoingEmail, send_safely

TemplateKind = Literal["received", "stage", "rejection", "interview"]
KINDS: tuple[TemplateKind, ...] = ("received", "stage", "rejection", "interview")
VARIABLES = ["candidate_name", "job_title", "company_name", "stage", "status_link", "recruiter_name"]

DEFAULTS: dict[str, tuple[str, str]] = {
    "received": (
        "We received your application for {{job_title}}",
        "Hi {{candidate_name}},\n\nThank you for applying for {{job_title}} at {{company_name}}. A person on our team "
        "reviews every application.\n\nYou can see where your application is at any time, and ask for it to be "
        "deleted, here:\n{{status_link}}\n\nBest,\n{{company_name}}",
    ),
    "stage": (
        "An update on your application for {{job_title}}",
        "Hi {{candidate_name}},\n\nYour application for {{job_title}} at {{company_name}} has moved on: {{stage}}.\n\n"
        "See where it is:\n{{status_link}}\n\nBest,\n{{recruiter_name}}\n{{company_name}}",
    ),
    "rejection": (
        "Your application for {{job_title}}",
        "Hi {{candidate_name}},\n\nThank you for your interest in {{job_title}} at {{company_name}} and for the time "
        "you spent applying. After careful review, we've decided not to move forward with your application this "
        "time.\n\nWe wish you the best in your search.\n\n{{recruiter_name}}\n{{company_name}}",
    ),
    "interview": (
        "Interview for {{job_title}}: pick a time",
        "Hi {{candidate_name}},\n\nWe'd like to talk with you about {{job_title}} at {{company_name}}. Please pick the "
        "time that suits you best here:\n{{status_link}}\n\nBest,\n{{recruiter_name}}\n{{company_name}}",
    ),
}

# What goes to an address that hasn't confirmed it applied (a signed-out application, before the status link is
# opened): Orbit's own words only, never a company's editable template, so nobody can use an application form to send
# their text to someone else's inbox. Company-written emails wait until the address is confirmed (pipeline.py).
CONFIRMATION = (
    "Confirm your application for {{job_title}}",
    "Hi {{candidate_name}},\n\nWe received an application for {{job_title}} at {{company_name}} with this email "
    "address. Open this link to confirm it's yours and see where your application is (you can also ask for it to be "
    "deleted there):\n{{status_link}}\n\nIf you didn't apply, ignore this email: nothing more is sent to you about "
    "it unless the link is opened.\n\nOrbit for Business",
)

APPLICANT_FOOTER = ("Sent by Orbit for {company} about your job application. Reply to this email to reach {company}. "
                    "To see your application or ask for it to be deleted, use the status link above.")


def status_link(token: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}/application/{token}"


def status_token_for(app: BizApplication) -> str | None:
    """The application's status-page token for an email, or None (then the email points to the first one's link)."""
    return rules.open_status_token(app.status_token_sealed, app.status_token_hash)


class EmailNotConfirmed(Exception):
    """A company-written email to an applicant who hasn't confirmed their address yet (it waits)."""


def render(text: str, values: dict[str, str]) -> str:
    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", lambda m: values.get(m.group(1), m.group(0)), text)


async def template(db: AsyncSession, company_id: str, kind: str) -> tuple[str, str, bool]:
    row = await db.scalar(select(BizTemplate).where(BizTemplate.company_id == company_id, BizTemplate.kind == kind))
    if row is not None:
        return row.subject, row.body, False
    subject, body = DEFAULTS[kind]
    return subject, body, True


def values(company: BizCompany, job: BizJob, app: BizApplication, *, token: str | None, stage: str = "",
           recruiter: str | None = None) -> dict[str, str]:
    return {"candidate_name": rules.one_line(app.name.split()[0]) if app.name.strip() else "there",
            "job_title": rules.one_line(job.title), "company_name": rules.one_line(company.name),
            "stage": rules.one_line(stage),
            "status_link": status_link(token) if token else "(the link in your first email from us)",
            "recruiter_name": rules.one_line(recruiter or f"The {company.name} hiring team")}


async def send_to_applicant(company: BizCompany, app: BizApplication, subject: str, body: str,
                            reply_to: str | None, attachments: tuple[tuple[str, str, bytes], ...] = ()) -> None:
    await send_safely(OutgoingEmail(to=app.email, subject=rules.one_line(subject)[:200], text=body,
                                    reply_to=reply_to, attachments=attachments,
                                    footer=APPLICANT_FOOTER.format(company=rules.one_line(company.name))))


# ---- calendar ------------------------------------------------------------------------------------------------------


def _ics_text(value: str) -> str:
    """A TEXT value (RFC 5545 §3.3.11): backslash, semicolon and comma escaped, every line break (CRLF, CR or LF) as
    \\n, and any other control character dropped."""
    out = value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    out = out.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", out)


def _fold(line: str) -> str:
    """A content line folded at 75 octets (RFC 5545 §3.1): CRLF and a space before each continuation, never inside a
    UTF-8 character."""
    out: list[str] = []
    current, size, limit = "", 0, 75
    for ch in line:
        n = len(ch.encode())
        if size + n > limit:
            out.append(current)
            current, size, limit = "", 0, 74  # the continuation's leading space is one of its 75 octets
        current += ch
        size += n
    out.append(current)
    return "\r\n ".join(out)


def _ics_time(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def ics(*, uid: str, start: datetime, minutes: int, summary: str, description: str, location: str,
        organizer: str | None, sequence: int = 0, cancelled: bool = False) -> bytes:
    """One event (RFC 5545), in UTC, with CRLF line ends and lines folded at 75 octets."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit AI//Orbit for Business//EN", "METHOD:PUBLISH",
             "BEGIN:VEVENT", f"UID:{uid}@orbitanswer.com", f"DTSTAMP:{_ics_time(datetime.now(UTC))}",
             f"DTSTART:{_ics_time(start)}", f"DTEND:{_ics_time(start + timedelta(minutes=minutes))}",
             f"SUMMARY:{_ics_text(summary)}", f"DESCRIPTION:{_ics_text(description)}",
             f"LOCATION:{_ics_text(location)}", f"SEQUENCE:{sequence}",
             "STATUS:CANCELLED" if cancelled else "STATUS:CONFIRMED"]
    if organizer:
        lines.append(f"ORGANIZER:mailto:{rules.one_line(organizer).replace(' ', '')}")
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode()


def new_uid() -> str:
    return uuid.uuid4().hex
