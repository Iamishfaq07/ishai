"""The AI's negotiation plan for one offer: the number to ask for and why, what to say on the call, the email that
puts it in writing, what to ask about the offer, and what to watch for.

Grounded like the fit check (job_portal/fit.py): a reason may cite only the offer, the market range Orbit read and
the resume or confirmed evidence, so one with a figure none of them gives is dropped; the ask is kept between the
offer and half as much again, and is never below what's on the table.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel

from orbit_api.live.context_builder import fence
from orbit_api.providers.llm.base import LLMMessage, LLMProvider, LLMRequest
from orbit_api.region import localize
from orbit_api.resumes.ai import _json
from orbit_api.resumes.claims import invented_figures

log = logging.getLogger(__name__)

MAX_REASONS = 4


class Email(BaseModel):
    subject: str
    body: str


class Plan(BaseModel):
    ask: int  # the fixed pay a year to ask for
    ask_why: str
    reasons: list[str]  # what makes the case, from the resume, the evidence and the market
    call_script: list[str]  # what to say, in order
    email: Email
    questions: list[str]  # about the offer, before accepting
    watch_outs: list[str]  # in this offer


SYSTEM = """You help a candidate__IN_COUNTRY__ negotiate a job offer. Write in __ENGLISH__, plainly, in the
candidate's voice where they speak.

You get the offer, the market range Orbit read from job posts for this role (it may be missing), the candidate's
resume and their confirmed evidence. Use only these. Never invent a figure, a competing offer or an achievement.

Return ONLY a JSON object:
{"ask": number (the __FIXED__ a year to ask for, same currency as the offer: anchored on the market range when there
is one, usually 10-20% above the offer, never below it),
 "ask_why": "one sentence: why this number",
 "reasons": ["2-4 points that make the case, each from the resume, the evidence or the market range"],
 "call_script": ["4-7 short lines to say on the call, in order: thanks and enthusiasm, the ask with the reason,
   then silence; how to answer 'the budget is fixed'; what to trade for (__JOINING__, review in 6 months, more
   __VARIABLE__, a start date) if the __FIXED__ can't move"],
 "email": {"subject": "...", "body": "90-150 words, first person, warm and specific, with the ask and one reason,
   [Your name] at the end"},
 "questions": ["2-4 questions to ask about this offer before accepting: what isn't clear in it"],
 "watch_outs": ["0-3 things in this offer to check: a large __VARIABLE__ share, an equity value that's only on paper,
   a __JOINING__ with a clawback, a short deadline"]}"""

# What the parts of the pay are called: an Indian offer letter's fixed pay, variable pay and joining bonus are a base
# salary, a target bonus and a signing bonus elsewhere. Told by the offer's currency, so a rupee offer reads as it
# always has, whoever's account it's in.
_WORDS = {True: {"__FIXED__": "fixed pay", "__VARIABLE__": "variable", "__JOINING__": "joining bonus"},
          False: {"__FIXED__": "base salary", "__VARIABLE__": "bonus", "__JOINING__": "signing bonus"}}
_LABELS = {True: ("Fixed pay a year", "Variable pay a year (target)", "Joining bonus"),
           False: ("Base salary a year", "Target bonus a year", "Signing bonus")}


def _rupees(offer: dict[str, Any]) -> bool:
    return offer.get("currency") == "INR"


def system_prompt(offer: dict[str, Any], country: str | None) -> str:
    out = localize(SYSTEM, country)
    for marker, word in _WORDS[_rupees(offer)].items():
        out = out.replace(marker, word)
    return out


def _money(currency: str, value: float) -> str:
    if currency == "INR":
        return f"₹{value / 100_000:.1f}L".replace(".0L", "L")
    return f"{currency} {value:,.0f}"


def offer_text(offer: dict[str, Any]) -> str:
    c = offer["currency"]
    fixed, variable, joining = _LABELS[_rupees(offer)]
    parts = [f"Company: {offer['company']}", f"Role: {offer['role']}"]
    if offer.get("city"):
        parts.append(f"City: {offer['city']}")
    parts.append(f"{fixed}: {_money(c, offer['fixed'])}")
    for key, label in (("variable", variable), ("joining_bonus", joining),
                       ("equity_per_year", "Equity a year (as stated)"), ("other", "Other pay a year")):
        if offer.get(key):
            parts.append(f"{label}: {_money(c, offer[key])}")
    if offer.get("deadline"):
        parts.append(f"Decision deadline: {offer['deadline']}")
    if offer.get("notes"):
        parts.append(f"Notes: {offer['notes'][:600]}")
    return "\n".join(parts)


def market_text(market: dict[str, Any] | None) -> str:
    if not market:
        return "No market range: too few job posts for this role showed pay."
    c = market["currency"]
    return (f"From {market['count']} job posts for {market['scope']}: middle of the range "
            f"{_money(c, market['p25'])} to {_money(c, market['p75'])}, median {_money(c, market['median'])}.")


def plan_request(offer: dict[str, Any], market: dict[str, Any] | None, resume: str, evidence: str,
                 llm: LLMProvider, country: str | None) -> LLMRequest:
    body = (f"<reference_data source=\"offer\">\n{fence(offer_text(offer))}\n</reference_data>\n\n"
            f"<reference_data source=\"market\">\n{fence(market_text(market))}\n</reference_data>\n\n"
            + (f"<reference_data source=\"resume\">\n{fence(resume[:6_000])}\n</reference_data>\n\n" if resume else "")
            + (f"<reference_data source=\"confirmed_evidence\">\n{fence(evidence)}\n</reference_data>\n\n"
               if evidence else ""))
    return LLMRequest(messages=[LLMMessage("system", system_prompt(offer, country)), LLMMessage("user", body.strip())],
                      json_mode=llm.supports_structured_output(), max_tokens=1_400, temperature=0.4,
                      request_type="offer_plan")


def _lines(v: Any, limit: int, item_limit: int = 400) -> list[str]:
    items = v if isinstance(v, list) else []
    return [s for s in (" ".join(str(x).split())[:item_limit] for x in items if isinstance(x, str)) if s][:limit]


def parse_plan(text: str, offer: dict[str, Any], market: dict[str, Any] | None, corpus: str) -> Plan:
    """The plan, kept to what can be backed: reasons with a figure from nowhere go, and the ask stays between the
    offer and half as much again (when the AI gives no number: the market's top quartile, at most a quarter more)."""
    data = _json(text)
    fixed = int(offer["fixed"])
    try:
        ask = int(float(data.get("ask") or 0))
    except (TypeError, ValueError):
        ask = 0
    if ask <= 0:
        ask = min(int(market["p75"]), round(fixed * 1.25)) if market and market["p75"] > fixed else round(fixed * 1.15)
    ask = min(max(ask, fixed), round(fixed * 1.5))
    known = "\n".join((offer_text(offer), market_text(market), corpus))
    reasons = [r for r in _lines(data.get("reasons"), MAX_REASONS) if not invented_figures(r, known)]
    raw = data.get("email")
    raw_email: dict[str, Any] = raw if isinstance(raw, dict) else {}
    subject = " ".join(str(raw_email.get("subject") or "").split())[:150]
    email = Email(subject=subject or f"Re: offer for {offer['role']}",
                  body=str(raw_email.get("body") or "").strip()[:2_000])
    if not email.body:
        raise ValueError("no email")
    return Plan(ask=ask, ask_why=" ".join(str(data.get("ask_why") or "").split())[:300], reasons=reasons,
                call_script=_lines(data.get("call_script"), 8), email=email,
                questions=_lines(data.get("questions"), 4), watch_outs=_lines(data.get("watch_outs"), 3))


def as_json(plan: Plan) -> dict[str, Any]:
    out: dict[str, Any] = json.loads(plan.model_dump_json())
    return out
