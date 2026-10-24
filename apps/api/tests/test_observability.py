import json
import logging

from fastapi.testclient import TestClient

from orbit_api.observability import (
    ContextFilter,
    JsonFormatter,
    _scrub_event,
    init_sentry,
    redact,
    session_id_var,
)


def test_secrets_are_redacted_from_log_text() -> None:
    line = ("key sk-abcdef1234567890 auth Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlMTIz "
            "url /v1/sessions/s1/live?ticket=Zq9_secretTicket&x=1 deepgram Token 0123456789abcdef0123456789abcdef")
    out = redact(line)
    secrets = ("sk-abcdef1234567890", "eyJhbGciOiJIUzI1NiJ9", "Zq9_secretTicket", "0123456789abcdef0123456789abcdef")
    for secret in secrets:
        assert secret not in out, out
    assert "ticket=[redacted]&x=1" in out and "Bearer [redacted]" in out


def test_json_log_lines_carry_correlation_ids_and_stay_redacted() -> None:
    record = logging.LogRecord("orbit", logging.WARNING, __file__, 1, "upstream said %s", ("sk-leakedkey123456",), None)
    token = session_id_var.set("sess-1")
    try:
        ContextFilter().filter(record)
    finally:
        session_id_var.reset(token)
    data = json.loads(JsonFormatter().format(record))
    assert data["level"] == "WARNING" and data["session_id"] == "sess-1"
    assert "sk-leakedkey" not in data["msg"] and "[redacted]" in data["msg"]


def test_request_id_is_generated_or_propagated(client: TestClient) -> None:
    generated = client.get("/health").headers["x-request-id"]
    assert len(generated) >= 8
    echoed = client.get("/health", headers={"X-Request-ID": "trace-abc-12345"}).headers["x-request-id"]
    assert echoed == "trace-abc-12345"
    # junk / injection attempts are replaced, not echoed
    bad = client.get("/health", headers={"X-Request-ID": "a\r\nSet-Cookie: x=1"}).headers["x-request-id"]
    assert "Set-Cookie" not in bad


def test_sentry_is_off_without_a_dsn_and_scrubs_what_it_would_send() -> None:
    assert init_sentry(None, "test", None) is False
    event = {
        "message": "failed for Bearer abcdefghijklmnop",
        "request": {"url": "https://api/v1/sessions/s/live?ticket=secret", "data": {"password": "pw"},
                    "headers": {"Authorization": "Bearer x"}, "cookies": {"orbit_session": "t"},
                    "query_string": "ticket=secret"},
        "breadcrumbs": {"values": [{"message": "transcript: tell me about yourself"}]},
        "user": {"email": "me@example.com"},
    }
    out = _scrub_event(event, {})
    assert out is not None
    assert out["request"] == {"url": "https://api/v1/sessions/s/live"}
    assert "breadcrumbs" not in out and "user" not in out
    assert "abcdefghijklmnop" not in out["message"]


def test_reviewer_link_credentials_are_redacted() -> None:
    assert redact("GET /v1/career/evidence-shares/view/" + "x" * 43) == (
        "GET /v1/career/evidence-shares/view/[redacted]")
