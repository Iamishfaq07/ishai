# Orbit UX and feature roadmap

What shipped, what already existed, and what is proposed, kept apart. Proposed items are not built until a slice
meets the definition of done in the master prompt (API with authorization, migration, UI states, export and deletion,
tests, a default-off flag, truthful copy).

## Shipped in this round (14 Oct 2026)

| Item | Where | Flag |
|---|---|---|
| Delete your own support chat (bin icon) | `SupportChat.tsx`, `DELETE /v1/support/threads/{id}` | none (privacy control) |
| Payment states: "Confirming with Razorpay", "Refunded ₹N", auto-refresh while confirming | `Billing.tsx` | none |
| Admin: Razorpay watch line and "Check with Razorpay now" | `AdminPayments.tsx` | none |
| Resume conflict choice ("Load the latest" / "Keep mine") and unsaved-draft restore | `ResumeEditor.tsx` | none (data safety) |
| Truthful payment copy (no "the moment it goes through"; no foreign-card promise before approval) | Landing, Billing, Help | `ORBIT_RAZORPAY_INTERNATIONAL` |

## Shipped 15 Oct 2026 (Phases 6 and 8)

| Item | Where |
|---|---|
| Explainable fit: requirement by requirement (met / partly / unclear / missing) with the post's words and the resume line, both checked to be real quotes (roadmap F6) | `job_portal/fit.py`, `JobCard.tsx` FitPanel |
| Company loop memory and story guard: earlier rounds' questions and stories told, shown before a round and given to live answers | `sessions/loop_memory.py`, `LoopMemoryNote.tsx` |
| Screen-share visibility test in Session Setup | `ShareMirror.tsx` |
| Dry-run trace and five edge cases on coding answers | `answer_format.py` TRACE, `AnswerCard.tsx` |
| Screening answers in the outreach kit | `resumes/kit.py` kind `screening` |
| Counter-offer email after salary practice | `sessions/report.py`, `CounterOfferEmail.tsx` |
| Technical details page with live 7-day latency (public aggregates only) | `/technical`, `telemetry.py` |
| Smart 404, contact diagnostics, admin route guard test, cache savings gauge | see PR #292 |

## Already in Orbit (don't rebuild)

Story bank (STAR), saved answers (answer bank), mock interviews with company styles and presets, warm-up, practice
queue and progress, ATS score with fixes, AI rewrite / tailor / cover letter, Word and PDF, job feed (worldwide),
fit checks, tracker, follow-ups, outreach and people, job safety card, country-aware copy, motion preference
(Full / Gentle / Off via `data-motion`), command palette, help sheet.

## Proposed, in order (not started)

1. **Career Evidence Vault (F1).** Extend the story bank into evidence items (claim, source, verified by user / from
   document / AI suggestion needing review), reused by resume suggestions, fit checks and interview answers. First
   slice: evidence chips on resume bullets that come from a story. Needs a model, migration, export/delete, flag.
2. ~~**Career journey timeline (F2).**~~ Shipped 15 Oct 2026: "Journey" on each tracker card (`job_portal/timeline.py`).
3. ~~**Interview replay lab (F3).**~~ Shipped: the session review already gave each question what was said, feedback, a stronger answer, retry and the practice queue; 15 Oct 2026 added what was missed, the rubric dimensions and an "In your practice queue" badge.
4. ~~**Explainable fit (F6).**~~ Shipped 15 Oct 2026 (above).
5. **Opportunity provenance (F5).** Source, first-seen and last-seen dates, duplicate fingerprint on job cards; never a
   "verified" claim without a verification source.
6. **Adaptive panel practice (F4).** Multi-persona mock as a practice mode; bounded tokens; text-only fallback.

Later only: F7 application helper (consent, no auto-submit), F9 experiments, F10 multilingual practice. (F8
negotiation rehearsal exists: the salary practice preset, now with a counter-offer email.)

## UX / design work proposed (Phase 5, not started)

Page-by-page visual QA with screenshots at 320 / 390 / 768 / 1024 / 1440 px in both themes; dashboard as "mission
control" from real data only; interview two-source audio status; resume diff-before-apply; job comparison drawer.
Performance budgets (LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms) to be measured before and after, not assumed.
