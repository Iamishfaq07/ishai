"""Bounded lexical retrieval and exact citation validation for Business-owned text. No external fetches."""

import math
import re
from collections import Counter
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_STOP = frozenset(
    (
        "a an the and or for to in on of is are be we i our you your how what which when do does can should "
        "please from with as this that it at by into about me my have has"
    ).split()
)


def terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.casefold()) if len(w) > 1 and w not in _STOP]


def passages(body: str, size: int = 1000, overlap: int = 120) -> list[tuple[int, str]]:
    """Preserve original character spans so citations can be checked without normalization."""
    result = []
    start = 0
    while start < len(body):
        end = min(start + size, len(body))
        if end < len(body):
            space = max(body.rfind("\n", start + size // 2, end), body.rfind(" ", start + size // 2, end))
            if space > start:
                end = space
        result.append((start, body[start:end]))
        if end == len(body):
            break
        start = max(start + 1, end - overlap)
    return result


def retrieve(documents: list[dict[str, Any]], question: str, limit: int = 8) -> list[dict[str, Any]]:
    query = set(terms(question))
    if not query:
        return []
    candidates = []
    for doc in documents:
        for index, (offset, text) in enumerate(passages(doc["body"])):
            counts = Counter(terms(text))
            candidates.append(
                {
                    "id": f"{doc['id']}:{doc['revision']}:{index}",
                    "document_id": doc["id"],
                    "revision": doc["revision"],
                    "title": doc["title"],
                    "text": text,
                    "offset": offset,
                    "review_overdue": doc["review_overdue"],
                    "counts": counts,
                    "title_terms": set(terms(doc["title"])),
                }
            )
    frequency = Counter(word for c in candidates for word in query if word in c["counts"])
    ranked = []
    for c in candidates:
        matches = query & (c["counts"].keys() | c["title_terms"])
        if not matches:
            continue
        score = sum(
            math.log(1 + len(candidates) / (1 + frequency[w]))
            * (min(c["counts"][w], 3) + (2 if w in c["title_terms"] else 0))
            for w in matches
        )
        score *= len(matches) / len(query)
        ranked.append((score, c))
    ranked.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    selected = []
    per_document: Counter[str] = Counter()
    for _, c in ranked:
        if per_document[c["document_id"]] >= 3:
            continue
        per_document[c["document_id"]] += 1
        selected.append({k: v for k, v in c.items() if k not in ("counts", "title_terms")})
        if len(selected) == limit:
            break
    return selected


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    passage_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=8, max_length=600)
    text: str = Field(min_length=10, max_length=800)


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["answered", "insufficient"]
    points: list[Point] = Field(max_length=6)

    @model_validator(mode="after")
    def supported_status(self) -> "Answer":
        if (self.status == "answered") != bool(self.points):
            raise ValueError("An answer needs evidence; an abstention cannot include unsupported points.")
        return self


def validate_answer(raw: object, sources: list[dict[str, Any]]) -> Answer:
    answer = Answer.model_validate(raw)
    allowed = {s["id"]: s["text"] for s in sources}
    for point in answer.points:
        if point.passage_id not in allowed or point.quote not in allowed[point.passage_id]:
            raise ValueError("Each answer point must quote a supplied passage exactly.")
    return answer
