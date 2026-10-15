"""Reading a LinkedIn profile: the text of LinkedIn's own "Save to PDF" (or the profile pasted), into its sections.

The AI only sorts the text into sections, copying it: the headline, About and each role's description must be in the
source word for word (spacing and bullets aside), else they're left empty rather than trusted. The audit (audit.py)
then measures what's actually on the profile.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from orbit_api.live.context_builder import fence
from orbit_api.providers.llm.base import LLMMessage, LLMProvider, LLMRequest
from orbit_api.resumes.ai import _json

log = logging.getLogger(__name__)

MAX_SOURCE = 40_000
HEADLINE_MAX = 220  # LinkedIn's limits
ABOUT_MAX = 2_600


class Role(BaseModel):
    title: str = Field("", max_length=200)
    company: str = Field("", max_length=200)
    dates: str = Field("", max_length=80)
    current: bool = False
    description: str = Field("", max_length=4_000)


class School(BaseModel):
    school: str = Field("", max_length=200)
    degree: str = Field("", max_length=200)


class Profile(BaseModel):
    name: str = Field("", max_length=120)
    headline: str = Field("", max_length=HEADLINE_MAX)
    location: str = Field("", max_length=120)
    about: str = Field("", max_length=ABOUT_MAX)
    url: str = Field("", max_length=300)
    experience: list[Role] = Field(default_factory=list, max_length=30)
    education: list[School] = Field(default_factory=list, max_length=10)
    skills: list[str] = Field(default_factory=list, max_length=100)
    certifications: list[str] = Field(default_factory=list, max_length=30)


SYSTEM = """You sort the text of a LinkedIn profile (LinkedIn's "Save to PDF", or the profile copied) into its
sections. Copy text exactly as it appears; never rewrite, summarise, fix or add anything. Leave out page footers
("Page 1 of 3") and the "Contact" block's labels.

Return ONLY a JSON object:
{"name": "", "headline": "the line under the name", "location": "",
 "about": "the Summary / About section, exactly",
 "url": "the linkedin.com/in/... address if shown",
 "experience": [{"title": "", "company": "", "dates": "as written, e.g. January 2021 - Present (3 years 2 months)",
                 "current": true if it runs to Present, "description": "the role's text, exactly, or empty"}],
 "education": [{"school": "", "degree": ""}],
 "skills": ["every skill listed (Top Skills and any Skills section)"],
 "certifications": ["..."]}
Most recent role first. Empty string or [] for anything not there."""


def read_request(text: str, llm: LLMProvider) -> LLMRequest:
    return LLMRequest(
        messages=[LLMMessage("system", SYSTEM),
                  LLMMessage("user", f"<reference_data source=\"linkedin_profile\">\n{fence(text[:MAX_SOURCE])}\n"
                                     "</reference_data>")],
        json_mode=llm.supports_structured_output(), max_tokens=4_000, temperature=0.0, request_type="linkedin_read")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[•●▪◦·\-–—*]+\s", " ", s)).strip().lower()


def _copied(value: Any, source: str, limit: int) -> str:
    """The text when it really is in the source (spacing and bullet marks aside), else ""."""
    text = str(value or "").strip()[:limit]
    if not text:
        return ""
    if _norm(text) in source:
        return text
    # A long section may have been joined across a page break: every sentence of it must still be there.
    parts = [p for p in re.split(r"(?<=[.!?])\s+|\n+", text) if len(p.strip()) > 12]
    if parts and all(_norm(p) in source for p in parts):
        return text
    return ""


def _short(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def parse_read(text: str, source: str) -> Profile:
    raw = _json(text)
    src = _norm(source)

    def items(key: str) -> list[Any]:
        v = raw.get(key)
        return v if isinstance(v, list) else []

    roles = []
    for r in items("experience")[:30]:
        if not isinstance(r, dict):
            continue
        title, company = _short(r.get("title"), 200), _short(r.get("company"), 200)
        if not (title or company):
            continue
        roles.append(Role(title=title, company=company, dates=_short(r.get("dates"), 80),
                          current=bool(r.get("current")) or "present" in str(r.get("dates") or "").lower(),
                          description=_copied(r.get("description"), src, 4_000)))
    schools = [School(school=_short(e.get("school"), 200), degree=_short(e.get("degree"), 200))
               for e in items("education")[:10]
               if isinstance(e, dict) and str(e.get("school") or "").strip()]

    def names(key: str, limit: int) -> list[str]:
        out = list(dict.fromkeys(_short(x, 80) for x in items(key) if isinstance(x, str) and x.strip()))
        return [x for x in out if _norm(x) in src][:limit]

    url = _short(raw.get("url"), 300)
    profile = Profile(name=_short(raw.get("name"), 120), headline=_copied(raw.get("headline"), src, HEADLINE_MAX),
                      location=_short(raw.get("location"), 120), about=_copied(raw.get("about"), src, ABOUT_MAX),
                      url=url if "linkedin.com/in/" in url.lower() else "", experience=roles, education=schools,
                      skills=names("skills", 100), certifications=names("certifications", 30))
    if not (profile.name or profile.headline or profile.experience):
        raise ValueError("nothing read")
    return profile
