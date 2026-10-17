# Base images are pinned by digest (Dependabot's docker updates bump them), so a re-pushed tag can't change the build.
# Keep the Python minor in step with CI's (ci.yml) and pyproject's mypy target: the lockfile is only tested there, and
# a newer interpreter can fail at import (3.14 with the locked pydantic did). tests/test_deploy_image.py checks this.
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.5@sha256:7bff3c3776ec467fc1437960f2c469d8beb30f536a6465a3350c647ccd260ec2 /uv /usr/local/bin/uv
WORKDIR /app
# Tesseract reads scanned PDFs (documents/parsing.py); without it those uploads get a "paste the text" error.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

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
# Honor $PORT when the platform injects one (Railway, Render); default to 8000 (local).
# --forwarded-allow-ips='*': the container is only reachable through the host's proxy, so trust its
# X-Forwarded-For. Without it uvicorn trusts only 127.0.0.1, every request appears to come from the proxy, and
# per-IP rate limits and audit IPs collapse into a single shared value. Set ORBIT_PROXY_SECRET (and the web
# Worker's PROXY_SECRET) so a caller hitting the API directly can't choose its own address (ratelimit.client_ip).
# --ws-max-size: a live socket carries audio frames of at most 64 kB and small JSON; a 16 MB message (the default)
# would be buffered whole before the app could refuse it.
CMD ["sh", "-c", "alembic upgrade head && uvicorn orbit_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header --ws-max-size 131072"]
