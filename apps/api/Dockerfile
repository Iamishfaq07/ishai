FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY orbit_api ./orbit_api
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 orbit
USER orbit
EXPOSE 8000
# Honor $PORT when the platform injects one (e.g. Render); default to 8000 (Fly/local).
CMD ["sh", "-c", "uv run --no-sync alembic upgrade head && uv run --no-sync uvicorn orbit_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
