# Personal Orbit workflow research — 20 October 2026

## Research and selection

Reviewed primary GitHub documentation and selected workflow source files. These are product-pattern references, not runtime dependencies. This PR contains original Orbit implementation; no upstream source, agent instructions or packages were imported or executed.

- [Career Ops](https://github.com/career-ops-hq/career-ops): combines evaluated jobs, contact research, interview preparation, follow-ups and reply reconciliation. Its [reply-watch workflow](https://github.com/career-ops-hq/career-ops/blob/main/modes/reply-watch.md) supports pasted messages as an alternative to mailbox access. The [reply proposal contract](https://github.com/career-ops-hq/career-ops/blob/main/docs/REPLY_PROPOSALS.md) is explicitly a draft: exact application identity, evidence excerpts, candidate acceptance, stale-source checks and replay protection are useful design principles, not an integration compatibility claim.
- [AI Job Search](https://github.com/MadsLorentzen/ai-job-search): connects application outcomes with follow-up drafts and later targeting calibration. Orbit already has resume versions, interview preparation and follow-up drafting; duplicating those tools would add navigation rather than a new workflow.
- [JobOps](https://github.com/DaKheera47/job-ops): connects discovery/tailoring to post-application recruiter-reply tracking. The gap worth addressing here is after applying. Its [license](https://github.com/DaKheera47/job-ops/blob/main/LICENSE) includes additional restrictions; this is a concept reference only, with no code reuse.
- [ApplyTrail](https://github.com/rutuu/ApplyTrail): the [classifier](https://github.com/rutuu/ApplyTrail/blob/main/src/lib/classifier.ts) separates pattern classification from optional AI fallback and filters recruiting noise. Orbit uses original, narrower patterns with exact quotes, explicit conflict handling and candidate confirmation instead of treating a keyword as proof of an outcome.
- [JustAJobApp](https://github.com/JustAJobApp/jobseeker-analytics): mailbox-derived application tracking with limited retained metadata. Its [email-query filter](https://github.com/JustAJobApp/jobseeker-analytics/blob/main/backend/email_query_filters/applied_email_filter.yaml) illustrates narrowing input before classification. Orbit's pasted-message workflow takes only candidate-selected text and does not persist full message bodies.
- [Jobtra](https://github.com/CU1KNIGHT/Jobtra): puts applications, documents and classified recruiter messages in the same workspace. This supports embedding message review inside an opportunity rather than introducing a separate top-level tab.
- [JobTracker](https://github.com/resumejob/JobTracker): exported-message analysis structures application stages for review/export. It is another example of reducing tracker data entry; its reported accuracy is not adopted as an Orbit performance claim.

## Shipped in this PR

Employer reply → source-backed suggestion → explicit review → current tracker/date update → existing interview preparation and Daily actions.

- Free pattern review for explicit acknowledgements, interview invitations, offers, rejections and requests for a reply. Conflicting outcome signals and conditional invitations do not choose a stage automatically.
- Optional AI interpretation using the existing configured provider, exact source quotes, a strict output schema and durable daily quotas.
- A single explicit ISO timestamp with a time zone can prefill a candidate-reviewed date. Multiple times or relative phrases do not get guessed. Date changes start unchecked.
- Candidate-selected job identity, visible before/after choices and confirmation are required before writes. Conditional database updates prevent a stale review from overwriting another writer. Closed jobs are preview-only here; hired is never a suggested/applicable AI stage.
- Only selected stage/date fields change. No full pasted message, note append, outgoing email, mailbox authorization, application consent or automatic submission is introduced.
- The flow is available from the launchpad and inside guided Application/Interview/Outcome steps, with familiar tool search. Existing reminders and interview prep pick up confirmed dates from the normal tracker records.

## Useful next candidates, not shipped here

1. Opt-in mailbox ingestion with provider OAuth, exact application matching and durable message receipts before unattended processing. This needs its own integration and retention work.
2. Interview debrief → candidate-reviewed STAR story draft, connected to Orbit's existing story bank rather than another story tool.
3. A shortlist-wide evidence-gap review using current resume versions and prior fit-check provenance, to prioritize learning/practice across several target roles.
4. Outcome calibration from sufficient recorded applications, clearly separating missing data from meaningful patterns.

## Review and limitations

Paste only the relevant message for the selected job. A quote proves the text was present, not that its sender or claims are authentic. Suggestions are editable and require confirmation. Rule coverage is intentionally limited; manual tracker editing remains available. The optional model may still misinterpret a message, so the product does not claim a measured classification accuracy.

Confirmed changes compare the reviewed job revision inside the database update. Reusing a stale review cannot overwrite a later update. No mailbox ingestion or durable per-message import receipt is claimed; this is an interactive pasted-message workflow.

The full message is transient browser/request data and is cleared from the form after saving. AI provider retention follows the configured provider; the app's preview accounting stores request metadata rather than the message. Browser tests use fabricated messages and the labelled mock provider.

## Round two, 21 October 2026: workflow rules on Today

Researched: [MadsLorentzen/ai-job-search](https://instagit.com/MadsLorentzen/ai-job-search/application-outcome-tracking-follow-up-drafting.md)
(stale-application detection, drafts from verified facts only, manual review before sending),
[Huntr vs Teal](https://huntr.co/blog/huntr-vs-teal) and [JobShinobi's comparison](https://jobshinobi.com/compare/job-tracking-teal-vs-huntr-2026)
(follow-ups as part of the tracking loop; vendor claims, not verified), and
[JobShinobi's follow-up reminders](https://jobshinobi.com/landing/job-application-tracker-with-follow-up-reminders).
None of them is a dependency; no code was reused.

Shipped as opt-in rules beside the existing follow-up and preparation rules (`job_portal/playbooks.py`, migration
`c7e1a9d3b5f2`), each off until the candidate turns it on in "Your workflow rules" on Today:

- **Thank-you note after an interview**: a recorded round in the last N hours (2-72) with no contact logged since
  suggests drafting a thank-you note in the existing message writer (`/jobs/outreach?view=messages&job=…`).
- **Decide on quiet applications**: applied, no reply, next step or contact for N days (14-90): one last follow-up,
  keep waiting, or record it as closed. It replaces that job's routine follow-up reminder.
- **Apply or let go of saved jobs**: saved for N days (3-60) without applying: apply, prepare with auto-apply, or remove.

Rules only add suggestions to Today's action queue and the AI brief. None sends a message, closes an application
or removes a job; the candidate drafts, reviews and sends.

Also in this round: the launchpad and daily actions merged into Today (`/jobs`, `/jobs/actions` redirect to `/`),
the Applications area reads Tracker · Auto-apply · Needs you · People, and auto-apply no longer needs the extension
(docs/HOSTED_APPLY.md).

### Weekly progress email (21 October 2026)

Opt-in in "Your workflow rules" (`job_portal/digest.py`, migration `d3a5c7e9f1b4`). Once a week it summarises what the
candidate recorded (applications, confirmed replies, interviews in the next 7 days, applications Orbit sent) and the
top five actions from Today, with links. A week with nothing new sends nothing. It needs a verified email, runs in the
existing background sweeper next to job alerts, and every email carries a sign-in-free stop link
(`/jobs/digest/off`, a random token like job alerts). Counts are the candidate's own records, never a prediction.

## Round three, 21 October 2026: interview debrief and shortlist skills

Researched: [career-ops](https://github.com/career-ops-hq/career-ops) (interview story bank of STAR+Reflection stories,
the candidate always presses Submit), [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
(interview prep reuses feedback recorded from earlier rounds; a reviewer agent critiques drafts),
[ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills) and [ai-job-agent](https://github.com/AkbarDevop/ai-job-agent)
(STAR story generators), and the [AIHawk](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk) family (YAML profile
driven tailoring, AGPL; concept only). No code reused.

- **Interview debrief** (`job_portal/interview_debrief.py`, `POST /v1/jobs/tracker/{id}/debrief`): the candidate's
  notes from a real round become the questions asked (with their own sense of how each went), what they promised to
  send, what to prepare next, thank-you points and up to two STAR drafts. Facts only from the notes; bracketed prompts
  for missing details; no prediction of the outcome. Nothing is stored: stories go to the existing story bank only on
  "Save to story bank". Shown on each round (when round history is on) or in the job's interview prep.
- **Shortlist skills** (`job_portal/skill_gaps.py`, `GET /v1/jobs/skill-gaps`): across active tracked jobs, which
  skills the postings ask for that the resume and profile show or don't, ranked by how many jobs ask. Deterministic,
  the feed's own matcher, no AI request. Shown on the Tracker once two or more jobs are tracked. "Not shown" is worded as
  not on the resume, never as "you lack it".

## Round four, 21 October 2026: recruiter first look and tailor on save

- **Recruiter first look** (`job_portal/first_look.py`, `POST /v1/jobs/tracker/{id}/first-look`): for one job, where
  its most-asked skills appear in the resume (in the top third a first pass reads, further down, or not at all) with
  the feed's matcher, then an AI first impression and a headline and summary written from the resume's own facts.
  Any number the resume doesn't contain is replaced with a [number] prompt. Nothing is saved. In the job's Resume tab.
- **Tailor on save** (workflow rule, migration `e5b7d9f1a3c6`): each new job saved from Discover queues a tailored
  copy of the search resume in the existing background tailoring queue, with the same limits and credits as queuing by
  hand. It skips quietly when there is no resume, room or credit, and never blocks the save. Inspired by the
  "tailor every application" loops in career-ops and ai-job-search, without auto-submitting anything.

## Round five, 21 October 2026: what's working and the first 90 days

- **What's working** (`job_portal/resume_performance.py`, `GET /v1/jobs/resume-performance`): replies and interviews
  by the resume each application used, traced to its source resume, and tailored copies against general ones. From
  recorded statuses only; groups under 5 applications are marked too few to compare. On the Tracker.
- **First 90 days** (`job_portal/first_ninety.py`, `POST /v1/jobs/tracker/{id}/first-90`): after an offer or a hire,
  goals for the first two weeks and by day 30, 60 and 90 from the job post's responsibilities, people to meet by
  role, questions for the manager and an early win the resume supports. Nothing stored; copy or download. In the
  job's Offer tab. The journey's last step ("Next chapter") now has a tool of its own.

## Round six, 21 October 2026: promises to keep and "Tell me about yourself"

- **Promises to keep** (`job_portal/commitments.py`, table `job_commitments`, migration `f6c8e0a2b4d7`): dated to-dos
  per job for what the candidate told an employer they'd do. Added by hand on the job's Interview tab, or from an
  interview debrief's "You said you would send" list in one click (due the next morning). Open ones due within seven
  days, or overdue, appear on Today until ticked off. The same open promise isn't duplicated. Included in the data
  export; deleted with the job or the account.
- **"Tell me about yourself"** (`job_portal/pitch.py`, `POST /v1/jobs/tracker/{id}/pitch`): 30, 60 and 90 second
  answers for one job from the resume's facts, shaped present, past, future; unproven numbers become [number] prompts.
  On the job's Practice tab, above Saba practice.
