# Jobs AI: fewer places to look

## Candidate workflows

Jobs AI now has four primary destinations:

- **Today** combines Overview and Action desk. It shows daily actions from saved records, a grounded AI brief, follow-up rules and links to a weekly plan. Search preferences are suggested without blocking daily work.
- **Find jobs** contains matches, individual listings and search preferences.
- **Applications** contains the tracker, each job workspace, the auto-apply agent, setup and application review queue. The tracker is the landing destination so manual and automatic applications have a common home.
- **People** contains saved contacts, contact discovery, messages and job site profile writing. Writing tools open on request; existing resume/job links still open the relevant writing context.

The primary navigation fits a 360px viewport. Secondary links only show frequent tools for the current area. The searchable **Find a tool** panel includes old names such as Action desk and Weekly studio, as well as intent terms such as recruiter, interview and consent.

## Each tracked job

Eight peer tabs are grouped into three areas:

- **Job & resume:** evidence and fit, resume kit, company research.
- **Interview:** interview workspace, preparation plan, practice.
- **Progress & offer:** timeline, offer.

A labelled select exposes the tools inside the chosen area. Existing `?tab=` links remain valid. Selection is stored in the URL, preserves other parameters and follows browser Back/Forward. Controls use native buttons and selects rather than an incomplete ARIA tab implementation.

## Research and decisions

Reviewed on 20 October 2026:

- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): show frequent choices first, make specialist options easy to locate, and group related tasks. This informed four primary areas and on-demand tool discovery. These are design hypotheses for Orbit; the article is not evidence of Orbit candidate outcomes.
- [GOV.UK: Complete multiple tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/): simplify the transaction, group related actions and use meaningful statuses. This informed the combined daily home and retention of record-derived reminders. Candidates can move freely between tasks; there is no new forced sequence or invented completion score.

The daily action filters, manual refresh and calendar export share one disclosure. Compact goal links help candidates who have no tracked jobs yet. Returning candidates see their daily actions directly. Hover motion follows the existing reduced-motion preference. Larger workspaces and the tool finder load on demand; bundle thresholds are unchanged.

## Compatibility and verification

- All existing Jobs AI routes, saved contacts, packets, consent controls and mission tools remain available. `/jobs/actions` opens the same daily home as `/jobs`.
- Search preferences keep their existing API and matching behavior. The home no longer duplicates the full matches feed.
- People writing state stays mounted when closed with its disclosure, and saved writing kits retain the existing per-resume storage behavior.
- Route tests cover every existing destination, ambiguous prefixes, old-name search and mission group coverage.
- Browser tests cover a 360px phone and desktop, four primary links, tool discovery, weekly targets, mission URL/history behavior, People disclosures, accessibility and overflow. Existing contact research, reviewed AI brief, playbook and application review flows are exercised separately with fixtures.
- No candidate usability study has been conducted for this change. Follow-up research should observe first-time candidates finding a match, enabling auto-apply and preparing for one interview. Measure successful task completion, wrong destinations and time to the next action before adding further navigation or automation.

## Further product work to validate

1. Resume a specific unfinished application from Today, using server-confirmed packet state.
2. Show the chosen job context consistently across fit checks, preparation and outreach.
3. Test whether candidates understand the distinction between their tracker and the agent's review queue.
4. Improve global tool search using observed candidate vocabulary and privacy-preserving aggregate usage, after designing its data and consent requirements.

These items are proposals, not shipped features or claims of improved hiring outcomes.
