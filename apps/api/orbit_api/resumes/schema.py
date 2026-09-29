"""The resume maker's data: what's on the resume (ResumeData) and how it looks (ResumeDesign).

Every field is bounded, so a resume can't grow without limit, and every list item carries a stable `id`, so the
editor can reorder items and an AI suggestion can name exactly the text it changes.
"""

import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SectionId = Literal["summary", "experience", "education", "skills", "projects", "certifications"]
DEFAULT_ORDER: list[SectionId] = ["summary", "experience", "skills", "projects", "education", "certifications"]

Template = Literal["classic", "modern", "compact", "sidebar"]
Font = Literal["inter", "arial", "georgia", "garamond", "grotesk"]
Spacing = Literal["compact", "normal", "relaxed"]
PageSize = Literal["a4", "letter"]

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


class SkillGroup(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=60)
    items: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("items")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [i[:60] for i in v]


class Project(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=160)
    link: str = Field("", max_length=300)
    description: str = Field("", max_length=600)
    bullets: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("bullets")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return [b[:400] for b in v]


class Certification(BaseModel):
    id: str = Field(default_factory=_id, max_length=40)
    name: str = Field("", max_length=160)
    issuer: str = Field("", max_length=160)
    date: str = Field("", max_length=40)


class ResumeData(BaseModel):
    basics: Basics = Field(default_factory=Basics)
    experience: list[Experience] = Field(default_factory=list, max_length=20)
    education: list[Education] = Field(default_factory=list, max_length=10)
    skills: list[SkillGroup] = Field(default_factory=list, max_length=10)
    projects: list[Project] = Field(default_factory=list, max_length=10)
    certifications: list[Certification] = Field(default_factory=list, max_length=20)
    section_order: list[SectionId] = Field(default_factory=lambda: list(DEFAULT_ORDER), max_length=6)

    @field_validator("section_order")
    @classmethod
    def _order(cls, v: list[SectionId]) -> list[SectionId]:
        seen = list(dict.fromkeys(v))
        return seen + [s for s in DEFAULT_ORDER if s not in seen]  # every section keeps a place


class ResumeDesign(BaseModel):
    template: Template = "classic"
    accent: str = "#4f46e5"
    font: Font = "inter"
    font_size: float = Field(10.5, ge=9, le=12.5)
    spacing: Spacing = "normal"
    page: PageSize = "a4"
    photo: str | None = Field(None, max_length=MAX_PHOTO_CHARS)
    show_photo: bool = False

    @field_validator("accent")
    @classmethod
    def _accent(cls, v: str) -> str:
        if not _HEX.match(v):
            raise ValueError("accent must be a #rrggbb colour")
        return v.lower()

    @field_validator("photo")
    @classmethod
    def _photo(cls, v: str | None) -> str | None:
        if v is not None and not _PHOTO.match(v):
            raise ValueError("photo must be a PNG, JPEG or WebP data URL")
        return v
