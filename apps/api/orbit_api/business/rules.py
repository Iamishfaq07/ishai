"""The rules of Orbit for Business that don't touch the database: roles and what they may do, plans and limits, which
domains can be verified, slugs, the job description's sanitizer, knock-out rules, stages and the applicant notice."""

import hashlib
import html
import re
import secrets
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

import tldextract

if TYPE_CHECKING:
    from cryptography.fernet import Fernet

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

_DATA = Path(__file__).with_name("data")


def _domain_list(name: str) -> frozenset[str]:
    """A vendored list (business/data/, its source and licence in its header), one domain per line."""
    text = (_DATA / name).read_text(encoding="utf-8")
    return frozenset(ln.strip().lower() for ln in text.splitlines() if ln.strip() and not ln.startswith("#"))


# Free-mail providers (anyone can have an address there, so it proves nothing about a company) and throwaway
# addresses: vendored snapshots of maintained lists, loaded once.
FREE_MAIL = _domain_list("free_mail_domains.txt") | frozenset("""
gmail.com googlemail.com yahoo.com yahoo.co.in yahoo.in ymail.com rocketmail.com outlook.com hotmail.com live.com
msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me zoho.com zohomail.com zohomail.in
yandex.com gmx.com gmx.net mail.com rediffmail.com rediff.com tutanota.com tuta.io fastmail.com hey.com duck.com
""".split())
DISPOSABLE = _domain_list("disposable_email_domains.txt")
# Providers that run consumer mail under many country domains (hotmail.fr, yahoo.co.jp, gmx.at, proton.ch...): the
# registrable domain's own label decides, whatever the suffix.
FREE_MAIL_LABELS = frozenset("""
gmail googlemail hotmail outlook live msn yahoo ymail rocketmail aol gmx proton protonmail tutanota tuta yandex
mailinator rediffmail rediff zohomail icloud fastmail duck
""".split())
# Hosting and social platforms: a site there (or a page about the company) isn't the company's own domain.
HOSTED = frozenset("""
linkedin.com facebook.com instagram.com twitter.com x.com github.com github.io gitlab.io medium.com substack.com
notion.site notion.so wixsite.com wix.com weebly.com blogspot.com blogger.com wordpress.com squarespace.com
sites.google.com google.com carrd.co webflow.io netlify.app vercel.app pages.dev herokuapp.com firebaseapp.com
web.app linktr.ee bit.ly youtube.com angel.co wellfound.com glassdoor.com naukri.com indeed.com orbitanswer.com
""".split())

# The Public Suffix List (ICANN and private sections) from tldextract's bundled snapshot: never fetched at runtime.
_PSL = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=(), fallback_to_snapshot=True,
                             include_psl_private_domains=True)


class DomainError(ValueError):
    pass


def registrable_domain(host: str) -> str | None:
    """'eng.acme.co.in' → 'acme.co.in'; None for a bare public suffix ('co.in', 'github.io') or an unknown TLD."""
    parts = _PSL(host.lower().rstrip("."))
    if not parts.suffix or not parts.domain:
        return None
    return f"{parts.domain}.{parts.suffix}"


def domain_of(website: str) -> str:
    """'https://www.Acme.com/careers' → 'acme.com' (the registrable domain: 'jobs.acme.co.in' → 'acme.co.in').
    Refuses what isn't a public web address, and a bare public suffix ('co.in', 'github.io')."""
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
    reg = registrable_domain(host.removeprefix("www."))
    if reg is None:
        raise DomainError("Use the company's own website domain (like acme.com or acme.co.in), not a shared "
                          "suffix.")
    return reg


def _listed(domain: str, names: frozenset[str]) -> bool:
    return any(domain == x or domain.endswith("." + x) for x in names)


def blocked_domain(domain: str) -> bool:
    """A domain nobody can prove a company by: free or throwaway mail, a bare public suffix, or a site on a hosting
    or social platform."""
    d = domain.lower().rstrip(".")
    reg = registrable_domain(d)
    if reg is None:
        return True
    label = reg.split(".", 1)[0]
    return (label in FREE_MAIL_LABELS or reg in FREE_MAIL or reg in DISPOSABLE
            or d in FREE_MAIL or d in DISPOSABLE or _listed(d, HOSTED))


def email_matches_domain(email: str, domain: str) -> bool:
    """An address exactly at the domain ('a@acme.com' for acme.com). A subdomain mailbox ('a@eng.acme.com') proves
    only that someone has mail at a subdomain, which a hosted mail service or a department server can hand out:
    those companies verify with a DNS record instead."""
    at = email.strip().lower().rpartition("@")[2].rstrip(".")
    d = domain.strip().lower()
    return bool(at) and at == d and registrable_domain(at) == d and not blocked_domain(at)


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


class DescriptionTooLong(ValueError):
    pass


def sanitize_html(raw: str) -> str:
    """The HTML rebuilt from the allowed tags. The input is bounded before it's parsed; the output is never cut
    (cutting it could end inside a tag or an entity): too long a result is refused."""
    p = _Sanitizer()
    p.feed(raw[: MAX_DESCRIPTION * 2])
    p.close()
    out = p.result().strip()
    if len(out) > MAX_DESCRIPTION * 2:
        raise DescriptionTooLong("The description is too long. Shorten it and save again.")
    return out


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
                                  "offer": "offer", "hired": "hired", "rejected": "rejected"}


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

NOTICE_VERSION = "2026-10-19.2"  # .2: deletion after the job closes, and within 30 days of a request


def notice_text(company: str, retention_months: int) -> str:
    """Shown on every application form; its version and the time are recorded with the consent."""
    return (
        f"What happens to your application: {company} receives what you send here (your name, email, phone if given, "
        "your resume and your answers). If you apply with your Orbit account, only the resume you choose is shared; "
        "nothing else from your Orbit account (practice, interview help, LinkedIn AI, other documents) is ever shown "
        f"to {company}. Orbit's AI reads your resume to sort applications and to explain how it matches the job's "
        "requirements; it doesn't use your name, age, gender, photo or other personal traits, and it never rejects "
        f"anyone. A person at {company} reviews every application and makes every decision. If you aren't selected, "
        f"your application is deleted {retention_months} months after that decision, or {retention_months} months "
        "after the job closes if no decision was made. You can ask for it to be deleted at any time from the status "
        "page linked in your confirmation email; it is deleted within 30 days of your request."
    )


DELETION_DAYS = 30  # a deletion request is carried out by the sweep at the latest this long after it's made


def notice_digest(text: str) -> str:
    return digest(text)


def candidate_label(reference: str) -> str:
    return f"Candidate {reference}"


def blind_text(text: str, name: str, *literals: str | None) -> str:
    """Text about the applicant (their resume, answers, parsed experience) with their name, contact details and links
    hidden (blind review): business_ai's identity redaction."""
    from orbit_api.business_ai.redact import redact_identity

    return redact_identity(text, name, *literals)


# ---- the applicant's status link -----------------------------------------------------------------------------------


def _status_fernet() -> "Fernet":
    """The key that seals each application's status token, so later emails can carry the same link: ORBIT_CONFIG_SECRET
    (required in production), or one derived from the JWT secret outside production."""
    import base64

    from cryptography.fernet import Fernet

    from orbit_api.config import get_settings

    s = get_settings()
    source = s.config_secret.get_secret_value() if s.config_secret else "biz-status:" + s.jwt_secret.get_secret_value()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest()))


def new_status_token() -> tuple[str, str, str]:
    """A fresh random status-page token for an application: (raw, its SHA-256 to look it up by, the raw sealed for
    later emails). Nothing about it derives from the application id or a server-wide secret."""
    raw = token()
    return raw, digest(raw), _status_fernet().encrypt(raw.encode()).decode()


def open_status_token(sealed: str | None, token_hash: str) -> str | None:
    """The application's status token from its sealed copy, or None (no copy, or the key changed: later emails then
    point to the first email's link)."""
    from cryptography.fernet import InvalidToken

    if not sealed:
        return None
    try:
        raw = _status_fernet().decrypt(sealed.encode()).decode()
    except (InvalidToken, ValueError):
        return None
    return raw if secrets.compare_digest(digest(raw), token_hash) else None


# ---- one-line text (titles, names, subjects) ----------------------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def one_line(text: str) -> str:
    """Control characters (CR, LF, tab, NUL...) out of text that becomes a title, a name or an email subject: each run
    becomes one space."""
    return re.sub(r" {2,}", " ", _CONTROL.sub(" ", text)).strip()
