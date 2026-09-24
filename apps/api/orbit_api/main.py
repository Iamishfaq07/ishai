import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from orbit_api import db, jobs
from orbit_api.admin.routes import router as admin_router
from orbit_api.auth.routes import router as auth_router
from orbit_api.config import get_settings
from orbit_api.desktop_updates import router as desktop_router
from orbit_api.documents.routes import router as documents_router
from orbit_api.observability import configure_logging, init_sentry, request_id_middleware
from orbit_api.preflight import router as preflight_router
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
    try:
        await replay_failed_writes()  # dead-lettered live-session writes from a previous outage
    except Exception:
        logging.getLogger(__name__).exception("replaying failed writes failed; will retry next start")
    async with jobs.running_worker(s.job_poll_s):
        yield
        await drain_teardowns()
    await get_llm_provider().aclose()
    await db.dispose()


def running_commit() -> str | None:
    """The deployed git commit (short), so a deploy can be confirmed from outside. Render sets
    RENDER_GIT_COMMIT for every deploy; ORBIT_GIT_COMMIT covers other hosts."""
    sha = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("ORBIT_GIT_COMMIT")
    return sha[:7] if sha else None


def create_app() -> FastAPI:
    s = get_settings()
    if init_sentry(s.sentry_dsn, s.env, running_commit()):
        logging.getLogger(__name__).info("sentry error reporting enabled")
    app = FastAPI(title="Orbit API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None, redoc_url=None)
    app.middleware("http")(request_id_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
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
        try:
            async with db.sessionmaker()() as session:
                await session.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as e:
            checks["database"] = f"error: {type(e).__name__}"
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
    return app


app = create_app()
