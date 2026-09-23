import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from orbit_api import db
from orbit_api.auth.routes import router as auth_router
from orbit_api.config import get_settings
from orbit_api.desktop_updates import router as desktop_router
from orbit_api.documents.routes import router as documents_router
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.stt import create_stt_provider
from orbit_api.sessions.routes import router as sessions_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    s = get_settings()
    if s.env != "production":
        await db.create_all()  # production uses `alembic upgrade head`
    yield
    await get_llm_provider().aclose()
    await db.dispose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Orbit API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None, redoc_url=None)
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
        llm = get_llm_provider()
        stt = create_stt_provider()
        return {"status": "ok", "env": s.env, "providers": {"llm": llm.name, "stt": stt.name}}

    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(sessions_router)
    app.include_router(desktop_router)
    return app


app = create_app()
