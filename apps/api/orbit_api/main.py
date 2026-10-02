import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import Receive, Scope, Send

from orbit_api import db, jobs
from orbit_api.admin.routes import router as admin_router
from orbit_api.auth.routes import router as auth_router
from orbit_api.billing.packs import packs as configured_packs
from orbit_api.billing.routes import router as billing_router
from orbit_api.config import get_settings
from orbit_api.csrf import HEADER as CSRF_HEADER
from orbit_api.csrf import csrf_middleware
from orbit_api.desktop_updates import router as desktop_router
from orbit_api.documents.parsing import isolation_selftest
from orbit_api.documents.routes import router as documents_router
from orbit_api.entitlements import plans as configured_plans
from orbit_api.observability import configure_logging, init_sentry, request_id_middleware
from orbit_api.preflight import router as preflight_router
from orbit_api.prep.routes import router as prep_router
from orbit_api.providers import health as dependency_health
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.stt import create_stt_provider
from orbit_api.resumes.routes import router as resumes_router
from orbit_api.retrieval.embeddings import get_embedder
from orbit_api.runtime_config import refresh as refresh_runtime_config
from orbit_api.sessions.cleanup import running_sweeper
from orbit_api.sessions.companion import router as companion_router
from orbit_api.sessions.feedback import router as feedback_router
from orbit_api.sessions.insights import router as insights_router
from orbit_api.sessions.recorder import replay_failed_writes
from orbit_api.sessions.routes import drain_teardowns
from orbit_api.sessions.routes import router as sessions_router
from orbit_api.stories.routes import router as stories_router
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
        logging.getLogger(__name__).exception("replaying failed writes failed; will retry next start")
    async with jobs.running_worker(s.job_poll_s), running_sweeper(s.session_sweep_s):
        yield
        await drain_teardowns()
    with contextlib.suppress(Exception):
        await selftest
    if warming is not None:
        with contextlib.suppress(Exception):
            await warming
    await get_llm_provider().aclose()
    await db.dispose()


def running_commit() -> str | None:
    """The deployed git commit (short), so a deploy can be confirmed from outside. Render sets
    RENDER_GIT_COMMIT for every deploy; ORBIT_GIT_COMMIT covers other hosts."""
    sha = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("ORBIT_GIT_COMMIT")
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
    (a multi-GB multipart body would otherwise be spooled to disk before any route sees it)."""

    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = dict(scope.get("headers") or []).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
            await Response("Request body too large.", status_code=413)(scope, receive, send)
            return
        seen = 0

        async def counted() -> Any:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:  # chunked upload past the cap: body parsing stops here (400)
                    raise HTTPException(413, "Request body too large.")
            return message

        await self.app(scope, receive if length is not None else counted, send)


def create_app() -> FastAPI:
    s = get_settings()
    configured_plans()  # fail fast on a bad ORBIT_PLANS_JSON / *_MAX_SESSION_MINUTES instead of at first use
    configured_packs()  # and on a bad ORBIT_CREDIT_PACKS_JSON
    if init_sentry(s.sentry_dsn, s.env, running_commit()):
        logging.getLogger(__name__).info("sentry error reporting enabled")
    # In production neither the docs nor the schema are served: the route map (admin routes included) isn't
    # anyone's business, and the clients don't need it.
    app = FastAPI(title="Orbit API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None, redoc_url=None,
                  openapi_url="/openapi.json" if s.env != "production" else None)
    app.middleware("http")(request_id_middleware)
    # Registered before CORS so it runs *inside* it: its 403s still carry CORS headers the browser can read.
    app.middleware("http")(csrf_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        # PUT: workspace updates and admin config use it; without it the browser's preflight blocks them.
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", CSRF_HEADER],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if not request.url.path.startswith("/docs"):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if s.env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response

    app.add_middleware(ApiGZip, minimum_size=1024)
    # Outermost: an oversized body is refused before any other middleware or route reads it.
    app.add_middleware(BodyLimit, max_bytes=s.max_upload_bytes + 1024 * 1024)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        # Liveness only: is the process up. Cheap, never touches the DB.
        llm = get_llm_provider()
        stt = create_stt_provider()
        return {"status": "ok", "env": s.env, "commit": running_commit(),
                "providers": {"llm": llm.name, "stt": stt.name}}

    @app.get("/ready")
    async def ready(response: Response) -> dict[str, Any]:
        # Readiness: can the app actually serve — DB reachable. Used to gate rollouts / load balancers.
        from sqlalchemy import text

        checks: dict[str, str] = {}
        started = time.monotonic()
        try:
            async with db.sessionmaker()() as session:
                await session.execute(text("SELECT 1"))
            checks["database"] = "ok"
            dependency_health.record("postgres", "database", True, int((time.monotonic() - started) * 1000))
        except Exception as e:
            checks["database"] = f"error: {type(e).__name__}"
            dependency_health.record("postgres", "database", False, error=type(e).__name__)
        ok = all(v == "ok" for v in checks.values())
        response.status_code = 200 if ok else 503
        return {"status": "ready" if ok else "not_ready", "checks": checks}

    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(sessions_router)
    app.include_router(desktop_router)
    app.include_router(admin_router)
    app.include_router(workspaces_router)
    app.include_router(preflight_router)
    app.include_router(billing_router)
    app.include_router(prep_router)
    app.include_router(insights_router)
    app.include_router(companion_router)
    app.include_router(stories_router)
    app.include_router(feedback_router)
    app.include_router(resumes_router)
    return app


app = create_app()
