"""Each ATS's public application form, read into one list of questions (FormQuestion), so the bank can answer it
before anything is submitted. Reading is preparation only: nothing here posts a form.

- Greenhouse: `GET boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true` (public). `questions` are
  the form, `compliance` the voluntary EEO survey, `demographic_questions` the newer survey, `location_questions` an
  address block, and `data_compliance` the GDPR consent.
- Lever: the posting's apply page (`jobs.lever.co/{site}/{id}/apply`, public HTML). The standard fields have fixed
  names (name, email, phone, location, org, urls[...], comments, resume), and each custom question card is a JSON
  template in a hidden input `cards[<id>][baseTemplate]` (its answers go in `cards[<id>][field<n>]`). The EEO survey
  is `eeo[gender]`, `eeo[race]`, `eeo[veteran]`, `eeo[disability]`.
- Ashby: the public job page's GraphQL (`jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting`), the same query
  the hosted page makes. `applicationForm.sections[].fieldEntries[]` is the form, and `surveyForms` the EEO survey.

Fetches go only to these hosts, with no redirects, a timeout and a size cap (the same rules as job_portal/http.py).
When a form can't be read, the packet falls back to the ATS's standard fields (`standard_form`) and the executor
reports any question it finds that the packet didn't answer.
"""

from __future__ import annotations

import html
import json
import re
from typing import Any, Literal
from urllib.parse import quote, urlsplit

import httpx
from pydantic import BaseModel, Field

from orbit_api.job_portal.http import USER_AGENT

Kind = Literal["text", "textarea", "select", "multiselect", "boolean", "file", "number", "date", "email", "phone",
               "url", "checkbox"]
Section = Literal["application", "eeo", "consent"]
# Standard fields: what `ApplicationPacket.fields` carries, filled from the candidate's facts.
Standard = Literal["first_name", "last_name", "full_name", "email", "phone", "location", "linkedin", "website",
                   "github", "current_company", "resume", "cover_letter"]

HOSTS = frozenset({"boards-api.greenhouse.io", "api.lever.co", "jobs.lever.co", "jobs.ashbyhq.com"})
TIMEOUT = httpx.Timeout(15.0, connect=6.0)
MAX_BYTES = 3_000_000
_TAG = re.compile(r"<[^>]+>")


class Option(BaseModel):
    label: str
    value: str


class FormQuestion(BaseModel):
    id: str = Field(max_length=200)  # the ATS's own field name or id, what the executor fills
    label: str = Field(max_length=2000)
    kind: Kind
    required: bool = False
    options: list[Option] = Field(default_factory=list)
    section: Section = "application"
    standard: Standard | None = None
    description: str = Field("", max_length=4000)


class FormError(Exception):
    """The form couldn't be read; the message is for logs."""


def _text(raw: Any, limit: int = 2000) -> str:
    s = html.unescape(_TAG.sub(" ", html.unescape(str(raw or ""))))
    return " ".join(s.split())[:limit]


def _standard_by_label(label: str) -> Standard | None:
    low = label.lower()
    if "linkedin" in low:
        return "linkedin"
    if "github" in low:
        return "github"
    if re.search(r"\b(website|portfolio|personal site|blog)\b", low):
        return "website"
    if re.search(r"\b(current|most recent) (company|employer)\b", low):
        return "current_company"
    return None


# ---- Greenhouse --------------------------------------------------------------------------------------------------

_GH_KIND: dict[str, Kind] = {"input_text": "text", "textarea": "textarea", "input_file": "file",
                             "multi_value_single_select": "select", "multi_value_multi_select": "multiselect",
                             "input_hidden": "text"}
_GH_STANDARD: dict[str, Standard] = {"first_name": "first_name", "last_name": "last_name", "email": "email",
                                     "phone": "phone", "resume": "resume", "cover_letter": "cover_letter"}


def _gh_question(q: dict[str, Any], section: Section) -> FormQuestion | None:
    fields = [f for f in q.get("fields") or [] if isinstance(f, dict) and f.get("type") != "input_hidden"]
    if not fields:
        return None
    # A file question also offers a textarea to paste into ("resume" + "resume_text"): the file is the field.
    f = next((x for x in fields if x.get("type") == "input_file"), fields[0])
    name = str(f.get("name") or "")
    label = _text(q.get("label"), 500)
    options = [Option(label=_text(v.get("label"), 300), value=str(v.get("value")))
               for v in f.get("values") or [] if isinstance(v, dict)]
    return FormQuestion(id=name, label=label, kind=_GH_KIND.get(str(f.get("type")), "text"),
                        required=bool(q.get("required")), options=options, section=section,
                        standard=_GH_STANDARD.get(name) or _standard_by_label(label),
                        description=_text(q.get("description"), 4000))


def greenhouse_form(data: dict[str, Any]) -> list[FormQuestion]:
    out: list[FormQuestion] = []
    for q in data.get("questions") or []:
        if isinstance(q, dict) and (fq := _gh_question(q, "application")):
            out.append(fq)
    for q in data.get("location_questions") or []:
        if isinstance(q, dict) and (fq := _gh_question(q, "application")):
            out.append(fq.model_copy(update={"standard": fq.standard or "location"}))
    for block in data.get("compliance") or []:
        for q in (block or {}).get("questions") or []:
            if isinstance(q, dict) and (fq := _gh_question(q, "eeo")):
                out.append(fq)
    demo = data.get("demographic_questions")
    if isinstance(demo, dict):
        for q in demo.get("questions") or []:
            if not isinstance(q, dict):
                continue
            options = [Option(label=_text(a.get("label"), 300), value=str(a.get("id")))
                       for a in q.get("answer_options") or [] if isinstance(a, dict)]
            out.append(FormQuestion(id=f"demographic_{q.get('id')}", label=_text(q.get("label"), 500),
                                    kind="multiselect" if q.get("type") == "multi_value_multi_select" else "select",
                                    required=bool(q.get("required")), options=options, section="eeo"))
    for gdpr in data.get("data_compliance") or []:
        if isinstance(gdpr, dict) and gdpr.get("requires_consent"):
            out.append(FormQuestion(id="data_compliance[gdpr_consent_given]", kind="checkbox", required=True,
                                    section="consent",
                                    label="I consent to the processing of my personal data for this application"))
    return out


# ---- Lever -------------------------------------------------------------------------------------------------------

_LEVER_KIND: dict[str, Kind] = {"text": "text", "textarea": "textarea", "multiple-choice": "select",
                                "multiple-select": "multiselect", "dropdown": "select", "file-upload": "file",
                                "date": "date"}
_LEVER_STANDARD: tuple[tuple[str, Standard, str, Kind], ...] = (
    ("resume", "resume", "Resume/CV", "file"), ("name", "full_name", "Full name", "text"),
    ("email", "email", "Email", "email"), ("phone", "phone", "Phone", "phone"),
    ("location", "location", "Current location", "text"), ("org", "current_company", "Current company", "text"),
)
_INPUT = re.compile(r"<(input|textarea|select)\b([^>]*)>", re.I)
_ATTR = re.compile(r'([\w\-\[\]]+)\s*=\s*"([^"]*)"')


def _attrs(tag: str) -> dict[str, str]:
    out = {k.lower(): html.unescape(v) for k, v in _ATTR.findall(tag)}
    if re.search(r"\srequired(?:\s|=|/|$)", " " + tag):
        out["required"] = "required"
    return out


def lever_form(page: str) -> list[FormQuestion]:
    """The apply page's form: its standard fields (required when the page marks them so), its custom question
    cards, the links it asks for, the additional-information box and the EEO survey."""
    inputs = [(t.lower(), _attrs(a)) for t, a in _INPUT.findall(page)]
    names = {a.get("name", ""): (t, a) for t, a in inputs}
    out: list[FormQuestion] = []
    for name, standard, label, kind in _LEVER_STANDARD:
        if name in names:
            attrs = names[name][1]
            out.append(FormQuestion(id=name, label=label, kind=kind, standard=standard,
                                    required="required" in attrs or name in ("resume", "name", "email")))
    for name in names:
        m = re.fullmatch(r"urls\[(.+)\]", name)
        if m:
            label = m.group(1).strip()
            out.append(FormQuestion(id=name, label=label, kind="url", required="required" in names[name][1],
                                    standard=_standard_by_label(label) or ("website" if label.lower() in (
                                        "portfolio", "other") else None)))
    for card, raw in re.findall(r'value="([^"]*)"[^>]*name="cards\[([^\]]+)\]\[baseTemplate\]"', page):
        try:
            template = json.loads(html.unescape(card))
        except ValueError:
            continue
        for i, f in enumerate(template.get("fields") or []):
            if not isinstance(f, dict):
                continue
            options = [Option(label=_text(o.get("text"), 300), value=_text(o.get("text"), 300))
                       for o in f.get("options") or [] if isinstance(o, dict)]
            label = _text(f.get("text"), 2000)
            out.append(FormQuestion(id=f"cards[{raw}][field{i}]", label=label,
                                    kind=_LEVER_KIND.get(str(f.get("type")), "text"), required=bool(f.get("required")),
                                    options=options, description=_text(f.get("description"), 4000),
                                    standard=_standard_by_label(label)))
    if "comments" in names:
        out.append(FormQuestion(id="comments", label="Additional information", kind="textarea",
                                standard="cover_letter"))
    for eeo in ("gender", "race", "veteran", "disability"):
        name = f"eeo[{eeo}]"
        if name in names:
            options = [Option(label=html.unescape(label).strip(), value=html.unescape(value))
                       for value, label in re.findall(
                           r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>',
                           _select_body(page, name))]
            out.append(FormQuestion(id=name, label=eeo.capitalize(), kind="select", section="eeo",
                                    options=[o for o in options if o.value]))
    return out


def _select_body(page: str, name: str) -> str:
    m = re.search(r'<select[^>]*name="' + re.escape(name) + r'"[^>]*>(.*?)</select>', page, re.S | re.I)
    return m.group(1) if m else ""


# ---- Ashby -------------------------------------------------------------------------------------------------------

_ASHBY_KIND: dict[str, Kind] = {"String": "text", "LongText": "textarea", "Email": "email", "Phone": "phone",
                                "File": "file", "ValueSelect": "select", "MultiValueSelect": "multiselect",
                                "Boolean": "boolean", "Number": "number", "Date": "date", "Location": "text",
                                "SocialLink": "url", "Url": "url"}
_ASHBY_STANDARD: dict[str, Standard] = {"_systemfield_name": "full_name", "_systemfield_email": "email",
                                        "_systemfield_resume": "resume", "_systemfield_location": "location"}
ASHBY_QUERY = (
    "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting("
    "organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id title "
    "applicationForm { id sections { title fieldEntries { ... on FormFieldEntry { id field isRequired isHidden "
    "descriptionHtml } } } } surveyForms { id sections { title fieldEntries { ... on FormFieldEntry { id field "
    "isRequired isHidden } } } } } }")


def _ashby_entries(form: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in (form or {}).get("sections") or []:
        out += [e for e in (s or {}).get("fieldEntries") or [] if isinstance(e, dict) and e.get("field")]
    return out


def _ashby_question(e: dict[str, Any], section: Section) -> FormQuestion | None:
    f = e["field"]
    if e.get("isHidden") or f.get("isDeactivated"):
        return None
    path = str(f.get("path") or f.get("id") or "")
    ftype = str(f.get("type") or "String")
    label = _text(f.get("title"), 500)
    options = [Option(label=_text(v.get("label"), 300), value=str(v.get("value", v.get("label"))))
               for v in f.get("selectableValues") or [] if isinstance(v, dict)]
    standard = _ASHBY_STANDARD.get(path) or ("phone" if ftype == "Phone" else None) or _standard_by_label(label)
    return FormQuestion(id=path, label=label, kind=_ASHBY_KIND.get(ftype, "text"), required=bool(e.get("isRequired")),
                        options=options, section=section, standard=standard,
                        description=_text(e.get("descriptionHtml"), 4000))


def ashby_form(data: dict[str, Any]) -> list[FormQuestion]:
    posting = ((data or {}).get("data") or {}).get("jobPosting") or {}
    if not posting:
        raise FormError("Ashby returned no posting (closed or unlisted)")
    out = [q for e in _ashby_entries(posting.get("applicationForm")) if (q := _ashby_question(e, "application"))]
    for survey in posting.get("surveyForms") or []:
        out += [q for e in _ashby_entries(survey) if (q := _ashby_question(e, "eeo"))]
    return out


# ---- the standard fields, when a form can't be read --------------------------------------------------------------

def standard_form(ats: str) -> list[FormQuestion]:
    base = [FormQuestion(id="resume", label="Resume/CV", kind="file", required=True, standard="resume"),
            FormQuestion(id="email", label="Email", kind="email", required=True, standard="email"),
            FormQuestion(id="phone", label="Phone", kind="phone", required=False, standard="phone"),
            FormQuestion(id="linkedin", label="LinkedIn profile", kind="url", standard="linkedin")]
    if ats == "greenhouse":
        names = [FormQuestion(id="first_name", label="First name", kind="text", required=True, standard="first_name"),
                 FormQuestion(id="last_name", label="Last name", kind="text", required=True, standard="last_name")]
    else:
        names = [FormQuestion(id="name", label="Full name", kind="text", required=True, standard="full_name")]
    return [*names, *base]


# ---- fetching ----------------------------------------------------------------------------------------------------


class FormClient:
    """Fetches only from HOSTS. `transport` is for tests (httpx.MockTransport): no test reaches the network."""

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(transport=transport, timeout=TIMEOUT, trust_env=False,
                                         follow_redirects=False, headers={"User-Agent": USER_AGENT})

    async def __aenter__(self) -> FormClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def _request(self, method: str, url: str, **kw: Any) -> bytes:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname not in HOSTS:
            raise FormError(f"refused to call {parts.hostname!r}: not an ATS form host")
        try:
            async with self._client.stream(method, url, **kw) as resp:
                if resp.status_code >= 300:
                    raise FormError(f"HTTP {resp.status_code} from {parts.hostname}")
                body = bytearray()
                async for chunk in resp.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise FormError(f"form from {parts.hostname} is too big")
                return bytes(body)
        except httpx.HTTPError as e:
            raise FormError(f"{type(e).__name__} calling {parts.hostname}") from e

    async def get_json(self, url: str, **kw: Any) -> Any:
        try:
            return json.loads(await self._request("GET", url, headers={"Accept": "application/json"}, **kw))
        except ValueError as e:
            raise FormError("not JSON") from e

    async def get_text(self, url: str) -> str:
        return (await self._request("GET", url, headers={"Accept": "text/html"})).decode("utf-8", "replace")

    async def post_json(self, url: str, body: dict[str, Any]) -> Any:
        try:
            return json.loads(await self._request("POST", url, json=body, headers={"Accept": "application/json"}))
        except ValueError as e:
            raise FormError("not JSON") from e


async def fetch_form(client: FormClient, ats: str, tenant: str, job_ref: str) -> list[FormQuestion]:
    t, j = quote(tenant, safe=""), quote(job_ref, safe="")
    if ats == "greenhouse":
        data = await client.get_json(f"https://boards-api.greenhouse.io/v1/boards/{t}/jobs/{j}",
                                     params={"questions": "true"})
        if not isinstance(data, dict):
            raise FormError("Greenhouse sent something that isn't a job")
        return greenhouse_form(data)
    if ats == "lever":
        return lever_form(await client.get_text(f"https://jobs.lever.co/{t}/{j}/apply"))
    if ats == "ashby":
        data = await client.post_json(
            "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
            {"operationName": "ApiJobPosting", "query": ASHBY_QUERY,
             "variables": {"organizationHostedJobsPageName": tenant, "jobPostingId": job_ref}})
        if not isinstance(data, dict):
            raise FormError("Ashby sent something that isn't a posting")
        return ashby_form(data)
    raise FormError(f"no form reader for {ats}")
