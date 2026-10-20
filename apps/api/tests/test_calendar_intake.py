"""Calendar intake is bounded, owned, non-executing and explicitly confirmed."""
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.job_portal.calendar_intake import events_from
from orbit_api.models import ProviderRequest
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


def calendar(start: str = "DTSTART;TZID=Asia/Kolkata:20300102T103000", extra: str = "") -> str:
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n"
            "UID:private-id@example.test\r\nSUMMARY:Interview\\, round one\r\n continued\r\n"
            + start + "\r\n" + extra + "END:VEVENT\r\nEND:VCALENDAR\r\n")


def test_time_zone_unfolding_seconds_and_ignored_alarm() -> None:
    result = events_from(calendar(extra="BEGIN:VALARM\r\nACTION:DISPLAY\r\n"
        "ATTACH:https://example.test/private\r\nEND:VALARM\r\n"))[0]
    assert result["start_at"] == "2030-01-02T05:00:00+00:00"
    assert result["title"] == "Interview, round onecontinued"
    assert result["time_zone"] == "Asia/Kolkata"
    assert "private" not in json.dumps(result)
    assert events_from(calendar('DTSTART;TZID="Asia/Kolkata":20300102T103000'))[0]["start_at"] == result["start_at"]
    utc = events_from(calendar("DTSTART:20300102T050030Z"))[0]
    assert utc["start_at"] == "2030-01-02T05:00:30+00:00"
    assert utc["source_quote"] == "DTSTART:20300102T050030Z"


@pytest.mark.parametrize("start", [
    "DTSTART:20300102T103000", "DTSTART;VALUE=DATE:20300102",
    "DTSTART;TZID=Unknown/Zone:20300102T103000",
    "DTSTART;TZID=America/New_York:20261101T013000",
    "DTSTART;TZID=America/New_York:20260308T023000",
    "DTSTART;TZID=Asia/Kolkata:20300102T103000Z",
    "DTSTART;VALUE=DATE-TIME;VALUE=DATE-TIME:20300102T103000Z",
    "DTSTART:20309902T103000Z",
])
def test_unsupported_or_ambiguous_time_is_never_guessed(start: str) -> None:
    with pytest.raises(ValueError):
        events_from(calendar(start))


@pytest.mark.parametrize("extra", [
    "RRULE:FREQ=DAILY\r\n", "RDATE:20300102T050000Z\r\n", "EXDATE:20300102T050000Z\r\n",
    "RECURRENCE-ID:20300102T050000Z\r\n", "STATUS:CANCELLED\r\n", "DTSTART:20300102T050000Z\r\n",
])
def test_recurrence_cancellations_and_duplicate_dates_require_manual_review(extra: str) -> None:
    with pytest.raises(ValueError):
        events_from(calendar(extra=extra))


@pytest.mark.parametrize("text", [
    calendar().replace("VERSION:2.0\r\n", ""), calendar().replace("VERSION:2.0", "VERSION:1.0"),
    calendar() + calendar(), calendar().replace("END:VEVENT\r\n", ""),
    calendar().replace("UID:private-id@example.test", "UID: "),
    calendar(extra="DESCRIPTION:bad\x00text\r\n"), calendar(extra="DESCRIPTION:bad\u202etext\r\n"),
    calendar(extra="DESCRIPTION:" + "a" * 131072 + "\r\n"),
], ids=["missing-version", "old-version", "two-calendars", "unbalanced", "empty-uid", "control", "bidi", "oversize"])
def test_malformed_and_oversized_calendars_fail_closed(text: str) -> None:
    with pytest.raises(ValueError):
        events_from(text)


def test_multiple_events_are_separate_and_duplicate_versions_are_not_resolved() -> None:
    text = calendar()
    event = text[text.index("BEGIN:VEVENT"):text.index("END:VCALENDAR")]
    with pytest.raises(ValueError, match="Multiple versions"):
        events_from(text.replace("END:VCALENDAR", event + "END:VCALENDAR"))
    two = events_from(text.replace("END:VCALENDAR", event.replace("private-id", "other-id") + "END:VCALENDAR"))
    assert len(two) == 2 and two[0]["id"] != two[1]["id"]
    many = "".join(event.replace("private-id", f"id-{index}") for index in range(21))
    with pytest.raises(ValueError, match="at most 20"):
        events_from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + many + "END:VCALENDAR\r\n")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def setup(client: TestClient) -> tuple[dict[str, str], str]:
    user = register(client, f"calendar-{tag()}@example.com")
    result = client.post("/v1/jobs/tracker/manual", headers=auth(user),
        json={"title": "Engineer", "company": "Example", "status": "applied", "notes": "Keep private notes"})
    assert result.status_code == 201, result.text
    return user, str(result.json()["id"])


def current(client: TestClient, user: dict[str, str], entry: str) -> dict[str, Any]:
    return dict(client.get(f"/v1/jobs/tracker/{entry}/message-update", headers=auth(user)).json())


def test_preview_never_writes_or_calls_ai_then_confirmation_feeds_existing_preparation(client: TestClient) -> None:
    user, entry = setup(client)
    before = current(client, user, entry)
    at = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    body = {"calendar": calendar(at.strftime("DTSTART:%Y%m%dT%H%M%SZ")), "version": before["version"]}
    result = client.post(f"/v1/jobs/tracker/{entry}/calendar-preview", headers=auth(user), json=body)
    assert result.status_code == 200, result.text
    assert current(client, user, entry) == before
    async def requests(db: Any) -> list[Any]:
        return list(await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == uid(user))))
    assert db_call(client, requests) == []
    event = result.json()["events"][0]
    confirmation = {"version": before["version"], "confirmed": True,
                    "status": "interviewing", "next_at": event["start_at"]}
    saved = client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json=confirmation)
    assert saved.status_code == 200, saved.text
    assert datetime.fromisoformat(saved.json()["next_at"]) == at
    assert client.get(f"/v1/jobs/tracker/{entry}/plan", headers=auth(user)).json()["total"] > 0
    actions = client.get("/v1/jobs/actions", headers=auth(user)).json()["items"]
    assert any(item["path"] == f"/jobs/mission/{entry}?tab=plan" for item in actions)
    assert client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm",
                       headers=auth(user), json=confirmation).status_code == 409
    tracked = client.get("/v1/jobs/tracker", headers=auth(user)).json()
    assert next(row for row in tracked if row["id"] == entry)["notes"] == "Keep private notes"
    assert "private-id@example.test" not in json.dumps(tracked)
    assert "round one" not in json.dumps(tracked)
    exported = client.get("/v1/auth/me/export", headers=auth(user))
    assert exported.status_code == 200
    assert "private-id@example.test" not in exported.text and "round one" not in exported.text


def test_ownership_stale_versions_extra_fields_and_closed_jobs(client: TestClient) -> None:
    user, entry = setup(client)
    other, _ = setup(client)
    before = current(client, user, entry)
    url = f"/v1/jobs/tracker/{entry}/calendar-preview"
    body = {"version": before["version"], "calendar": calendar()}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, headers=auth(other), json=body).status_code == 404
    assert client.post(url, headers=auth(user), json={**body, "execute": True}).status_code == 422
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"status": "hired"}).status_code == 200
    assert client.post(url, headers=auth(user), json=body).status_code == 409
    body["version"] = current(client, user, entry)["version"]
    result = client.post(url, headers=auth(user), json=body)
    assert result.status_code == 200 and result.json()["editable"] is False
    assert client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user),
        json={"version": body["version"], "confirmed": True, "status": "interviewing"}).status_code == 409


def test_unverified_account_cannot_import(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings

    user = register(client, f"unverified-calendar-{tag()}@example.com", verified=False)
    result = client.post("/v1/jobs/tracker/manual", headers=auth(user),
                         json={"title": "Engineer", "company": "Example"})
    assert result.status_code == 201, result.text
    entry = str(result.json()["id"])
    before = current(client, user, entry)
    monkeypatch.setenv("ORBIT_EMAIL_VERIFICATION", "required")
    get_settings.cache_clear()
    response = client.post(f"/v1/jobs/tracker/{entry}/calendar-preview", headers=auth(user),
                           json={"version": before["version"], "calendar": calendar()})
    assert response.status_code == 403, response.text
