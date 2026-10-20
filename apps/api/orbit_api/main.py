import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import Receive, Scope, Send

from orbit_api import db, jobs
from orbit_api.admin.accounts import router as admin_accounts_router
from orbit_api.admin.inbox import router as admin_inbox_router
from orbit_api.admin.overview import router as admin_overview_router
from orbit_api.admin.routes import public_router as announcement_router
from orbit_api.admin.routes import router as admin_router
from orbit_api.answers.routes import router as answers_router
from orbit_api.auth.alerts import router as security_alerts_router
from orbit_api.auth.devices import router as devices_router
from orbit_api.auth.passkeys import router as passkeys_router
from orbit_api.auth.routes import router as auth_router
from orbit_api.auth.security import COOKIE_DOMAIN_HEADER, cookie_domain, share_cookie
from orbit_api.auth.two_factor import router as two_factor_router
from orbit_api.auto_apply.hosted import router as apply_worker_router
from orbit_api.auto_apply.journey import router as apply_journey_router
from orbit_api.auto_apply.review import router as apply_review_router
from orbit_api.auto_apply.routes import admin_router as apply_admin_router
from orbit_api.auto_apply.routes import router as apply_router
from orbit_api.billing.monthly import monthly_plans as configured_monthly
from orbit_api.billing.packs import packs as configured_packs
from orbit_api.billing.referral_routes import router as referrals_router
from orbit_api.billing.routes import router as billing_router
from orbit_api.business import indexing as _business_indexing  # noqa: F401  (registers its background job)
from orbit_api.business import ranking as _business_ranking  # noqa: F401  (registers its background job)
from orbit_api.business.admin import router as business_admin_router
from orbit_api.business.analytics import router as business_analytics_router
from orbit_api.business.apply import public_router as business_apply_public_router
from orbit_api.business.apply import router as business_apply_router
from orbit_api.business.automation import running_sweeper as running_business_automations
from orbit_api.business.automation_routes import router as business_automation_router
from orbit_api.business.companies import public_router as business_public_router
from orbit_api.business.companies import router as business_router
from orbit_api.business.control_room import router as business_control_router
from orbit_api.business.coordination import public_router as business_coordination_public_router
from orbit_api.business.coordination import router as business_coordination_router
from orbit_api.business.handoff import public_router as business_handoff_public_router
from orbit_api.business.handoff import router as business_handoff_router
from orbit_api.business.hiring_routes import public_router as business_hiring_public_router
from orbit_api.business.hiring_routes import router as business_hiring_router
from orbit_api.business.job_assist import router as business_job_assist_router
from orbit_api.business.jobs import router as business_jobs_router
from orbit_api.business.offers import public_router as business_offers_public_router
from orbit_api.business.offers import router as business_offers_router
from orbit_api.business.pipeline import router as business_pipeline_router
from orbit_api.business.plan_assist import router as business_plan_assist_router
from orbit_api.business.retention import running_sweeper as running_business_sweeper
from orbit_api.business.screening import public_router as business_screening_public_router
from orbit_api.business.screening import router as business_screening_router
from orbit_api.business.withdrawal import public_router as business_withdrawal_public_router
from orbit_api.business.withdrawal import router as business_withdrawal_router
from orbit_api.career.routes import router as career_router
from orbit_api.code.routes import router as code_router
from orbit_api.config import get_settings
from orbit_api.contact.routes import router as contact_router
from orbit_api.csrf import HEADER as CSRF_HEADER
from orbit_api.csrf import csrf_middleware
from orbit_api.desktop_updates import router as desktop_router
from orbit_api.documents.parsing import isolation_selftest
from orbit_api.documents.routes import router as documents_router
from orbit_api.entitlements import plans as configured_plans
from orbit_api.evidence.routes import router as evidence_router
from orbit_api.extension.routes import router as extension_router
from orbit_api.geo import router as region_router
from orbit_api.job_portal.actions import router as job_actions_router
from orbit_api.job_portal.alerts import router as job_alerts_router
from orbit_api.job_portal.career_progress import router as career_progress_router
from orbit_api.job_portal.companies import boards as configured_boards
from orbit_api.job_portal.contact_research import router as job_network_router
from orbit_api.job_portal.contacts import router as job_contacts_router
from orbit_api.job_portal.interview import router as job_interview_router
from orbit_api.job_portal.launchpad import router as job_launchpad_router
from orbit_api.job_portal.message_updates import router as message_updates_router
from orbit_api.job_portal.mission import router as job_mission_router
from orbit_api.job_portal.opportunity_coach import router as opportunity_coach_router
from orbit_api.job_portal.plan import router as job_plan_router
from orbit_api.job_portal.playbooks import router as job_playbook_router
from orbit_api.job_portal.refresh import running_refresher as running_job_refresher
from orbit_api.job_portal.routes import router as jobs_router
from orbit_api.job_portal.weekly import router as job_weekly_router
from orbit_api.linkedin.routes import router as linkedin_router
from orbit_api.observability import configure_logging, init_sentry, request_id_middleware
from orbit_api.offers.routes import router as offers_router
from orbit_api.preflight import router as preflight_router
from orbit_api.prep.company_guides import router as company_guides_router
from orbit_api.prep.routes import router as prep_router
from orbit_api.providers import health as dependency_health
from orbit_api.providers.llm import get_llm_provider
from orbit_api.resumes.kit import router as resume_kit_router
from orbit_api.resumes.routes import router as resumes_router
from orbit_api.resumes.tailor_queue import router as tailor_queue_router
from orbit_api.retrieval.embeddings import get_embedder
from orbit_api.runtime_config import refresh as refresh_runtime_config
from orbit_api.sessions.camera import router as camera_router
from orbit_api.sessions.cleanup import running_sweeper
from orbit_api.sessions.companion import router as companion_router
from orbit_api.sessions.feedback import router as feedback_router
from orbit_api.sessions.insights import router as insights_router
from orbit_api.sessions.recorder import replay_failed_writes, running_replayer
from orbit_api.sessions.routes import drain_teardowns
from orbit_api.sessions.routes import router as sessions_router
from orbit_api.stories.routes import router as stories_router
from orbit_api.support.routes import admin_router as support_admin_router
from orbit_api.support.routes import router as support_router
from orbit_api.telemetry import router as telemetry_router
from orbit_api.voice.routes import router as voice_router
from orbit_api.workspaces.routes import router as workspaces_router

_boot = get_settings()
configure_logging(_boot.log_format or ("json" if _boot.env == "production" else "text"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    s = get_settings()
    if s.env != "production":
        await db.create_all()  # production uses `alembic upgrade head`
    elif s.proxy_secret is None:
        logging.getLogger(__name__).warning(
            "SECURITY: ORBIT_PROXY_SECRET is not set. Callers reaching the API directly can choose their own IP "
            "(X-Forwarded-For) and so dodge per-IP limits (sign-up, welcome credits). Set it to the web Worker's "
            "PROXY_SECRET (wrangler secret put PROXY_SECRET).")
    if s.env == "production" and bool(s.paypal_client_id) != bool(s.paypal_client_secret):
        logging.getLogger(__name__).warning("PayPal is off: set both ORBIT_PAYPAL_CLIENT_ID and "
                                            "ORBIT_PAYPAL_CLIENT_SECRET (one REST app, same mode as ORBIT_PAYPAL_ENV)")
    elif s.env == "production" and s.paypal_client_id:
        if not s.paypal_webhook_id:
            logging.getLogger(__name__).warning(
                "PayPal: ORBIT_PAYPAL_WEBHOOK_ID is not set, so PayPal's webhooks are refused. Payments still land "
                "when the buyer comes back, or within minutes through the reconciler.")
        if s.paypal_env == "sandbox":
            logging.getLogger(__name__).warning("PayPal is in SANDBOX mode: no real money is taken. Set "
                                                "ORBIT_PAYPAL_ENV=live with the live app's keys to sell.")
    try:
        async with db.sessionmaker()() as session:
            await refresh_runtime_config(session)  # load admin API-key overrides into providers
    except Exception:
        logging.getLogger(__name__).exception("failed to load runtime config; using environment defaults")
    # Checked off the boot path: a host where child-process parsing fails degrades to in-process parsing.
    selftest = asyncio.create_task(asyncio.to_thread(isolation_selftest))
    # A neural embedder loads in the background (seconds on a small CPU); retrieval is BM25-only until it's ready.
    embedder = get_embedder()
    warm = getattr(embedder, "warm", None)
    warming = asyncio.create_task(asyncio.to_thread(warm)) if warm and not embedder.ready else None
    try:
        await replay_failed_writes()  # dead-lettered live-session writes from a previous outage
    except Exception:
        logging.getLogger(__name__).exception("replaying failed writes failed; the replayer retries")
    async with (jobs.running_worker(s.job_poll_s), running_sweeper(s.session_sweep_s), running_replayer(),
                running_job_refresher(), running_business_sweeper(), running_business_automations()):
        yield
        await drain_teardowns()
        # A last try for writes that failed during an outage: the spool file and memory go with this process.
        with contextlib.suppress(Exception):
            await asyncio.wait_for(replay_failed_writes(), timeout=10)
    with contextlib.suppress(Exception):
        await selftest
    if warming is not None:
        with contextlib.suppress(Exception):
            await warming
    await get_llm_provider().aclose()
    await db.dispose()


def running_commit() -> str | None:
    """The deployed git commit (short), so a deploy can be confirmed from outside. Railway sets
    RAILWAY_GIT_COMMIT_SHA for every deploy from GitHub; ORBIT_GIT_COMMIT covers other hosts."""
    sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA") or os.environ.get("ORBIT_GIT_COMMIT")
    return sha[:7] if sha else None


class ApiGZip(GZipMiddleware):
    """gzip for JSON bodies over 1 kB (session transcripts, reports, lists): the desktop app talks to the API
    directly, so nothing else compresses them. Never auth responses: they carry tokens next to user input (BREACH)."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and str(scope.get("path", "")).startswith("/v1/auth"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


class BodyLimit:
    """Refuses request bodies over `max_bytes` (413) before anything buffers them: by Content-Length up front, and by
    counting for chunked uploads. The upload route has its own, smaller per-file check; this bounds everything else
    (a multi-GB multipart body would otherwise be spooled to disk before any route sees it).

    It runs outside CORS, so its 413 carries the CORS headers itself for an allowed origin: without them the
    browser hides the answer and the app can only say "Can't reach Orbit" instead of "too large"."""

    def __init__(self, app: Any, max_bytes: int, allow_origins: Sequence[str] = (), file_limit_mb: int = 5) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.allow_origins = frozenset(allow_origins)
        self.file_limit_mb = file_limit_mb

    def _too_large(self, scope: Scope) -> Response:
        response = JSONResponse({"detail": f"That's too large to send. Files can be up to {self.file_limit_mb} MB."},
                                status_code=413)
        origin = dict(scope.get("headers") or []).get(b"origin", b"").decode("latin-1")
        if origin and (origin in self.allow_origins or "*" in self.allow_origins):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
        return response

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = dict(scope.get("headers") or []).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
            await self._too_large(scope)(scope, receive, send)
            return
        seen = 0
        started = False  # the app began its response: too late for a 413
        refused = False  # we answered 413 ourselves: whatever the app sends after is dropped

        async def tracked_send(message: Any) -> None:
            nonlocal started
            if refused:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        async def counted() -> Any:
            nonlocal seen, refused
            message = await receive()
            if message["type"] == "http.request" and not refused:
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # A chunked upload past the cap: answer 413 here and stop reading, as the Content-Length branch
                    # does. (Raising inside receive() came back as a 400 or 500.)
                    if not started:
                        await self._too_large(scope)(scope, receive, send)
                    refused = True
                    return {"type": "http.disconnect"}
            return message

        if length is not None:
            await self.app(scope, receive, send)
        else:
            await self.app(scope, counted, tracked_send)


# Postgres refuses U+0000 in text (22021) and in jsonb (22P05). Anything typed can carry one, so it's bad input.
BAD_TEXT_SQLSTATES = frozenset({"22021", "22P05"})


def bad_text(e: DBAPIError) -> bool:
    orig = e.orig
    codes = {getattr(orig, "sqlstate", None), getattr(orig, "pgcode", None),
             getattr(getattr(orig, "__cause__", None), "sqlstate", None)}
    return bool(codes & BAD_TEXT_SQLSTATES)


async def bad_text_handler(request: Request, e: Exception) -> Response:
    """A NUL character in a name, a resume line or a search: 400 with a reason, instead of a 500 (and an alert)."""
    if isinstance(e, DBAPIError) and bad_text(e):
        return JSONResponse({"detail": "That text has a character that can't be saved (a NUL byte). Remove it and "
                                       "try again."}, status_code=400)
    raise e


def create_app() -> FastAPI:
    s = get_settings()
    configured_plans()  # fail fast on a bad ORBIT_PLANS_JSON / *_MAX_SESSION_MINUTES instead of at first use
    configured_packs()  # and on a bad ORBIT_CREDIT_PACKS_JSON
    configured_monthly()  # and on a bad ORBIT_MONTHLY_PLANS_JSON
    configured_boards()  # and on a bad ORBIT_JOBS_BOARDS_JSON
    if init_sentry(s.sentry_dsn, s.env, running_commit()):
        logging.getLogger(__name__).info("sentry error reporting enabled")
    # In production neither the docs nor the schema are served: the route map (admin routes included) isn't
    # anyone's business, and the clients don't need it.
    app = FastAPI(title="Orbit API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None, redoc_url=None,
                  openapi_url="/openapi.json" if s.env != "production" else None)
    app.middleware("http")(request_id_middleware)
    app.add_exception_handler(DBAPIError, bad_text_handler)
    # Registered before CORS so it runs *inside* it: its 403s still carry CORS headers the browser can read.
    app.middleware("http")(csrf_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        # PUT: workspace updates and admin config use it; without it the browser's preflight blocks them.
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        # X-Orbit-Support-Token: the support chat reads (and deletes) its thread with it. Without it here the
        # preflight is refused and the open chat never sees a reply when the API is on another origin.
        allow_headers=["Authorization", "Content-Type", CSRF_HEADER, "X-Orbit-Support-Token"],
        # The web app calls this address directly (D80): each JSON write is preflighted, so a preflight is kept for
        # the two hours Chrome allows rather than Starlette's 10 minutes.
        max_age=7200,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        # Nothing is cached, except the public aggregates under /v1/public, which say how long they keep.
        if not (request.url.path.startswith("/v1/public/") and "cache-control" in response.headers):
            response.headers["Cache-Control"] = "no-store"
        if not request.url.path.startswith("/docs"):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if s.env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        # The web app calls the API's own address directly once the API says its cookies are shared with it (D80).
        # Without the proxy secret a host-only cookie from before can't be moved over (share_cookie), so it isn't said.
        domain = cookie_domain(request)
        if domain and s.proxy_secret is not None:
            share_cookie(request, response)
            response.headers[COOKIE_DOMAIN_HEADER] = domain
        return response

    # Level 6 (zlib's default): a third less CPU than Starlette's 9 on the big lists, for 1-2% more bytes.
    app.add_middleware(ApiGZip, minimum_size=1024, compresslevel=6)
    # Outermost: an oversized body is refused before any other middleware or route reads it.
    app.add_middleware(BodyLimit, max_bytes=s.max_upload_bytes + 1024 * 1024, allow_origins=s.cors_origins,
                       file_limit_mb=max(1, s.max_upload_bytes // (1024 * 1024)))

    @app.get("/health")
    async def health() -> dict[str, Any]:
        # Liveness only: is the process up. Cheap, never touches the DB. Public, so it names nothing but the
        # commit (to check what a deploy is running); providers and env are in the admin's /v1/admin/providers.
        return {"status": "ok", "commit": running_commit()}

    @app.get("/ready")
    async def ready(response: Response) -> dict[str, Any]:
        # Readiness: can the app actually serve — DB reachable and taking writes. Used to gate rollouts / load
        # balancers (Railway's deploy healthcheck).
        from sqlalchemy import text

        checks: dict[str, str] = {}
        started = time.monotonic()
        try:
            async with db.sessionmaker()() as session:
                await session.execute(text("SELECT 1"))
                read_only = await db.refuses_writes(session)
            if read_only:  # reads work and every write fails (D56): not ready, and said plainly
                checks["database"] = "read_only"
                dependency_health.record("postgres", "database", False, error="read_only")
            else:
                checks["database"] = "ok"
                dependency_health.record("postgres", "database", True, int((time.monotonic() - started) * 1000))
        except Exception as e:
            checks["database"] = f"error: {type(e).__name__}"
            dependency_health.record("postgres", "database", False, error=type(e).__name__)
        if s.env == "production":
            # Without a usable proxy secret, per-IP limits key on an address the caller can choose: a deploy
            # missing it fails its health gate instead of serving (the previous deploy keeps running).
            checks["proxy_secret"] = "ok" if get_settings().proxy_secret is not None else "missing"
        ok = all(v == "ok" for v in checks.values())
        response.status_code = 200 if ok else 503
        return {"status": "ready" if ok else "not_ready", "checks": checks}

    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(sessions_router)
    app.include_router(career_router)
    app.include_router(desktop_router)
    app.include_router(admin_router)
    app.include_router(admin_accounts_router)
    app.include_router(admin_overview_router)
    app.include_router(admin_inbox_router)
    app.include_router(announcement_router)
    app.include_router(region_router)
    app.include_router(workspaces_router)
    app.include_router(preflight_router)
    app.include_router(billing_router)
    app.include_router(referrals_router)
    app.include_router(prep_router)
    app.include_router(company_guides_router)
    app.include_router(insights_router)
    app.include_router(companion_router)
    app.include_router(stories_router)
    app.include_router(evidence_router)
    app.include_router(answers_router)
    app.include_router(feedback_router)
    app.include_router(tailor_queue_router)  # before resumes_router: /tailor-queue isn't a resume id
    app.include_router(resumes_router)
    app.include_router(resume_kit_router)
    app.include_router(job_alerts_router)
    app.include_router(devices_router)
    app.include_router(two_factor_router)
    app.include_router(security_alerts_router)
    app.include_router(passkeys_router)
    app.include_router(voice_router)
    app.include_router(camera_router)
    app.include_router(extension_router)
    app.include_router(apply_router)
    app.include_router(apply_worker_router)
    app.include_router(apply_journey_router)
    app.include_router(apply_review_router)
    app.include_router(apply_admin_router)
    app.include_router(job_mission_router)
    app.include_router(message_updates_router)
    app.include_router(opportunity_coach_router)
    app.include_router(job_plan_router)
    app.include_router(job_interview_router)
    app.include_router(jobs_router)
    app.include_router(job_contacts_router)
    app.include_router(job_network_router)
    app.include_router(job_actions_router)
    app.include_router(job_weekly_router)
    app.include_router(job_launchpad_router)
    app.include_router(career_progress_router)
    app.include_router(job_playbook_router)
    app.include_router(business_control_router)
    app.include_router(business_plan_assist_router)
    app.include_router(offers_router)
    app.include_router(linkedin_router)
    app.include_router(code_router)
    app.include_router(contact_router)
    app.include_router(support_router)
    app.include_router(support_admin_router)
    app.include_router(telemetry_router)
    # Orbit for Business (D82).
    app.include_router(business_router)
    app.include_router(business_public_router)
    app.include_router(business_jobs_router)
    app.include_router(business_job_assist_router)  # the job assistant (D85)
    app.include_router(business_pipeline_router)
    app.include_router(business_analytics_router)
    app.include_router(business_hiring_router)
    app.include_router(business_automation_router)
    app.include_router(business_coordination_router)
    app.include_router(business_coordination_public_router)
    app.include_router(business_hiring_public_router)
    app.include_router(business_screening_router)
    app.include_router(business_screening_public_router)
    app.include_router(business_offers_router)
    app.include_router(business_offers_public_router)
    app.include_router(business_handoff_router)
    app.include_router(business_handoff_public_router)
    app.include_router(business_withdrawal_public_router)
    app.include_router(business_withdrawal_router)
    app.include_router(business_apply_router)
    app.include_router(business_apply_public_router)
    app.include_router(business_admin_router)
    return app


app = create_app()
