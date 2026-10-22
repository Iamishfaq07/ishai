"""Which of a candidate's tracked jobs Orbit Apply can send, and what each of the rest needs, so the Auto Apply page
and each job say it before anything is prepared (a coverage meter: most auto-apply tools only find out at the form).

- `auto`: the employer's own form Orbit sends (Greenhouse, Lever, Ashby, Orbit Direct; with hosted applying on, also
  Workday, SmartRecruiters, Workable and Recruitee). Workday is `auto` with a note: many employers there ask for an
  account first, and then it stops for the candidate.
- `kit`: the employer's own form, prepared in full (tailored resume, letter, answers) for the candidate to send,
  because this server isn't sending that form itself.
- `board`: a job board listing with no employer copy found. Boards are never automated (rules.py, rule 4); the kit
  links to the board.
- `manual`: a job added by hand without a link Orbit can read.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import hosted, rules
from orbit_api.auto_apply.resolve import resolve
from orbit_api.models import JobApplication, JobListing

Kind = Literal["auto", "kit", "board", "manual"]
ATS_NAMES = {"greenhouse": "Greenhouse", "lever": "Lever", "ashby": "Ashby", "orbit": "Orbit", "workday": "Workday",
             "smartrecruiters": "SmartRecruiters", "workable": "Workable", "recruitee": "Recruitee"}
OPEN = ("saved", "applied", "interviewing", "offer")


class JobCoverage(BaseModel):
    entry_id: str
    listing_id: str
    title: str
    company: str
    kind: Kind
    where: str
    note: str


class Coverage(BaseModel):
    hosted: bool
    counts: dict[str, int]
    jobs: list[JobCoverage]


def classify(ats: str, site: str | None, hosting: bool) -> tuple[Kind, str, str]:
    name = ATS_NAMES.get(ats, site or "its site")
    if ats == "orbit":
        return "auto", name, "Sent through Orbit."
    if ats in rules.BROWSER_ATS or (ats in rules.ATS_SUPPORTED and ats != "workday"):
        return ("auto", name, "Orbit fills and sends the employer's form.") if hosting else (
            "kit", name, "Prepared in full for you to send in one sitting.")
    if ats == "workday":
        if hosting:
            return "auto", name, "Orbit fills the form; if the employer asks for an account, it stops for you."
        return "kit", name, "Workday: prepared in full; you sign in to the employer's Workday and send it."
    if ats == "board":
        return "board", name, f"A {name} listing: apply there with the prepared answers. Boards are never automated."
    return "manual", name, "Added by hand: add the employer's application link to prepare it."


async def coverage(db: AsyncSession, user_id: str) -> Coverage:
    hosting = await hosted.online(db) or hosted.enabled()
    entries = (await db.scalars(select(JobApplication).where(
        JobApplication.user_id == user_id, JobApplication.status.in_(OPEN))
        .order_by(JobApplication.updated_at.desc()).limit(200))).all()
    jobs: list[JobCoverage] = []
    for e in entries:
        row = await db.get(JobListing, e.listing_id)
        if row is None:
            kind, where, note = classify("other", None, hosting)
        else:
            target, _ = await resolve(db, row)
            kind, where, note = classify(target.ats, target.site, hosting)
        jobs.append(JobCoverage(entry_id=e.id, listing_id=e.listing_id, title=e.title, company=e.company, kind=kind,
                                where=where, note=note))
    counts = {k: sum(1 for j in jobs if j.kind == k) for k in ("auto", "kit", "board", "manual")}
    return Coverage(hosted=hosting, counts=counts, jobs=jobs)
