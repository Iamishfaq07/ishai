"""Read-only practice choices from a candidate's prior fit check. No exercises become claims."""
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel

from .resume_lineage import digest

PracticeKind = Literal["project", "explanation", "code"]
KINDS: dict[PracticeKind, str] = {
    "project": "a small project or demonstration with a concrete artifact",
    "explanation": "an explanation with a worked example and explicit limitations",
    "code": "a small coding exercise with candidate-written code and observed checks",
}


class PracticeRequirement(BaseModel):
    key: str
    title: str
    status: Literal["met", "partial", "unclear", "missing", "unknown"]
    job_quote: str
    candidate_quote: str


class RequirementPractice(BaseModel):
    entry_id: str
    check_id: str | None
    checked_at: datetime | None
    version: str
    evidence_enabled: bool
    requirements: list[PracticeRequirement]


def text(value: Any, limit: int) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def choices(check_id: str, result: Any) -> list[PracticeRequirement]:
    rows = result.get("requirements", []) if isinstance(result, dict) else []
    if not isinstance(rows, list):
        return []
    selected: list[PracticeRequirement] = []
    for index, row in enumerate(rows[:20]):
        if not isinstance(row, dict) or not (title := text(row.get("requirement"), 500)):
            continue
        status = row.get("status")
        selected.append(PracticeRequirement(key=digest({"check": check_id, "index": index, "row": row}),
            title=title, status=status if status in ("met", "partial", "unclear", "missing") else "unknown",
            job_quote=text(row.get("job_quote"), 600),
            candidate_quote=text(row.get("resume_quote") or row.get("evidence_quote"), 600)))
    return selected


def practice_source(entry_id: str, check_id: str | None, created_at: datetime | None, result: Any,
                    evidence_enabled: bool) -> RequirementPractice:
    return RequirementPractice(entry_id=entry_id, check_id=check_id,
        checked_at=(created_at.replace(tzinfo=UTC) if created_at.tzinfo is None else created_at) if created_at else None,
        version=digest({"entry": entry_id, "check": check_id, "result": result}),
        evidence_enabled=evidence_enabled, requirements=choices(check_id, result) if check_id else [])


def practice_fact(item: PracticeRequirement, kind: PracticeKind) -> str:
    return (f"The candidate selected this prior fit-check requirement for practice: {item.title}. "
        f"The chosen practice format is {KINDS[kind]}. "
        "This is an uncompleted exercise, not a candidate achievement or proof of a skill. "
        "Propose one bounded task, an observable artifact, a way to check the actual result and one rehearsal prompt. "
        "Use synthetic or public example data; never request employer secrets. No invented metrics or outcomes. "
        "A fresher may use education, personal projects or an honest worked example. "
        "Only record a truthful story or evidence after doing and reviewing the work; do not update a resume.")
