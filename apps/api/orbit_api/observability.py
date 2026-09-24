"""Logging, correlation IDs, secret redaction, and optional Sentry.

- Logs are JSON lines in production (ORBIT_LOG_FORMAT=json|text; default json in production, text elsewhere).
- Every log line carries the ambient `request_id`, `user_id` and `session_id` (context variables set by the HTTP
  middleware and the live socket), so one session's lines can be pulled together.
- A redaction filter masks secrets that might slip into a message: provider keys, bearer tokens, JWTs, WS tickets.
- Sentry is inactive unless ORBIT_SENTRY_DSN is set. It never sends PII, request bodies, headers or query strings
  (WS tickets live in the query), and breadcrumbs are dropped — transcripts, resumes and screenshots can't reach it.

Never log raw transcripts, resumes, screenshots, passwords, tokens or keys; log IDs and sizes instead.
"""

import contextvars
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_id", default=None)
session_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("session_id", default=None)

_SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{8,}"), "sk-[redacted]"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}"), r"\1[redacted]"),
    (re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), "[jwt-redacted]"),
    (re.compile(r"(?i)((?:ticket|token|api_key|key|password)=)[^&\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(?i)(token\s+)[a-f0-9]{32,}"), r"\1[redacted]"),  # Deepgram "Authorization: Token <hex>"
]
_REQUEST_ID_OK = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def redact(text: str) -> str:
    for pattern, repl in _SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


class ContextFilter(logging.Filter):
    """Adds correlation IDs to every record and redacts secrets from the formatted message."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        record.user_id = user_id_var.get()
        record.session_id = session_id_var.get()
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        redacted = redact(message)
        if redacted != message or record.args:
            record.msg, record.args = redacted, None
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("request_id", "user_id", "session_id"):
            if value := getattr(record, key, None):
                out[key] = value
        if record.exc_info:
            out["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(out, ensure_ascii=False)


def configure_logging(fmt: str) -> None:
    handler = logging.StreamHandler()
    handler.addFilter(ContextFilter())
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s sess=%(session_id)s] %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    # httpx logs every request URL at INFO; signed download URLs and provider URLs don't belong in logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def request_id_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    incoming = request.headers.get("x-request-id", "")
    rid = incoming if _REQUEST_ID_OK.match(incoming) else uuid.uuid4().hex[:16]
    token = request_id_var.set(rid)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-ID"] = rid
    return response


def _scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    req = event.get("request")
    if isinstance(req, dict):
        for key in ("data", "cookies", "headers", "query_string", "env"):
            req.pop(key, None)
        if isinstance(req.get("url"), str):
            req["url"] = req["url"].split("?", 1)[0]
    event.pop("breadcrumbs", None)  # may hold log lines / URLs from the live session
    event.pop("user", None)
    tags = event.setdefault("tags", {})
    for key, var in (("request_id", request_id_var), ("session_id", session_id_var)):
        if value := var.get():
            tags[key] = value
    if "message" in event and isinstance(event["message"], str):
        event["message"] = redact(event["message"])
    return event


def init_sentry(dsn: str | None, env: str, release: str | None) -> bool:
    """Start Sentry if a DSN is configured and the SDK is installed. Returns whether it's active."""
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logging.getLogger(__name__).warning("ORBIT_SENTRY_DSN is set but sentry-sdk isn't installed")
        return False
    sentry_sdk.init(
        dsn=dsn, environment=env, release=release,
        send_default_pii=False, max_breadcrumbs=0, traces_sample_rate=0.0,
        before_send=_scrub_event,  # type: ignore[arg-type]
    )
    return True
