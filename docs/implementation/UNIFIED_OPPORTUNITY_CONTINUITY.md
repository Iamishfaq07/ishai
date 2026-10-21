# Opportunity Room: navigation, review and draft continuity

2026-10-21. Basebb66a5c2 (owner-merged PR449). IMPLEMENTED / UNVERIFIED. No testing.

## Candidate outcome

The existing Opportunity Room now exposes its local sections directly: Overview → Requirements/Company, Application → Resume/History, Prepare with Saba → Practice/Plan, Interviews, Offer. One generic eight-tool select is removed; every existing tool/deep link remains reachable. Re-selecting the current main section preserves its current subsection. URL tab remains the only selected-panel authority; no second expert mode or persistent panel cache.

A switcher uses the existing owned tracker list, keeps the current tool when moving to another opportunity, and drops job-specific snapshot/workshop/source query parameters so they cannot follow the wrong job. It does not send raw job text or resume contents. Back/forward remain ordinary router query/path navigation. No new primary tab.

Application materials can open the existing PacketDetail lazily inside the room, including its current answers, resume/cover letter, confirmation evidence and review/action controls. It keeps the existing global application route as a secondary link. Packet UI is reused, not copied or replaced; existing auth, quota, review/approval, submission uncertainty, receipts and revocation semantics remain authoritative. Opening the panel only reads stored data; AI review and sending still require their existing deliberate actions.

The packet is obtained from the existing mission projection, which allows an owned matching listing when packet.application_id is null or matches this room. This is preparation/navigation context, not a newly persisted artifact association or delivery proof. Embedded detail checks its owned tracker projection against the expected opportunity before rendering actions/evidence; mismatch asks for refresh. This is client defense in depth, not a replacement for server ownership checks or an atomic job-context constraint on mutations. Existing mutation routes still authorize the owned packet, not a newly introduced room token. The full view remains valid without an expected-room prop.

## Continuity and state safety

- Room briefing labels the linked editable resume separately from the count of saved copies; no false claim that this is the chosen interview snapshot or employer-delivered version. Recorded next date, material review, Saba and history are contextual actions.
- Resume, offer, preparation, practice, company, real-interview and timeline components are keyed by opportunity. Each mutable UI gets its own lifecycle when switching jobs.
- Mission results render only when entry_id matches the current owned tracker record. A per-visit identity/active guard ignores late save responses after leaving a room, including A→B→A and unmount. Existing account-generation guards remain authoritative across auth changes.
- Resume-version note input uses existing bounded account/job tab-memory (one-hour retention, at most ten drafts, account-change clear, close-tab discard). No localStorage/server autosave or restored consent. Input is disabled while saving; a late save from an unmounted editor does not clear a new visit's draft. A save that finishes after navigation can still have succeeded on the server; revisit/refresh source records, never infer failure or retry submission automatically.
- The embedded packet stays mounted but hidden after first opening when changing local sections; draft form input is not destroyed simply by switching sections. Leaving the room/account resets it; packet-answer fields are not newly persisted. Existing review revision/fingerprint guards still apply. Do not describe this as full offline draft persistence.
- No new source/profile/round/offer status, schema, event, approval or automatic send. Room state does not fabricate progress or change master resumes.

## Design and accessibility intent

Uses the merged paper/graphite/Slate blue system. Main room and contextual subnavigation wrap rather than forcing horizontal swipe. Native buttons retain keyboard focus styling and aria-current/aria-controls. Existing guided heading focus/scroll behavior remains. On mobile the current source next action and briefing precede the active panel; wide layouts retain the secondary rail. No new animation, nested page scroll, dependency or extra LLM request.

No viewport/contrast/accessibility/browser check or screenshot was run. Existing images do not prove this layout. Full specialist layout and broader V6 work remain open.

## Source findings / later reproduction

Source-confirmed navigation gap: JobMission hid Company, Plan and Timeline in a generic select despite canonical sections. Later verify every old tab= alias and each contextual button.

Source-confirmed continuity gap: ResumePanel note was transient useState and save callbacks had no per-room-visit guard. Later verify A/B with delayed save, return A, note retention, changed account, resume409 and successful save. Current fixes are source edits, not a runtime pass.

Already connected: PacketDetail has existing job workspace/preparation return links from owned tracker projection. We reuse those and embed it, rather than adding another arbitrary return URL or profile cache.

## Delivery and release

Owner explicitly says NO TESTING. No tests, lint, typechecks, builds, browser/screenshot/contrast/provider/native checks or migrations executed. Source reads/edits and Git/PR operations only. No tests/CI configuration weakened or skip markers/reruns requested. Existing billing/dependency/operator gates remain separate.

No migration, new dependency, provider credentials, background AI cost or production deployment. Roll back by reverting this UI slice; no data migration/cleanup. Existing routes/query aliases and full packet view stay available.

Deferred acceptance when authorized: all eight tool aliases, section reselect/back/forward, fresh/deleted/foreign jobs, account switch, A/B/A delayed saves, retained/reset drafts, packet expected-job mismatch, packet approval/retry/uncertain/manual apply states, lazy provider call boundaries, hidden form lifecycle, 320→1920/light/dark/motion/zoom/keyboard/screenshots and full integration gates. Production NO-GO. Open draft PR for review, do not merge/deploy automatically. This completes a bounded room-navigation/review slice, not the whole V6 programme.
