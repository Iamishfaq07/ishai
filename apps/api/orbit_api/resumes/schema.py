"""The resume maker's data: what's on the resume (ResumeData) and how it looks (ResumeDesign).

Every field is bounded, so a resume can't grow without limit, and every list item carries a stable `id`, so the
editor can reorder items and an AI suggestion can name exactly the text it changes.
"""

import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SectionId = Literal["summary", "experience", "education", "skills", "projects", "certifications"]
DEFAULT_ORDER: list[SectionId] = ["summary", "experience", "skills", "projects", "education", "certifications"]
EXTRA_PREFIX = "extra:"  # an extra section's place in section_order: "extra:<its id>"
MAX_EXTRAS = 5
MAX_SKILL_GROUPS = 10
MAX_SKILLS_PER_GROUP = 40

# All single-column (ATS-safe) except "sidebar".
Template = Literal["classic", "modern", "compact", "sidebar", "elegant", "minimal", "bold", "executive", "campus",
                   "harvard"]
Font = Literal["inter", "arial", "georgia", "garamond", "grotesk", "calibri", "cambria", "helvetica", "times",
               "trebuchet"]
Spacing = Literal["compact", "normal", "relaxed"]
LineHeight = Literal["tight", "normal", "airy"]
SkillsStyle = Literal["list", "tags"]
PageSize = Literal["a4", "letter"]
MAX_TITLE = 40

MAX_PHOTO_CHARS = 400_000  # a data: URL; the editor shrinks photos to ~256 px before upload
_PHOTO = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _id() -> str:
    return new_id()


class Link(BaseModel):
    label: str = Field("", max_length=40)
    url: str = Field("", max_length=300)


class Basics(BaseModel):
    name: str = Field("", max_length=120)
    headline: str = Field("", max_length=160)
    email: str = Field("", max_length=200)
    phone: str = Field("", max_length=60)
    location: str = Field("", max_length=120)
    links: list[Link] = Field(default_factory=list, max_length=6)
    summary: str = Field("", max_length=1_500)


class Experience(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    title: str = Field("", max_length=160)
    company: str = Field("", max_length=160)
    location: str = Field("", max_length=120)
    start: str = Field("", max_length=40)
    end: str = Field("", max_length=40)
    current: bool = False
    bullets: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("bullets")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return [b[:400] for b in v]


class Education(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    school: str = Field("", max_length=160)
    degree: str = Field("", max_length=160)
    field: str = Field("", max_length=160)
    start: str = Field("", max_length=40)
    end: str = Field("", max_length=40)
    details: str = Field("", max_length=600)
    # The score as the marksheet gives it: "8.6 / 10 CGPA", "92%", "First Class". Resumes saved before it existed
    # load with it empty.
    grade: str = Field("", max_length=60)


class SkillGroup(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=60)
    items: list[str] = Field(default_factory=list, max_length=MAX_SKILLS_PER_GROUP)

    @field_validator("items")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [i[:60] for i in v]


def fold_skill_groups(groups: list[SkillGroup]) -> list[SkillGroup]:
    """At most MAX_SKILL_GROUPS groups: the skills of any past that join the kept groups with room (the roomiest
    first), without repeats; whatever doesn't fit is dropped."""
    kept, extra = groups[:MAX_SKILL_GROUPS], groups[MAX_SKILL_GROUPS:]
    have = {i.strip().lower() for g in kept for i in g.items}
    for item in (i.strip() for g in extra for i in g.items):
        if not item or item.lower() in have:
            continue
        roomiest = min(kept, key=lambda g: len(g.items))
        if len(roomiest.items) >= MAX_SKILLS_PER_GROUP:
            break
        roomiest.items.append(item)
        have.add(item.lower())
    return kept


class Project(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=160)
    link: str = Field("", max_length=300)
    description: str = Field("", max_length=600)
    # The same as a role's: the editor shares one bullet list, and a 9th bullet used to fail every save with a 422.
    bullets: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("bullets")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return [b[:400] for b in v]


class Certification(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=160)
    issuer: str = Field("", max_length=160)
    date: str = Field("", max_length=40)


class ExtraSection(BaseModel):
    """A section beyond the standard ones: Languages, Awards, Volunteering, Publications, Interests or anything the
    user names. One line per item, shown as a bulleted list or run together on one line."""

    id: str = Field(default_factory=_id, max_length=40)
    title: str = Field("", max_length=60)
    items: list[str] = Field(default_factory=list, max_length=20)
    style: Literal["bullets", "inline"] = "bullets"

    @field_validator("items")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [i[:300] for i in v]


class ResumeData(BaseModel):
    basics: Basics = Field(default_factory=Basics)
    experience: list[Experience] = Field(default_factory=list, max_length=20)
    education: list[Education] = Field(default_factory=list, max_length=10)
    skills: list[SkillGroup] = Field(default_factory=list, max_length=MAX_SKILL_GROUPS)
    projects: list[Project] = Field(default_factory=list, max_length=10)
    certifications: list[Certification] = Field(default_factory=list, max_length=20)
    extras: list[ExtraSection] = Field(default_factory=list, max_length=MAX_EXTRAS)
    # Standard section ids, and "extra:<id>" for each extra section.
    section_order: list[str] = Field(default_factory=lambda: [str(s) for s in DEFAULT_ORDER], max_length=16)
    # Sections kept in the editor but left off the resume (preview, PDF, Word and the ATS score).
    hidden: list[str] = Field(default_factory=list, max_length=16)
    # Own headings for the standard sections ("Work experience" for "experience"); extras have their own titles.
    titles: dict[str, str] = Field(default_factory=dict, max_length=6)

    @field_validator("skills", mode="before")
    @classmethod
    def _skill_groups(cls, v: object) -> object:
        """An 11th skill group (an editor that added one past the limit) used to fail every save and every AI request
        with "List should have at most 10 items": its skills join the other groups instead. A list far past the limit
        isn't a resume, so it's left to fail."""
        if not isinstance(v, list) or not MAX_SKILL_GROUPS < len(v) <= 4 * MAX_SKILL_GROUPS:
            return v
        return fold_skill_groups([SkillGroup.model_validate(g) for g in v])

    @model_validator(mode="after")
    def _order(self) -> "ResumeData":
        """Every section keeps exactly one place: unknown or duplicate entries are dropped, and missing ones (a new
        extra section, or a standard one an older client left out) go at the end. Hidden sections and headings only
        name sections that exist."""
        known: list[str] = list(dict.fromkeys([*DEFAULT_ORDER, *(EXTRA_PREFIX + x.id for x in self.extras)]))
        seen = [s for s in dict.fromkeys(self.section_order) if s in known]
        self.section_order = seen + [s for s in known if s not in seen]
        self.hidden = [s for s in dict.fromkeys(self.hidden) if s in known]
        self.titles = {k: " ".join(v.split())[:MAX_TITLE] for k, v in self.titles.items()
                       if k in DEFAULT_ORDER and v.strip()}
        return self

    def visible(self) -> "ResumeData":
        """The resume as it prints: hidden sections emptied (what the score, the Word file and the AI look at)."""
        if not self.hidden:
            return self
        out = self.model_copy(deep=True)
        hidden = set(self.hidden)
        if "summary" in hidden:
            out.basics.summary = ""
        for key in ("experience", "education", "skills", "projects", "certifications"):
            if key in hidden:
                setattr(out, key, [])
        out.extras = [x for x in out.extras if EXTRA_PREFIX + x.id not in hidden]
        return out


class ResumeDesign(BaseModel):
    template: Template = "classic"
    accent: str = "#4f46e5"
    font: Font = "inter"
    font_size: float = Field(10.5, ge=9, le=12.5)
    spacing: Spacing = "normal"
    line_height: LineHeight = "normal"
    skills_style: SkillsStyle = "list"
    page: PageSize = "a4"
    photo: str | None = Field(None, max_length=MAX_PHOTO_CHARS)
    show_photo: bool = False

    @field_validator("accent")
    @classmethod
    def _accent(cls, v: str) -> str:
        if not _HEX.fullmatch(v):  # fullmatch: with .match, "$" lets a trailing newline through
            raise ValueError("accent must be a #rrggbb colour")
        return v.lower()

    @field_validator("photo")
    @classmethod
    def _photo(cls, v: str | None) -> str | None:
        if v is not None and not _PHOTO.fullmatch(v):
            raise ValueError("photo must be a PNG, JPEG or WebP data URL")
        return v
