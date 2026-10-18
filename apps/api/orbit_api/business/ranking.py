"""Parsing and ranking an application in the background (a durable job, jobs.py), right after it arrives.

The resume is parsed (ai_port.parse_applicant_resume), then ranked against the job's requirements with only the
professional fields (ai_port.professional_only: no name, contact or location; the parsed resume has no field for
gender, age, photo, religion, caste or marital status). The ranking is stored with its model version and logged in
the company's audit log. It sorts and explains; it never moves or rejects anyone.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from orbit_api import jobs
from orbit_api.business.access import audit, timeline
from orbit_api.business.ai_port import QA, JobSpec, LocationRules, get_business_ai, professional_only
from orbit_api.business.apply import RANK_KIND
from orbit_api.db import sessionmaker
from orbit_api.models import BizApplication, BizJob

log = logging.getLogger(__name__)
jobs.timeout(RANK_KIND, 180)


def job_spec(job: BizJob) -> JobSpec:
    return JobSpec(title=job.title, must_haves=job.must_haves or [], nice_to_haves=job.nice_to_haves or [],
                   experience_band=job.experience,
                   location_rules=LocationRules(workplace=job.workplace, locations=job.locations or [],
                                                allowed_countries=job.allowed_countries or []))


async def rank_application(application_id: str) -> None:
    ai = get_business_ai()
    async with sessionmaker()() as db:
        app = await db.get(BizApplication, application_id)
        job = await db.get(BizJob, app.job_id) if app is not None else None
        if app is None or job is None:
            return  # deleted meanwhile
        text, answers = app.resume_text, [QA(question=a.get("question", ""), answer=a.get("answer", ""))
                                          for a in app.answers or []]
        spec = job_spec(job)
    try:
        parsed = await ai.parse_applicant_resume(text)
        ranking = await ai.rank_applicant(spec, professional_only(parsed), answers)
    except Exception:
        async with sessionmaker()() as db:
            app = await db.get(BizApplication, application_id)
            if app is not None:
                app.ranking_status = "failed"
                await db.commit()
        raise
    async with sessionmaker()() as db:
        app = await db.get(BizApplication, application_id)
        if app is None:
            return
        stored: dict[str, Any] = {**ranking.model_dump(), "ranked_at": datetime.now(UTC).isoformat()}
        app.parsed = parsed.model_dump()
        if parsed.location and not app.location:
            app.location = parsed.location[:160]
        app.ranking, app.ranking_status, app.ranking_model = stored, "done", ranking.model_version[:64]
        timeline(db, app, "ranked", None, score=ranking.score, model_version=ranking.model_version)
        audit(db, app.company_id, None, "ranking.completed", app.reference, job_id=app.job_id, score=ranking.score,
              model_version=ranking.model_version)
        await db.commit()


@jobs.handler(RANK_KIND)
async def _run(payload: dict[str, Any]) -> None:
    await rank_application(str(payload["application_id"]))
