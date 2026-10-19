# Business interview coordination

## Find panel times

On an active candidate's **Schedule an interview** form, expand **Find panel times**, choose a future window,
and find suggestions. Pick 3–5 suggestions and **Use selected times** to copy them into the existing invitation.
Sending the invitation remains an explicit recruiter action. Suggestions use 15-minute steps and return the
earliest 24 fitting options. Windows must start more than 30 minutes ahead, last 15 minutes to 12 hours, and end
within 60 days. Interview duration remains 15–240 minutes.

Initial invitation suggestions use the application's assigned interviewers, falling back to the recruiter if no
panel is assigned. Replacement suggestions use the invitation's saved panel snapshot. Only booked interviews
inside this company in Orbit are checked; Google/Microsoft and other external calendars are not connected.
Suggestions are snapshots, do not hold slots, and never reveal other candidates or their appointments.

## Candidate-led time changes

1. A confirmed candidate opens their private application link and shares 1–3 availability windows with a short
   scheduling note. The browser converts local inputs to offset-aware timestamps and records its IANA time zone.
2. One request may be waiting at a time. The candidate can withdraw it and share new availability. Withdrawing
   the request does not cancel the interview or revoke times already offered by the team.
3. An internal notification goes to the invitation's current eligible coordinator, then the job creator or up to
   three eligible coordinators as a fallback. It contains no candidate name, email, reason or schedule details.
4. The recruiter opens **Interview coordination** on the application. They can find times within the shared
   windows and select up to five alternatives, then save a reply. Email notification is optional and defaults off.
   A message-only reply completes the request and lets the candidate share another window if needed.
5. Offered alternatives update the current invitation's offered slots while retaining its booked time and ID.
   The candidate refreshes scheduling updates and chooses another offered time in **Your interview**.
6. Booking rechecks panel conflicts under the company lock. If another candidate booked that time meanwhile,
   the attempted replacement fails and the original booking stays. Successful selection atomically changes the
   booking, resolves the request permanently, and uses the existing calendar UID with an increased sequence.
   Returning to a previously offered time later cannot resurrect an old resolved request.

The candidate and recruiter each see the latest 20 requests. Older history stays subject to application retention
and deletion. Retry-key lookup covers all history, so a lost response does not duplicate an old request or resend
an already-recorded scheduling email. Email delivery failure after recording is not automatically retried by
this workflow. A candidate still sees the saved reply on the application page.

## Automation and controls

**Automations → select job → Interview time requests** adds an elapsed-time target for requests still awaiting a
recruiter reply. It defaults off, including for existing enabled playbooks. Replying clears this follow-up even
when the candidate has not yet selected an alternative. This rule creates internal work, not automatic replies.

Company/job access and coordinator permissions apply to staff routes. Candidates use their existing private
application token; an Orbit login is not required. Requests stop on suspension, data-deletion requests, terminal
application states and past booked interviews. Replacement invitations supersede earlier time requests.
Revision checks protect against stale edits and concurrent replies. Public activity contains generic labels,
not internal task notes, panel feedback, actor IDs or another candidate's details. Blind review masks names and
contact details in scheduling notes/replies shown to staff. Free text stays in application events, which are
deleted with the application. The company audit stores action metadata rather than copying that free text.

## Deployment and API

No additional migration beyond the included enterprise task migration `58ca94f2d7e3` is required. Run the normal
locked API dependency install; `tzdata` supplies IANA zones consistently on Windows and Linux. No new service,
calendar credential or provider is required. Keep the API running for background task reconciliation.

Staff prefix `/v1/business/companies/{cid}/applications/{aid}`:

- `POST /interview-options {windows:[{start,end}],duration_min,interview_id?}`: read-only slot suggestions.
- `GET /scheduling-requests`: request history and current invitation ID/revision.
- `POST /scheduling-requests/{change_id}/reply {request_id,base_revision,interview_revision,message,slots,notify}`.

Private candidate prefix `/v1/public/business/applications/{token}`:

- `GET /scheduling-requests`.
- `POST /scheduling-requests {request_id,interview_id,interview_revision,windows,timezone,reason}`.
- `POST /scheduling-requests/{change_id}/withdraw {request_id,base_revision}`.
- Existing `POST /book {slot}` confirms one offered alternative and updates the existing calendar event.

`request_id` is a fresh UUID per action, retained when retrying that exact action. Conflicting reuse returns 409.
All window/slot timestamps need an offset; naive timestamps are rejected. Times outside the candidate's windows
or overlapping another booked panel interview cannot be offered as replacements.

Tests exercise requests, retries, explicit email notification, concurrent replies, conflict preservation, calendar
continuity, lifecycle/access boundaries, bounded history, automation and deletion. Real-browser flows cover slot
finding → invitation → booking → request → alternatives → confirmed replacement on desktop/mobile, including a
candidate in Asia/Kolkata, accessibility and overflow checks. No production communication or deployment is run
during development.
