# Workspace command centers

Built on merged PR #423 (`b862067a`). This batch adds connected planning, operations and preparation features.

## Personal Orbit

### Weekly studio

Open **Jobs → Weekly studio** (`/jobs/weekly`). Set weekly targets for recorded applications (0–100), ended mock
interviews (0–30) and contacts reached (0–50). Zero pauses a goal. Targets persist across weeks and devices; progress
starts fresh each Monday at 00:00 UTC. This is an activity plan, not a readiness score or hiring prediction.

Progress comes from existing owned records, not manually checked boxes:

- Applications use saved `applied_at`, including manually tracked applications and later rejected applications.
- Practice uses ended mock sessions and their `ended_at`; live copilot sessions do not count.
- Contacts count people whose most recent `last_contacted_at` falls in the week. This is not a count of messages or
  a historical contact ledger; contacting someone again changes their most recent recorded day.

Future timestamps and other accounts' records are excluded. The seven-day rhythm displays these same counts by UTC
day. The workspace refreshes every minute while visible, on focus, and through **Refresh progress**. Goal edits keep
their captured base revision; competing writers receive 409 and the local draft remains available for review.

**Ask AI for next steps** proposes experiments based on these saved goals and counts. Each tip references a supplied
metric, quotes its text verbatim, and includes a suggested way to check the result. The AI cannot change goals, send
applications or messages. Five coaching attempts per account per UTC day, separate from Action desk's allowance.

### Combined calendar export

**Action desk → Export upcoming dates** downloads a snapshot `.ics` of the upcoming dated actions currently visible
in the queue, including contact follow-ups and tracker dates. It preserves the saved UTC instant and uses stable
source-based event IDs. Unknown duration is not invented. Undated application packets, invalid dates and past dates
are omitted. Calendar text is escaped and UTF-8 lines fold at 75 octets without splitting Unicode code points.

This is a manual snapshot export, not a subscription or automatic calendar synchronization. Reimport behavior depends
on the calendar application. No attendees are invited and no account tokens or personal notes are embedded.

## Orbit for Business

### Enterprise workspace navigation

Company pages now have a desktop sidebar with company context, current role, verification status and permission-aware
navigation. Smaller screens retain horizontally scrollable navigation. The Control room is a new destination; existing
jobs, hiring desk, automations, settings, billing and audit routes retain their authorization rules. The sidebar links
back to personal weekly planning. New native SVG flow graphics and reduced-motion-aware animations support both modes.

### Hiring control room

Open **Control room** (`/business/app/:company/control-room`). It has three views:

- **Role readiness:** verification, saved requirements, saved interview criteria and optional automation setup.
  These are process suggestions, not new publishing restrictions. Each missing item links to its existing editor.
- **Pipeline signals:** counts of active, email-confirmed applications by current stage, counts waiting at least three
  elapsed calendar days, and oldest current-stage age. These describe process delays, not candidate quality.
- **Panel capacity:** the latest booked interview per application in the next seven days, scheduled minutes per active
  company panel member, and bookings without an active panel. Bookings are not assumed to be completed interviews.

Only open, draft and paused jobs visible to the caller contribute. Hiring managers see their assigned jobs; interviewers
cannot access this cross-job workspace. Withdrawn/rejected/hired applications, unconfirmed applications and deletion
requests do not contribute to active counts or capacity. An explicitly empty panel remains empty; legacy assignments
use the same fallback as Orbit's scheduling logic. A newer unbooked interview supersedes an older booking.

The display covers the newest 200 visible jobs and explicitly indicates truncation. Automated refresh runs each minute
while visible and on focus. The AI operations brief considers the first 20 fact entries and uses the existing bounded
provider runner (10 operations attempts per company per UTC day, shared across members). Input contains aggregate facts
and job titles, without candidate names, resumes or private interview feedback. Validated references and exact source
quotes anchor advice; they do not prove every semantic claim in a suggestion. Humans review the proposed experiments.
Access and source versions are rechecked after the provider wait. Source changes invalidate displayed advice.

### Interview preparation automation

In a job's **Automations → Role playbook**, opt into **Interview preparation** and choose a window from 1–168 hours
before a booked interview. This rule defaults to off, including for previously enabled playbooks.

Within the window, a missing active panel or missing saved criteria for the planned interview stage creates one durable
internal **Prepare the interview kit** task. The current interview stage is used when applicable; otherwise the first
interview stage is used. The task links to the application and plan editor. Existing assignment, notifications, snoozing,
handled/reopen controls and audit behavior apply. It deduplicates by booking episode and resolves when setup is ready,
the interview passes/cancels, the application becomes inactive or the recipe/job pauses. Saving a playbook reconciles
immediately; the existing backend automation sweeper reconciles periodically, including while staff browsers are closed.
The backend must be running. This rule sends no candidate emails and makes no candidate decisions.

The extension also fixes async lazy-load failures when the automation runner reads legacy application panel assignments.

## Data and rollout

Apply Alembic migration **`69db05a3e8f4`** after `58ca94f2d7e3`. It creates `career_weekly_goals`, with an account foreign
key and deletion cascade. Goals are included in the account JSON export. Downgrading drops only this new goal table.
Business recipes remain JSON, so the new opt-in field requires no additional Business table migration.

AI uses existing provider configuration, a 60-second timeout, a 3,000-token output cap and durable attempt reservations.
Failed calls count toward the per-feature allowance; no resume/application credits are consumed. Mock responses are
visibly labelled **Demo AI**. Tests and screenshots use the mock provider and a local mail outbox. No dependency, external
service or new secret is needed for the deterministic features. Live-model quality and PostgreSQL concurrency have not
been validated locally; the new lifecycle tests are included in CI's existing PostgreSQL gate.

## Research sources

Primary sources inspected on 19–20 October 2026 informed the product patterns. Implementation uses Orbit's own models,
permissions and components; no external code or dependencies were copied or installed.

- [Ashby core dashboards](https://docs.ashbyhq.com/core-dashboards): role-scoped operations views, interview scheduling
  visibility and panel commitments informed the control-room organization.
- [Greenhouse structured interviewing](https://www.greenhouse.com/interviewing-decision-making): consistent preparation
  and task reminders informed the opt-in missing-kit rule.
- [Huntr metrics](https://help.huntr.co/en/articles/10042709-maps-and-metrics) and
  [Teal tracking](https://help.tealhq.com/en/articles/14435727-how-to-track-your-job-applications): progress grounded in
  maintained application records informed weekly targets and explicit counting definitions.
- [AgentATS stage metrics](https://github.com/shravangithub/AgentATS/blob/1664b6d0245d3059b1596749a0fb1cd39f8a5246/Code.gs)
  ([MIT license](https://github.com/shravangithub/AgentATS/blob/1664b6d0245d3059b1596749a0fb1cd39f8a5246/LICENSE)):
  inspected `getStageMetrics` and `getAnalytics` for lifecycle accounting and stage-duration patterns.
- [HireSense analytics routes](https://github.com/StevSant/HireSense/blob/cb87e02cbffe0f1a53833f2a2ed363851e61ccbb/backend/src/hiresense/analytics/api/routes.py)
  ([MIT license](https://github.com/StevSant/HireSense/blob/cb87e02cbffe0f1a53833f2a2ed363851e61ccbb/LICENSE)):
  inspected authenticated funnel/focus analytics as a pattern for separating measured signals from proposed next steps.

Review screenshots: `docs/screenshots/command-centers-*`. API tests cover ownership, UTC boundaries, source changes,
revision races, export/deletion, migration roundtrips, panel scope/latest bookings, opt-in preview, deduplication and
automatic resolution. Browser flows cover desktop/mobile, accessibility, overflow, reduced motion, stale-edit recovery,
goal persistence, AI reviews, the preparation rule and calendar downloads.
