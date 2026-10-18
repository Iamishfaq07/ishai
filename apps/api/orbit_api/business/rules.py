"""The rules of Orbit for Business that don't touch the database: roles and what they may do, plans and limits, which
domains can be verified, slugs, the job description's sanitizer, knock-out rules, stages and the applicant notice."""

import hashlib
import html
import re
import secrets
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Literal
from urllib.parse import urlsplit

Role = Literal["owner", "admin", "recruiter", "hiring_manager", "interviewer"]
ROLES: tuple[Role, ...] = ("owner", "admin", "recruiter", "hiring_manager", "interviewer")
INVITABLE: tuple[Role, ...] = ("admin", "recruiter", "hiring_manager", "interviewer")

Permission = Literal["manage_company", "manage_members", "manage_plan", "manage_jobs", "all_jobs", "move_applicants",
                     "delete_applicants", "view_audit", "scorecards_only"]

_PERMS: dict[Role, frozenset[str]] = {
    "owner": frozenset({"manage_company", "manage_members", "manage_plan", "manage_jobs", "all_jobs",
                        "move_applicants", "delete_applicants", "view_audit"}),
    "admin": frozenset({"manage_company", "manage_members", "manage_jobs", "all_jobs", "move_applicants",
                        "delete_applicants", "view_audit"}),
    "recruiter": frozenset({"manage_jobs", "all_jobs", "move_applicants", "delete_applicants"}),
    "hiring_manager": frozenset({"move_applicants"}),
    "interviewer": frozenset({"scorecards_only"}),
}
ALL_PERMISSIONS: tuple[Permission, ...] = ("manage_company", "manage_members", "manage_plan", "manage_jobs",
                                           "all_jobs", "move_applicants", "delete_applicants", "view_audit",
                                           "scorecards_only")


def can(role: str, permission: Permission) -> bool:
    return permission in _PERMS.get(role, frozenset())  # type: ignore[call-overload]


def permissions(role: str) -> dict[str, bool]:
    return {p: can(role, p) for p in ALL_PERMISSIONS}


# ---- plans ---------------------------------------------------------------------------------------------------------

PlanId = Literal["free", "starter", "growth"]


@dataclass(frozen=True)
class BizPlan:
    id: PlanId
    label: str
    jobs: int
    seats: int
    price_inr: int
    price_usd: int
    invite_only: bool = False


PLANS: dict[str, BizPlan] = {
    "free": BizPlan("free", "Free", jobs=1, seats=1, price_inr=0, price_usd=0),
    "starter": BizPlan("starter", "Starter", jobs=5, seats=3, price_inr=2999, price_usd=39),
    "growth": BizPlan("growth", "Growth", jobs=20, seats=10, price_inr=9999, price_usd=129, invite_only=True),
}


# ---- domains -------------------------------------------------------------------------------------------------------

# Free-mail providers: anyone can have an address there, so it proves nothing about a company.
FREE_MAIL = frozenset("""
gmail.com googlemail.com yahoo.com yahoo.co.in yahoo.in yahoo.co.uk ymail.com rocketmail.com outlook.com hotmail.com
hotmail.co.uk live.com live.in msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me zoho.com
zohomail.com zohomail.in yandex.com yandex.ru gmx.com gmx.net gmx.de mail.com rediffmail.com rediff.com inbox.com
tutanota.com tuta.io fastmail.com hey.com mail.ru qq.com 163.com 126.com sina.com naver.com web.de t-online.de
""".split())
# Hosting and social platforms: a site there (or a page about the company) isn't the company's own domain.
HOSTED = frozenset("""
linkedin.com facebook.com instagram.com twitter.com x.com github.com github.io gitlab.io medium.com substack.com
notion.site notion.so wixsite.com wix.com weebly.com blogspot.com blogger.com wordpress.com squarespace.com
sites.google.com google.com carrd.co webflow.io netlify.app vercel.app pages.dev herokuapp.com firebaseapp.com
web.app linktr.ee bit.ly youtube.com angel.co wellfound.com glassdoor.com naukri.com indeed.com orbitanswer.com
""".split())


class DomainError(ValueError):
    pass


def domain_of(website: str) -> str:
    """'https://www.Acme.com/careers' → 'acme.com'. Refuses what isn't a public web address."""
    raw = website.strip()
    if not raw:
        raise DomainError("Add the company's website.")
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parts = urlsplit(raw)
    except ValueError as e:
        raise DomainError("That website address doesn't look right.") from e
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme not in {"http", "https"} or not host or "." not in host or len(host) > 253:
        raise DomainError("That website address doesn't look right.")
    if re.fullmatch(r"[\d.]+", host) or ":" in host or host.endswith((".local", ".localhost", ".internal")):
        raise DomainError("Use the company's public website.")
    if not re.fullmatch(r"[a-z0-9.-]+", host):
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError as e:
            raise DomainError("That website address doesn't look right.") from e
    return host.removeprefix("www.")


def blocked_domain(domain: str) -> bool:
    """A domain nobody can prove a company by: free mail, or a site on a hosting or social platform."""
    d = domain.lower()
    return any(d == x or d.endswith("." + x) for x in FREE_MAIL | HOSTED)


def email_matches_domain(email: str, domain: str) -> bool:
    """An address at the domain or one of its subdomains ('a@eng.acme.com' for acme.com)."""
    at = email.strip().lower().rpartition("@")[2]
    return bool(at) and (at == domain or at.endswith("." + domain)) and not blocked_domain(at)


# ---- slugs, tokens ------------------------------------------------------------------------------------------------


def slugify(text: str, max_len: int = 60) -> str:
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")[:max_len].strip("-")
    return slug or "company"


def token() -> str:
    return secrets.token_urlsafe(32)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def reference() -> str:
    return "A-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))


# ---- the job description: sanitized HTML --------------------------------------------------------------------------

ALLOWED_TAGS = frozenset({"p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h3", "h4", "a", "blockquote"})
_VOID = frozenset({"br"})
_DROP_CONTENT = frozenset({"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math",
                           "head", "title", "textarea", "select"})
MAX_DESCRIPTION = 20_000


class _Sanitizer(HTMLParser):
    """Rebuilds the HTML from scratch: allowed tags only (no attributes but a safe link's href), every text node
    escaped, everything else dropped (scripts and styles with their content). Unclosed tags are closed at the end."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            self.skip += 1
            return
        if self.skip or tag not in ALLOWED_TAGS:
            return
        if tag == "b":
            tag = "strong"
        if tag == "i":
            tag = "em"
        if tag == "a":
            href = next((v for k, v in attrs if k.lower() == "href" and v), "")
            href = href.strip()
            if not re.match(r"^(https?://|mailto:)", href, re.I):
                self.out.append("<a>")
            else:
                self.out.append(f'<a href="{html.escape(href, quote=True)}" rel="nofollow noopener" target="_blank">')
        else:
            self.out.append(f"<{tag}>")
        if tag not in _VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "br" and not self.skip:
            self.out.append("<br>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        tag = {"b": "strong", "i": "em"}.get(tag, tag)
        if self.skip or tag not in self.open:
            return
        while self.open:
            t = self.open.pop()
            self.out.append(f"</{t}>")
            if t == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def sanitize_html(raw: str) -> str:
    p = _Sanitizer()
    p.feed(raw[: MAX_DESCRIPTION * 2])
    p.close()
    return p.result()[:MAX_DESCRIPTION * 2].strip()


def html_to_text(raw: str) -> str:
    """The description as plain text (emails, ranking), from sanitized HTML."""
    text = re.sub(r"<(br|/p|/li|/h3|/h4|/blockquote)>", "\n", raw)
    text = re.sub(r"<li>", "- ", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(text)).strip()


def _inline_md(text: str) -> str:
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    return re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<em>\1</em>", out)


def markdown_to_html(md: str) -> str:
    """The small Markdown the AI writer uses (headings, bullets, numbered lists, bold, italics, paragraphs) as HTML,
    then sanitized like anything typed."""
    out: list[str] = []
    lst: str | None = None
    para: list[str] = []

    def flush_para() -> None:
        if para:
            out.append("<p>" + "<br>".join(_inline_md(p) for p in para) + "</p>")
            para.clear()

    def close_list() -> None:
        nonlocal lst
        if lst:
            out.append(f"</{lst}>")
            lst = None

    for line in md.splitlines():
        s = line.strip()
        bullet = re.match(r"^[-*•]\s+(.*)", s)
        number = re.match(r"^\d+[.)]\s+(.*)", s)
        heading = re.match(r"^#{1,6}\s+(.*)", s)
        if not s:
            flush_para()
            close_list()
        elif heading:
            flush_para()
            close_list()
            out.append(f"<h3>{_inline_md(heading.group(1))}</h3>")
        elif bullet or number:
            flush_para()
            want = "ul" if bullet else "ol"
            if lst != want:
                close_list()
                out.append(f"<{want}>")
                lst = want
            out.append(f"<li>{_inline_md((bullet or number).group(1))}</li>")  # type: ignore[union-attr]
        else:
            close_list()
            para.append(s)
    flush_para()
    close_list()
    return sanitize_html("".join(out))


# ---- stages --------------------------------------------------------------------------------------------------------

StageKind = Literal["applied", "screen", "interview", "offer", "hired", "rejected"]
STAGE_KINDS: tuple[StageKind, ...] = ("applied", "screen", "interview", "offer", "hired", "rejected")
DEFAULT_STAGES: list[dict[str, str]] = [
    {"id": "applied", "name": "Applied", "kind": "applied"},
    {"id": "screen", "name": "Screen", "kind": "screen"},
    {"id": "interview", "name": "Interview", "kind": "interview"},
    {"id": "offer", "name": "Offer", "kind": "offer"},
    {"id": "hired", "name": "Hired", "kind": "hired"},
    {"id": "rejected", "name": "Rejected", "kind": "rejected"},
]

# What the candidate sees (their status page, their Jobs AI tracker): plain words, never the company's own names.
CANDIDATE_STAGE: dict[str, tuple[str, str]] = {
    "applied": ("Received", "Your application is in. The team will look at it soon."),
    "screen": ("Being reviewed", "The team is looking at your application."),
    "interview": ("Interviewing", "You're in the interview stage."),
    "offer": ("Offer", "The team is preparing or has made you an offer."),
    "hired": ("Hired", "Congratulations, you've been hired."),
    "rejected": ("Not moving forward", "The team has decided not to move forward this time."),
}
# The candidate's Jobs AI tracker status for each kind of stage (job_portal: saved|applied|interviewing|offer|rejected).
TRACKER_STATUS: dict[str, str] = {"applied": "applied", "screen": "applied", "interview": "interviewing",
                                  "offer": "offer", "hired": "offer", "rejected": "rejected"}


def stage_kind(stages: list[dict[str, Any]], stage_id: str) -> str:
    return next((str(s["kind"]) for s in stages if s.get("id") == stage_id), "applied")


def first_stage(stages: list[dict[str, Any]], kind: str) -> str | None:
    return next((str(s["id"]) for s in stages if s.get("kind") == kind), None)


# ---- screening questions and knock-outs ----------------------------------------------------------------------------


def knockout_failure(question: dict[str, Any], answer: str) -> str | None:
    """Why this answer fails the question's knock-out rule, or None. A flag for a person to look at, never a
    rejection."""
    rule = question.get("knockout") or None
    if not rule:
        return None
    text = str(question.get("text", "")).strip()
    a = answer.strip()
    kind = question.get("kind")
    if kind == "yes_no" and rule.get("equals") in {"yes", "no"}:
        if a.lower() != rule["equals"]:
            return f"{text} (answered {a or 'nothing'})"
    elif kind == "choice" and rule.get("any_of"):
        if a not in rule["any_of"]:
            return f"{text} (answered {a or 'nothing'})"
    elif kind == "number" and (rule.get("min") is not None or rule.get("max") is not None):
        try:
            n = float(a)
        except ValueError:
            return f"{text} (not a number)"
        if rule.get("min") is not None and n < float(rule["min"]):
            return f"{text} (answered {a}, needs at least {rule['min']:g})"
        if rule.get("max") is not None and n > float(rule["max"]):
            return f"{text} (answered {a}, needs at most {rule['max']:g})"
    return None


# ---- the notice applicants agree to --------------------------------------------------------------------------------

NOTICE_VERSION = "2026-10-19.1"


def notice_text(company: str, retention_months: int) -> str:
    """Shown on every application form; its version and the time are recorded with the consent."""
    return (
        f"What happens to your application: {company} receives what you send here (your name, email, phone if given, "
        "your resume and your answers). If you apply with your Orbit account, only the resume you choose is shared; "
        "nothing else from your Orbit account (practice, interview help, LinkedIn AI, other documents) is ever shown "
        f"to {company}. Orbit's AI reads your resume to sort applications and to explain how it matches the job's "
        "requirements; it doesn't use your name, age, gender, photo or other personal traits, and it never rejects "
        f"anyone. A person at {company} reviews every application and makes every decision. If you aren't selected, "
        f"your application is deleted after {retention_months} months. You can ask for it to be deleted at any time "
        "from the status page linked in your confirmation email."
    )


def notice_digest(text: str) -> str:
    return digest(text)


def candidate_label(reference: str) -> str:
    return f"Candidate {reference}"


_CONTACT_LINE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?\d[\d ()-]{7,}\d|https?://\S+")


def blind_text(text: str, name: str) -> str:
    """The resume with the applicant's contact details and name hidden (blind review)."""
    out = _CONTACT_LINE.sub("[hidden]", text)
    for part in sorted({p for p in re.split(r"\s+", name.strip()) if len(p) >= 2}, key=len, reverse=True):
        out = re.sub(rf"\b{re.escape(part)}\b", "[hidden]", out, flags=re.I)
    return out


def status_token(application_id: str) -> str:
    """The applicant's status-page link token: derived from the application id with the server's secret, so every
    email can carry the same link without storing it (only its SHA-256 is stored, to find the application)."""
    import base64
    import hmac

    from orbit_api.config import get_settings

    key = get_settings().jwt_secret.get_secret_value().encode()
    mac = hmac.new(key, f"biz-status:{application_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")
