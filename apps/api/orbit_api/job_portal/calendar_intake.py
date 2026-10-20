"""Bounded, non-executing iCalendar intake. A preview never updates a job or contacts an organizer."""
import hashlib
import re
from datetime import UTC, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.db import get_db
from orbit_api.models import User
from orbit_api.ratelimit import limit_user

from .message_updates import Contract, owned, state

router = APIRouter(prefix="/v1/jobs/tracker", tags=["interview invitations"],
    dependencies=[Depends(limit_user("calendar-intake", rate_per_s=1, burst=20))])


def plain(value: str) -> str:
    if any((ord(c) < 32 and c not in "\n\r\t") or 0x7f <= ord(c) <= 0x9f
           or c in "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069" for c in value):
        raise ValueError("Calendar text contains unsupported control characters")
    return value


def start_time(header: str, value: str) -> tuple[str, str]:
    parts = header.split(";")
    params: dict[str, str] = {}
    for part in parts[1:]:
        key, sep, val = part.partition("=")
        if not sep or key.upper() in params or key.upper() not in {"TZID", "VALUE"}:
            raise ValueError("Unsupported or duplicate start-time parameter")
        params[key.upper()] = val.strip('"')
    if params.get("VALUE", "DATE-TIME").upper() != "DATE-TIME":
        raise ValueError("All-day invitations need a confirmed interview time entered manually")
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z?", value):
        raise ValueError("Use an invitation with a complete date, time and time zone")
    at = datetime.strptime(value.removesuffix("Z"), "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        if "TZID" in params:
            raise ValueError("A UTC invitation cannot also specify TZID")
        return at.replace(tzinfo=UTC).isoformat(), "UTC"
    tzid = params.get("TZID", "")
    if not tzid or len(tzid) > 100:
        raise ValueError("Floating times are not guessed; export UTC or an IANA time zone")
    try:
        zone = ZoneInfo(tzid)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Unknown time zone; export the invitation with a UTC time") from exc
    # A repeated or nonexistent wall time cannot identify a unique instant. Do not pick a DST fold silently.
    candidates = {at.replace(tzinfo=zone, fold=fold).astimezone(UTC) for fold in (0, 1)
                  if at.replace(tzinfo=zone, fold=fold).astimezone(UTC).astimezone(zone).replace(tzinfo=None) == at}
    if len(candidates) != 1:
        raise ValueError("Ambiguous or nonexistent daylight-saving time; export this event in UTC")
    return next(iter(candidates)).isoformat(), tzid


def events_from(text: str) -> list[dict[str, Any]]:
    plain(text)
    if len(text.encode("utf-8")) > 131072:
        raise ValueError("Use a calendar file smaller than 128 KiB")
    lines = re.sub(r"\r?\n[ \t]", "", text.lstrip("\ufeff")).splitlines()
    if len(lines) > 2000:
        raise ValueError("This calendar has too many lines; export only the relevant invitation")
    stack: list[str] = []
    events: list[dict[str, Any]] = []
    event: dict[str, tuple[str, str]] = {}
    seen: set[str] = set()
    ended = False
    version = False
    for line in lines:
        if not line:
            continue
        # Split only at a property delimiter outside quoted parameters.
        match = re.match(r'^([^:"\r\n]*(?:"[^"\r\n]*"[^:"\r\n]*)*):(.*)$', line)
        if not match or ended:
            raise ValueError("Malformed calendar content")
        header, value = match.groups()
        name = header.split(";", 1)[0].upper()
        if name == "BEGIN":
            kind = value.upper()
            if not stack and kind == "VCALENDAR":
                pass
            elif stack == ["VCALENDAR"] and kind == "VEVENT":
                event = {}
            elif stack == ["VCALENDAR", "VEVENT"] and kind == "VALARM":
                pass  # alarms, attachments, attendees and URLs are never executed or fetched
            else:
                raise ValueError("Only standalone events are supported; export UTC without custom time-zone blocks")
            stack.append(kind)
        elif name == "END":
            if not stack or stack.pop() != value.upper():
                raise ValueError("Unbalanced calendar components")
            if value.upper() == "VEVENT":
                if not event.get("UID") or not event.get("DTSTART"):
                    raise ValueError("Each invitation needs UID and DTSTART")
                uid = event["UID"][1]
                if not uid.strip() or len(uid) > 1024:
                    raise ValueError("The event needs a nonempty UID of at most 1024 characters")
                if uid in seen:
                    raise ValueError("Multiple versions of one event need manual review; export only the current event")
                seen.add(uid)
                if event.get("STATUS", ("", ""))[1].upper() == "CANCELLED":
                    raise ValueError("Cancelled invitations need manual review; no date is removed automatically")
                stamp, zone = start_time(*event["DTSTART"])
                summary = re.sub(r"\\([nN,;\\])", lambda m: "\n" if m[1].lower() == "n" else m[1],
                                 event.get("SUMMARY", ("", "Calendar event"))[1])
                events.append({"id": hashlib.sha256(uid.encode()).hexdigest()[:24], "title": summary[:300],
                    "start_at": stamp, "time_zone": zone, "source_quote": ":".join(event["DTSTART"]),
                    "tentative": event.get("STATUS", ("", ""))[1].upper() == "TENTATIVE"})
                if len(events) > 20:
                    raise ValueError("Export at most 20 events for review")
            if not stack:
                ended = True
        elif stack == ["VCALENDAR"]:
            if name == "VERSION":
                if version or value != "2.0":
                    raise ValueError("Use iCalendar version 2.0")
                version = True
            if name == "METHOD" and value.upper() not in {"REQUEST", "PUBLISH"}:
                raise ValueError("Only invitations or published events can be imported; review cancellations manually")
        elif stack == ["VCALENDAR", "VEVENT"]:
            if name in {"RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"}:
                raise ValueError("Recurring invitations need a single confirmed occurrence exported in UTC")
            if name in {"UID", "DTSTART", "SUMMARY", "STATUS"}:
                if name in event:
                    raise ValueError("Duplicate event fields need manual review")
                event[name] = (header, value)
        elif stack != ["VCALENDAR", "VEVENT", "VALARM"]:
            raise ValueError("Expected a calendar container")
    if stack or not ended or not version or not events:
        raise ValueError("Use a complete iCalendar file containing at least one event")
    return events


class CalendarIn(Contract):
    calendar: str = Field(min_length=30, max_length=131072)
    version: str = Field(pattern=r"^[0-9a-f]{64}$")


@router.post("/{entry_id}/calendar-preview")
async def calendar_preview(entry_id: str, body: CalendarIn,
    user: Annotated[User, Depends(require_verified_email)], db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    current = state(await owned(db, user, entry_id))
    if current["version"] != body.version:
        raise HTTPException(409, "This job changed. Refresh before reviewing an invitation.")
    try:
        events = events_from(body.calendar)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"version": current["version"], "events": events, "editable": current["editable"]}
