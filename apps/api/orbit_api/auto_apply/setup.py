"""The candidate's Orbit Apply setup: the facts they confirm and the filters jobs must pass. Validated here; stored
on AutoApplySetup as JSON.

Every fact is the candidate's own: filled in from the master resume as a suggestion, then confirmed or corrected by
them in the setup wizard. A fact left empty is never guessed. A form that asks for it stops and asks the candidate
(rules.py, rule 1). Salary is optional on purpose, and current salary most of all: nothing ever fills it in for
them.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from orbit_api.auto_apply import rules
from orbit_api.job_portal.postings import Level, Workplace

Mode = Literal["automatic", "review"]


class WorkAuth(BaseModel):
    """Work authorisation for one country, as the candidate states it. None: not said, so a form asking stops."""

    country: str = Field(min_length=2, max_length=2)  # ISO 3166-1 alpha-2
    authorized: bool | None = None
    needs_sponsorship: bool | None = None

    @field_validator("country")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class Facts(BaseModel):
    first_name: str = Field("", max_length=80)
    last_name: str = Field("", max_length=80)
    email: str = Field("", max_length=200)
    phone: str = Field("", max_length=40)
    city: str = Field("", max_length=80)
    country: str = Field("", max_length=2)  # where the candidate lives
    linkedin: str = Field("", max_length=300)
    website: str = Field("", max_length=300)
    github: str = Field("", max_length=300)
    current_company: str = Field("", max_length=160)
    current_title: str = Field("", max_length=160)
    years_experience: float | None = Field(None, ge=0, le=60)
    highest_degree: str = Field("", max_length=160)
    work_auth: list[WorkAuth] = Field(default_factory=list, max_length=12)
    notice_period_days: int | None = Field(None, ge=0, le=365)
    earliest_start: str = Field("", max_length=120)  # "Two weeks after an offer", "2026-12-01"
    willing_to_relocate: bool | None = None
    expected_salary: str = Field("", max_length=80)  # optional: "₹28 LPA", "$150,000"
    current_salary: str = Field("", max_length=80)  # optional, never asked for by Orbit itself

    @field_validator("country")
    @classmethod
    def _country(cls, v: str) -> str:
        return v.upper()

    def auth_for(self, country: str | None) -> WorkAuth | None:
        if not country:
            return None
        return next((a for a in self.work_auth if a.country == country.upper()), None)

    def full_name(self) -> str:
        return " ".join(x for x in (self.first_name.strip(), self.last_name.strip()) if x)

    def location(self) -> str:
        return ", ".join(x for x in (self.city.strip(), self.country.strip()) if x)


def _clean(items: list[str], limit: int, item_limit: int) -> list[str]:
    out: list[str] = []
    for raw in items:
        item = " ".join(raw.split())[:item_limit]
        if item and item.lower() not in {o.lower() for o in out}:
            out.append(item)
    return out[:limit]


class Filters(BaseModel):
    """What a job must pass before Orbit applies to it. Empty lists mean "what the Jobs AI profile says"."""

    titles: list[str] = Field(default_factory=list, max_length=12)
    keywords: list[str] = Field(default_factory=list, max_length=12)  # each must appear in the title or skills
    locations: list[str] = Field(default_factory=list, max_length=12)
    workplace: list[Workplace] = Field(default_factory=list, max_length=3)
    countries: list[str] = Field(default_factory=list, max_length=8)  # where the job may be; empty: the user's own
    seniority: list[Level] = Field(default_factory=list, max_length=4)
    salary_floor: int | None = Field(None, ge=0, le=100_000_000)  # yearly, in the post's own currency figures
    exclude_companies: list[str] = Field(default_factory=list, max_length=50)
    days: int = Field(rules.DEFAULT_FRESH_DAYS, ge=1, le=rules.MAX_FRESH_DAYS)

    @field_validator("titles", "keywords", "locations")
    @classmethod
    def _lists(cls, v: list[str]) -> list[str]:
        return _clean(v, 8, 80)

    @field_validator("exclude_companies")
    @classmethod
    def _companies(cls, v: list[str]) -> list[str]:
        return _clean(v, 50, 120)

    @field_validator("countries")
    @classmethod
    def _countries(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(c.upper() for c in v if len(c.strip()) == 2))

    @field_validator("workplace", "seniority")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class QuietHours(BaseModel):
    start: int = Field(ge=0, le=1439)  # minutes from midnight, the candidate's own time
    end: int = Field(ge=0, le=1439)


def in_quiet_hours(start: int | None, end: int | None, minute_of_day: int) -> bool:
    """Whether `minute_of_day` falls in the quiet window [start, end), which may wrap past midnight."""
    if start is None or end is None or start == end:
        return False
    if start < end:
        return start <= minute_of_day < end
    return minute_of_day >= start or minute_of_day < end
