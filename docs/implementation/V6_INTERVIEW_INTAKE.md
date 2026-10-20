# V6 increment 2 — invitation to interview preparation

Base: `47bececf` (PR #438 merged), 2026-10-20. Personal Orbit only. This is a bounded F04/F08 intake and F05 guidance integration, not completion of those entire specifications.

## Candidate journey

1. Prepare → **Bring an invitation**, or the interview step of an existing opportunity → **Import interview invitation**.
2. Choose the owned tracked job. Upload an `.ics` file or paste iCalendar text. Review is free and does not invoke a model.
3. Choose the event when the file has several. Review the original `DTSTART`, source time zone, browser-local time, current stage and proposed date. The sender and job match are unverified.
4. Optionally select **Mark this job as interviewing**. Explicitly confirm the job/date/stage. Only then save through the existing versioned tracker confirmation endpoint.
5. Continue directly to this job's existing preparation plan. Existing saved-date actions use the same `next_at`; no second reminder/calendar service is created.
6. Open optional preparation guidance and deliberately request help. The existing opportunity coach quotes the saved interview date and up to three unchecked preparation tasks, with links back to this job. Marking a task complete clears the previous guidance without another model call.

Review transitions use existing reduced-motion-aware animation, focus moves to the review heading, and `scroll-mt-28` keeps it below the sticky header. No new top-level tab. Existing employer-message mode, routes, consent, business tools and workers remain available.

## Reuse and boundaries

- `calendar_intake.py` adds a read-only preview endpoint beside `message_updates.py`. Ownership and current version are checked before parsing. Verified email, rate limiting and extra-field rejection apply.
- The existing `/message-update/confirm` is the sole writer: atomic version check, explicit confirmation, closed-record protection and owner filter. Date-only review keeps the current stage. Preview never means interview confirmed or employer verified.
- Input limit: 128 KiB UTF-8, 2,000 logical lines, 20 events. Supports UTC `Z` and IANA `TZID`, unfolds lines and preserves exact UTC seconds. Imported time is read-only; manual correction links to the owned job's existing interview tool.
- Floating/all-day times, unknown/custom timezone blocks, ambiguous/nonexistent DST wall times, recurrence, cancellations, repeated event UIDs, malformed components and controls require manual review. These limitations are deliberate; this is not a complete iCalendar implementation. One unsupported event rejects the file; no silently partial import.
- Links, attachments, attendees and alarms are never fetched or executed. No calendar subscription, email OAuth, organizer verification, external invitation acceptance or calendar sync is implemented.
- The full calendar body stays in transient browser state and the request, is not persisted, and is cleared after success. No file is uploaded to an LLM. Event UID is hashed for preview selection only; no durable UID receipt or cross-file deduplication claim. Repeating the same chosen date/stage disables the UI save; a stale confirmation version cannot replay.
- Existing tracker dates/stages and preparation checks already participate in account export/delete. There are no new tables, migrations, secrets or dependencies.
- `opportunity_coach.source` reuses `plan_for`. Grounding includes the saved instant, plan counts and unchecked tasks. The complete deterministic plan contributes to its version so completion, date, requirements and day changes invalidate advice. The source is checked again after generation.
- AI uses existing `opportunity_coach` provider accounting and five-request UTC-day limit, including failures; the preparation panel does not create a separate allowance. No model call on opening/reading. Fit requirements remain prior checks, not evidence of skills. Suggested rehearsal is not verified employer material or hiring probability.
- Coach tasks use the UTC-date plan; the checklist uses the browser's day. This difference is disclosed in the panel. Date-free/multiple-round adaptation, snooze, offline support, and automatic completion carryover across reschedules remain F05 work. Existing date-keyed completed records are retained; this PR does not remap them to a new schedule.

## Research and implementation choice

Read the primary [iCalendar specification, RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) for content-line folding, DATE-TIME/TZID and recurrence semantics, and Python's [zoneinfo documentation](https://docs.python.org/3/library/zoneinfo.html) for IANA timezone lookup and fold behavior. The existing locked `tzdata` dependency supplies the Windows timezone database. Rejecting ambiguous times rather than selecting a fold is Orbit's conservative intake policy, not a claim that RFC 5545 mandates rejection. No external source code, new search provider, calendar library or browser-agent runtime was copied or installed.

## Rollback and support

Revert this increment's code changes; no data backfill or schema rollback. Existing manual date editing and message review continue to work. For unsupported exports, ask the candidate to verify the original invitation and enter the confirmed time manually, or export a single event in UTC without custom timezone blocks. Never suggest bypassing employer checks or granting mailbox access as a workaround.

Local verification and exact limitations are recorded in `BASELINE.md`; review screenshots are listed in `SCREENSHOT_MANIFEST.md`. Remote CI, isolated staging and live provider/production checks require separate evidence. This increment does not certify the whole product for launch.
