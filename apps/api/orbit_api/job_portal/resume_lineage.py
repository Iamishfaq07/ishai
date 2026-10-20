"""Compare owned, stored resume versions. No writes, delivery inference, model calls or external fetching."""
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from orbit_api.models import Resume, ResumeSnapshot

SECTIONS = (
    ("basics", "Contact and summary"), ("experience", "Experience"), ("education", "Education"),
    ("skills", "Skills"), ("projects", "Projects"), ("certifications", "Certifications"), ("extras", "Extra sections"),
)
LAYOUT_KEYS = {"section_order", "hidden", "titles"}
DATA_KEYS = {key for key, _ in SECTIONS} | LAYOUT_KEYS
MAX_EXCERPT = 3000


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def parts(version: Resume | ResumeSnapshot) -> dict[str, Any]:
    data = version.data or {}
    result = {key: data.get(key) for key, _ in SECTIONS}
    result["layout"] = {key: data[key] for key in LAYOUT_KEYS if key in data}
    result["other"] = {key: value for key, value in data.items() if key not in DATA_KEYS}
    result["design"] = version.design or {}
    result["job_text"] = version.job_text or ""
    return result


def summary(saved: ResumeSnapshot, current: Resume | None) -> dict[str, Any]:
    before = parts(saved)
    after = parts(current) if current else None
    changed = [key for key in before if after is not None and canonical(before[key]) != canonical(after[key])]
    return {"content_matches": not changed if after is not None else None, "changed_sections": changed,
        "same_source": saved.resume_id == current.id if current and saved.resume_id else None,
        "version": digest({"saved_id": saved.id, "saved": before, "current_id": current.id if current else None,
                           "current": after})}


def readable(value: Any) -> str:
    if isinstance(value, dict):
        lines = [f"{str(key).replace('_', ' ').capitalize()}: {readable(item)}"
                 for key, item in sorted(value.items(), key=lambda pair: str(pair[0])) if key != "id"]
        return "\n".join(lines) or "Nothing stored"
    if isinstance(value, list):
        return "\n\n".join(f"{index + 1}. {readable(item)}" for index, item in enumerate(value)) or "Nothing stored"
    if value is None:
        return "Not stored"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def excerpt(value: Any, *, design: bool = False) -> tuple[str, bool]:
    if design and isinstance(value, dict):
        # Compare the original photo in the version digest, but never return image bytes in a text diff.
        value = {key: (f"Photo present (fingerprint {digest(item)[:12]})" if item else "No photo")
                 if key == "photo" else item for key, item in value.items()}
    text = readable(value)
    return text[:MAX_EXCERPT], len(text) > MAX_EXCERPT


class VersionSection(BaseModel):
    key: str
    label: str
    changed: bool | None
    saved_text: str
    current_text: str | None
    saved_truncated: bool
    current_truncated: bool


class VersionComparison(BaseModel):
    entry_id: str
    snapshot_id: str
    version: str
    saved_title: str
    saved_at: str
    current_id: str | None
    current_title: str | None
    current_updated_at: str | None
    same_source: bool | None
    content_matches: bool | None
    changed_sections: list[str]
    sections: list[VersionSection]


def stamp(value: datetime) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).astimezone(UTC).isoformat()


def comparison(entry_id: str, saved: ResumeSnapshot, current: Resume | None) -> VersionComparison:
    state = summary(saved, current)
    before, after = parts(saved), parts(current) if current else None
    labels = [*SECTIONS, ("layout", "Section order, headings and visibility"), ("other", "Other stored fields"),
              ("design", "Design and photo"), ("job_text", "Target job text saved with this resume")]
    sections = []
    for key, label in labels:
        old_text, old_cut = excerpt(before[key], design=key == "design")
        new_text, new_cut = excerpt(after[key], design=key == "design") if after else (None, False)
        sections.append(VersionSection(key=key, label=label,
            changed=key in state["changed_sections"] if after is not None else None,
            saved_text=old_text, current_text=new_text, saved_truncated=old_cut, current_truncated=new_cut))
    return VersionComparison(entry_id=entry_id, snapshot_id=saved.id, saved_title=saved.title,
        saved_at=stamp(saved.created_at), current_id=current.id if current else None,
        current_title=current.title if current else None,
        current_updated_at=stamp(current.updated_at) if current else None, sections=sections, **state)
