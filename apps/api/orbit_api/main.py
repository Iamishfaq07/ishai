import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from orbit_api import db, jobs
from orbit_api.admin.routes import router as admin_router
from orbit_api.auth.routes import router as auth_router
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
from orbit_api.providers import health as dependency_health
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.stt import create_stt_provider
from orbit_api.runtime_config import refresh as refresh_runtime_config
from orbit_api.sessions.recorder import replay_failed_writes
from orbit_api.sessions.routes import drain_teardowns
from orbit_api.sessions.routes import router as sessions_router
from orbit_api.workspaces.routes import router as workspaces_router

_boot = get_settings()
configure_logging(_boot.log_format or ("json" if _boot.env == "production" else "text"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    s = get_settings()
    if s.env != "production":
        await db.create_all()  # production uses `alembic upgrade head`
    try:
        async with db.sessionmaker()() as session:
            await refresh_runtime_config(session)  # load admin API-key overrides into providers
    except Exception:
        logging.getLogger(__name__).exception("failed to load runtime config; using environment defaults")
    # Checked off the boot path: a host where child-process parsing fails degrades to in-process parsing.
    selftest = asyncio.create_task(asyncio.to_thread(isolation_selftest))
    try:
        await replay_failed_writes()  # dead-lettered live-session writes from a previous outage
    except Exception:
        logging.getLogger(__name__).exception("replaying failed writes failed; will retry next start")
    async with jobs.running_worker(s.job_poll_s):
        yield
        await drain_teardowns()
    with contextlib.suppress(Exception):
        await selftest
    await get_llm_provider().aclose()
    await db.dispose()


def running_commit() -> str | None:
    """The deployed git commit (short), so a deploy can be confirmed from outside. Render sets
    RENDER_GIT_COMMIT for every deploy; ORBIT_GIT_COMMIT covers other hosts."""
    sha = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("ORBIT_GIT_COMMIT")
    return sha[:7] if sha else None


def create_app() -> FastAPI:
    s = get_settings()
    configured_plans()  # fail fast on a bad ORBIT_PLANS_JSON / *_MAX_SESSION_MINUTES instead of at first use
    if init_sentry(s.sentry_dsn, s.env, running_commit()):
        logging.getLogger(__name__).info("sentry error reporting enabled")
    app = FastAPI(title="Orbit API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None, redoc_url=None)
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
        return response

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
    return app


app = create_app()
