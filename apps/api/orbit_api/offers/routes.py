"""Offer AI: the user's job offers, what each pays each month (India: after PF and tax), how it sits against the
market range Orbit reads from job posts, the offers side by side, and an AI plan for negotiating one (free, a few a
day). Practising the call is Practice's salary negotiation, started from here with the offer filled in.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.job_portal import refresh
from orbit_api.job_portal.ranking import title_tokens
from orbit_api.models import JobListing, JobOffer, User
from orbit_api.offers import pay as paymod
from orbit_api.offers import plan as planmod
from orbit_api.offers.tax import take_home
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/offers", tags=["offers"])
read_limit = Depends(limit_user("offers-read", rate_per_s=3, burst=60))
ai_limits = [Depends(limit("offers-ai", rate_per_s=0.2, burst=10)),
             Depends(limit_user("offers-ai-user", rate_per_s=20 / 3600, burst=6))]

MAX_OFFERS = 20
MAX_MONEY = 10**10
COUNTRY_CURRENCY = {"IN": "INR", "US": "USD", "GB": "GBP", "CA": "CAD", "AU": "AUD", "SG": "SGD", "AE": "AED",
                    "DE": "EUR", "FR": "EUR", "NL": "EUR", "IE": "EUR", "ES": "EUR", "IT": "EUR"}
Status = Literal["considering", "accepted", "declined"]
PfMode = Literal["capped", "full", "none"]


def _currency_for(user: User) -> str:
    return COUNTRY_CURRENCY.get((user.country or "IN").upper(), "USD")


# ---- the market ----------------------------------------------------------------------------------------------------


class SampleOut(BaseModel):
    listing_id: str
    title: str
    company: str
    salary: str
    city: str


class MarketOut(BaseModel):
    currency: str
    count: int
    p25: float
    median: float
    p75: float
    low: float
    high: float
    scope: str
    samples: list[SampleOut]


_market_cache: dict[tuple[str, str, str, str, int], MarketOut | None] = {}


async def market_for(db: AsyncSession, role: str, city: str, country: str, currency: str) -> MarketOut | None:
    """The pay range in posts whose title has every word of the role (seniority aside), in the city when there are
    enough there, else anywhere in the country."""
    want = title_tokens(role)
    if not want:
        return None
    key = (" ".join(sorted(want)), city.lower(), country, currency, refresh.version())
    if key in _market_cache:
        return _market_cache[key]
    rows = (await db.execute(select(JobListing.id, JobListing.title, JobListing.company, JobListing.salary,
                                    JobListing.cities, JobListing.country)
                             .where(JobListing.salary.is_not(None), JobListing.country == country))).all()
    found: list[tuple[paymod.Sample, paymod.Pay, list[str]]] = []
    for lid, title, company, salary, cities, _ in rows:
        if not want <= title_tokens(title):
            continue
        parsed = paymod.parse_pay(salary)
        if parsed is None:
            continue
        found.append((paymod.Sample(lid, title, company, salary, ", ".join((cities or [])[:2])), parsed, cities or []))
    result = None
    if city:
        here = [(s, p) for s, p, cs in found if city.lower() in (c.lower() for c in cs)]
        result = paymod.market(here, currency, f"{role} in {city}")
    if result is None:
        result = paymod.market([(s, p) for s, p, _ in found], currency, f"{role}, all cities")
    out = None if result is None else MarketOut(
        currency=result.currency, count=result.count, p25=result.p25, median=result.median, p75=result.p75,
        low=result.low, high=result.high, scope=result.scope,
        samples=[SampleOut(**s.__dict__) for s in result.samples])
    if len(_market_cache) > 500:
        _market_cache.clear()
    _market_cache[key] = out
    return out


@router.get("/pay", response_model=MarketOut | None, dependencies=[read_limit])
async def pay_check(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                    role: Annotated[str, Query(min_length=2, max_length=120)],
                    city: Annotated[str, Query(max_length=80)] = "") -> MarketOut | None:
    return await market_for(db, role, city.strip(), (user.country or "IN").upper(), _currency_for(user))


# ---- offers --------------------------------------------------------------------------------------------------------


class OfferIn(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=200)
    city: str = Field("", max_length=120)
    currency: str = Field("INR", pattern=r"^[A-Z]{3}$")
    fixed: int = Field(gt=0, le=MAX_MONEY)
    variable: int = Field(0, ge=0, le=MAX_MONEY)
    joining_bonus: int = Field(0, ge=0, le=MAX_MONEY)
    equity_per_year: int = Field(0, ge=0, le=MAX_MONEY)
    other: int = Field(0, ge=0, le=MAX_MONEY)
    pf: PfMode = "capped"
    employer_costs_in_ctc: bool = True
    deadline: datetime | None = None
    status: Status = "considering"
    notes: str = Field("", max_length=2_000)

    @field_validator("company", "role", "city")
    @classmethod
    def _one_line(cls, v: str) -> str:
        return " ".join(v.split())


class TakeHomeOut(BaseModel):
    monthly: int
    yearly_tax: int
    employee_pf: int
    employer_costs: int
    professional_tax: int
    variable_after_tax: int
    assumptions: list[str]


class OfferOut(OfferIn):
    id: str
    first_year: int  # fixed + variable + joining bonus + equity + other
    yearly: int  # what repeats each year: all but the joining bonus
    take_home: TakeHomeOut | None  # India only
    market: MarketOut | None
    position: Literal["below", "within", "above"] | None  # the fixed pay against the market's middle half
    plan: planmod.Plan | None
    plan_stale: bool  # the plan was made for different figures
    created_at: datetime
    updated_at: datetime


def _plan_hash(o: JobOffer) -> str:
    keys = ("company", "role", "city", "currency", "fixed", "variable", "joining_bonus", "equity_per_year", "other",
            "notes")
    return hashlib.sha256(json.dumps({k: getattr(o, k) for k in keys}, sort_keys=True).encode()).hexdigest()


async def _out(db: AsyncSession, o: JobOffer, user: User) -> OfferOut:
    market = await market_for(db, o.role, o.city, (user.country or "IN").upper(), o.currency)
    position = None
    if market is not None:
        position = "below" if o.fixed < market.p25 else "above" if o.fixed > market.p75 else "within"
    th = None
    if o.currency == "INR":
        t = take_home(o.fixed, o.variable, o.pf, o.employer_costs_in_ctc)  # type: ignore[arg-type]
        th = TakeHomeOut(**t.__dict__)
    plan = planmod.Plan.model_validate(o.plan) if o.plan else None
    return OfferOut(
        id=o.id, company=o.company, role=o.role, city=o.city, currency=o.currency, fixed=o.fixed, variable=o.variable,
        joining_bonus=o.joining_bonus, equity_per_year=o.equity_per_year, other=o.other, pf=o.pf,
        employer_costs_in_ctc=o.employer_costs_in_ctc, deadline=o.deadline, status=o.status,
        notes=o.notes, first_year=o.fixed + o.variable + o.joining_bonus + o.equity_per_year + o.other,
        yearly=o.fixed + o.variable + o.equity_per_year + o.other, take_home=th, market=market, position=position,
        plan=plan, plan_stale=bool(plan) and o.plan_hash != _plan_hash(o), created_at=o.created_at,
        updated_at=o.updated_at)


async def _owned(db: AsyncSession, offer_id: str, user: User) -> JobOffer:
    o = await db.get(JobOffer, offer_id)
    if o is None or o.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    return o


@router.get("", response_model=list[OfferOut], dependencies=[read_limit])
async def list_offers(user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> list[OfferOut]:
    rows = (await db.scalars(select(JobOffer).where(JobOffer.user_id == user.id)
                             .order_by(JobOffer.created_at.desc()))).all()
    return [await _out(db, o, user) for o in rows]


@router.post("", response_model=OfferOut, status_code=status.HTTP_201_CREATED, dependencies=[read_limit])
async def add_offer(body: OfferIn, user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> OfferOut:
    count = len((await db.scalars(select(JobOffer.id).where(JobOffer.user_id == user.id))).all())
    if count >= MAX_OFFERS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep {MAX_OFFERS} offers. Delete one you've settled.")
    o = JobOffer(user_id=user.id, **body.model_dump())
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return await _out(db, o, user)


@router.put("/{offer_id}", response_model=OfferOut, dependencies=[read_limit])
async def update_offer(offer_id: str, body: OfferIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> OfferOut:
    o = await _owned(db, offer_id, user)
    for k, v in body.model_dump().items():
        setattr(o, k, v)
    await db.commit()
    await db.refresh(o)
    return await _out(db, o, user)


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[read_limit])
async def delete_offer(offer_id: str, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    o = await _owned(db, offer_id, user)
    await db.delete(o)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- the negotiation plan ------------------------------------------------------------------------------------------

_locks: dict[str, asyncio.Lock] = {}


@router.post("/{offer_id}/plan", response_model=OfferOut, dependencies=ai_limits)
async def make_plan(offer_id: str, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> OfferOut:
    """The AI's negotiation plan for this offer: free, ORBIT_OFFERS_PLAN_DAILY a day. The same figures are answered
    from the plan already made."""
    from orbit_api.job_portal.routes import _ai_left, _confirmed_evidence, _data, _generate, _profile
    from orbit_api.resumes.ats import resume_text

    o = await _owned(db, offer_id, user)
    h = _plan_hash(o)
    if o.plan and o.plan_hash == h:
        return await _out(db, o, user)
    cap = get_settings().offers_plan_daily
    async with _locks.setdefault(user.id, asyncio.Lock()):
        if await _ai_left(db, user, "offer_plan", cap) == 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "offer_plan_limit",
                "message": f"You've made today's {cap} free negotiation plans. They're back tomorrow."})
        _, _, resume = await _profile(db, user)
        data = _data(resume)
        corpus = resume_text(data.visible()) if data is not None else ""
        evidence = await _confirmed_evidence(db, user.id)
        market = await market_for(db, o.role, o.city, (user.country or "IN").upper(), o.currency)
        offer = {k: getattr(o, k) for k in ("company", "role", "city", "currency", "fixed", "variable",
                                            "joining_bonus", "equity_per_year", "other", "notes")}
        offer["deadline"] = o.deadline.date().isoformat() if o.deadline else None
        market_d = market.model_dump() if market else None
        try:
            resp = await _generate(db, user, planmod.plan_request(offer, market_d, corpus, evidence,
                                                                  get_llm_provider(), user.country))
            plan = planmod.parse_plan(resp.text, offer, market_d, f"{corpus}\n{evidence}")
        except LLMError as e:
            log.warning("offer plan failed: %s", e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The AI isn't available right now. Try again in a moment.") from e
        except (ValueError, KeyError) as e:
            log.warning("offer plan unusable: %s", e)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI's answer came back garbled. Try again.") from e
        o.plan = planmod.as_json(plan)
        o.plan_hash = h
        await db.commit()
        await db.refresh(o)
        return await _out(db, o, user)
