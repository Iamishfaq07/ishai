# Base images are pinned by digest (Dependabot's docker updates bump them), so a re-pushed tag can't change the build.
FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.5@sha256:7bff3c3776ec467fc1437960f2c469d8beb30f536a6465a3350c647ccd260ec2 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY orbit_api ./orbit_api
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 orbit
USER orbit
# Run the venv's binaries directly at runtime. Going through `uv run` would try to write a cache
# under $HOME, which the non-root `orbit` user can't create on some platforms (e.g. Render).
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# Honor $PORT when the platform injects one (e.g. Render); default to 8000 (Fly/local).
# --forwarded-allow-ips='*': the container is only reachable through the host's proxy, so trust its
# X-Forwarded-For. Without it uvicorn trusts only 127.0.0.1, every request appears to come from the proxy, and
# per-IP rate limits and audit IPs collapse into a single shared value. Set ORBIT_PROXY_SECRET (and the web
# Worker's PROXY_SECRET) so a caller hitting the API directly can't choose its own address (ratelimit.client_ip).
CMD ["sh", "-c", "alembic upgrade head && uvicorn orbit_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
