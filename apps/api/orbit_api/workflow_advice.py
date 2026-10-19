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


def validate_advice(raw: object, facts: list[dict[str, Any]]) -> Advice:
    advice = Advice.model_validate(raw)
    allowed = {f["id"]: f["text"] for f in facts}
    if len({tip.fact_id for tip in advice.tips}) != len(advice.tips):
        raise ValueError("Use different source facts")
    for tip in advice.tips:
        if tip.source_quote not in allowed[tip.fact_id]:
            raise ValueError("Source quote is not supported")
    return advice


INSTRUCTION = ('Return JSON {"tips":[{"fact_id":"one supplied id","source_quote":"exact substring of its text",'
    '"suggestion":"a practical experiment the user can review","success_check":"how to check the result"}]}. '
    'Choose up to four different facts. Do not invent numbers, qualifications, results or market benchmarks. '
    'No links or markdown. Never claim to have completed an action. Suggestions are experiments, not predictions. ')
