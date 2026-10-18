"""Who may see and do what in a company workspace, enforced on every route.

- `company_ctx` loads the caller's membership of the company in the path. Not a member: 404, so a company's
  existence isn't confirmed to outsiders (and company A's member asking for company B's ids gets the same 404).
- `Ctx.require(permission)`: 403 `biz_forbidden` when the role can't (rules.py has the table).
- `Ctx.writable()`: 403 `biz_suspended` on a company the Orbit team suspended.
- `job_for` / `application_for`: the row, only if it is this company's and the role may see it: hiring managers see
  only the jobs whose hiring team includes them; interviewers see only the applications they're assigned to.
"""

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from orbit_api.auth.security import current_user
from orbit_api.business.rules import Permission, can
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizAudit, BizCompany, BizEvent, BizJob, BizMember, User

NOT_FOUND = "Not found."


def display_name(user: User) -> str:
    """A member as the timeline and the log name them, cut to their columns (String(200))."""
    return (user.name or user.email)[:200]


def forbidden(message: str = "Your role in this company can't do that.") -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "biz_forbidden", "message": message})


@dataclass
class Ctx:
    user: User
    company: BizCompany
    member: BizMember

    @property
    def role(self) -> str:
        return self.member.role

    def can(self, permission: Permission) -> bool:
        return can(self.role, permission)

    def require(self, permission: Permission) -> None:
        if not self.can(permission):
            raise forbidden()

    def writable(self) -> None:
        if self.company.status == "suspended":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
                "code": "biz_suspended",
                "message": "This company is suspended by the Orbit team"
                + (f": {self.company.suspended_reason}" if self.company.suspended_reason else "")
                + ". Get in touch through the contact page if you think this is a mistake."})

    @property
    def actor_name(self) -> str:
        return display_name(self.user)


async def company_ctx(company_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Ctx:
    member = await db.scalar(select(BizMember).where(BizMember.company_id == company_id,
                                                     BizMember.user_id == user.id))
    company = await db.get(BizCompany, company_id) if member is not None else None
    if member is None or company is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return Ctx(user=user, company=company, member=member)


CompanyCtx = Annotated[Ctx, Depends(company_ctx)]


def sees_job(ctx: Ctx, job: BizJob) -> bool:
    if ctx.can("all_jobs"):
        return True
    return ctx.role == "hiring_manager" and ctx.user.id in (job.hiring_team or [])


async def job_for(db: AsyncSession, ctx: Ctx, job_id: str, *, for_interviewer: bool = False) -> BizJob:
    job = await db.get(BizJob, job_id)
    if job is None or job.company_id != ctx.company.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    if sees_job(ctx, job):
        return job
    if for_interviewer and ctx.role == "interviewer":
        # Only a job they interview someone for; the caller filters the applications to their own.
        people = (await db.scalars(select(BizApplication.interviewers).where(BizApplication.job_id == job.id))).all()
        if any(ctx.user.id in (p or []) for p in people):
            return job
    raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)


def sees_application(ctx: Ctx, app: BizApplication, job: BizJob) -> bool:
    if sees_job(ctx, job):
        return True
    return ctx.role == "interviewer" and ctx.user.id in (app.interviewers or [])


async def application_for(db: AsyncSession, ctx: Ctx, application_id: str) -> tuple[BizApplication, BizJob]:
    app = await db.get(BizApplication, application_id)
    job = await db.get(BizJob, app.job_id) if app is not None and app.company_id == ctx.company.id else None
    if app is None or job is None or not sees_application(ctx, app, job):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return app, job


# ---- the audit log and the timeline --------------------------------------------------------------------------------


def audit(db: AsyncSession, company_id: str, actor: User | None, action: str, target: str | None = None,
          **detail: Any) -> None:
    db.add(BizAudit(company_id=company_id, actor_id=actor.id if actor else None,
                    actor_name=display_name(actor) if actor else None, action=action,
                    target=target[:200] if target else None, detail=detail))


def timeline(db: AsyncSession, app: BizApplication, kind: str, actor: User | None = None, **data: Any) -> None:
    db.add(BizEvent(company_id=app.company_id, job_id=app.job_id, application_id=app.id, kind=kind, data=data,
                    actor_id=actor.id if actor else None,
                    actor_name=display_name(actor) if actor else None))


class AuditImmutable(RuntimeError):
    pass


@event.listens_for(Session, "before_flush")
def _audit_is_append_only(session: Session, _ctx: Any, _instances: Any) -> None:
    """The audit log is written once: an ORM update or delete of one of its rows is refused."""
    for obj in list(session.dirty) + list(session.deleted):
        if isinstance(obj, BizAudit) and (obj in session.deleted or session.is_modified(obj)):
            raise AuditImmutable("the company audit log is append-only")
