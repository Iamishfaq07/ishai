"""Small contract for advice anchored to server-owned facts. No tools or model-provided links."""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Tip(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    fact_id: str = Field(min_length=1, max_length=80)
    source_quote: str = Field(min_length=4, max_length=600)
    suggestion: str = Field(min_length=10, max_length=700)
    success_check: str = Field(min_length=10, max_length=400)


class Advice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tips: list[Tip] = Field(min_length=1, max_length=4)


class AdviceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(pattern=r"^[0-9a-f]{64}$")


FIELDS = ("fact_id", "source_quote", "suggestion", "success_check")


def validate_advice(raw: object, facts: list[dict[str, Any]]) -> Advice:
    """Keep each tip that quotes its fact exactly; a tip with a wrong id, a paraphrased quote, extra fields or a fact
    already used is dropped on its own, so one bad tip doesn't cost the review. No usable tip is a failed review."""
    allowed = {f["id"]: f["text"] for f in facts}
    rows = raw.get("tips") if isinstance(raw, dict) else None
    tips: list[Tip] = []
    used: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        try:
            tip = Tip.model_validate({k: row.get(k) for k in FIELDS})
        except ValueError:
            continue
        if tip.fact_id in used or tip.source_quote not in allowed.get(tip.fact_id, ""):
            continue
        used.add(tip.fact_id)
        tips.append(tip)
        if len(tips) == 4:
            break
    if not tips:
        raise ValueError("No tip quoted its source exactly")
    return Advice(tips=tips)


INSTRUCTION = ('Return JSON {"tips":[{"fact_id":"one supplied id","source_quote":"exact substring of its text",'
    '"suggestion":"a practical experiment the user can review","success_check":"how to check the result"}]}. '
    'Choose up to four different facts. Do not invent numbers, qualifications, results or market benchmarks. '
    'No links or markdown. Never claim to have completed an action. Suggestions are experiments, not predictions. ')
