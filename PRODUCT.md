# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The same React app also ships as a Windows desktop app in `apps/desktop` and a browser extension in `apps/extension`; they share `packages/ui` and the web design language.)

## Users

Job seekers everywhere, at any experience level: students and freshers, early- and mid-career people, and anyone switching roles. India is the first and deepest market (campus placements, CTC, notice periods, PF and Form 16 are built in), but the product is for a global audience. Users run a long, stressful search across many places at once: job boards, company career pages, campus drives, referrals and recruiters. Many use a phone for most of it.

A second audience, companies hiring through Orbit for Business (`/business/app`), exists; it is out of scope for this record unless stated.

## Product Purpose

Orbit is one coach for the whole job search: find jobs, apply, prepare, interview and negotiate in one place. Success is a person who gets interviews and a good offer with less stress, and who always knows the next useful step for each opportunity.

## Positioning

Every job carries its own context (the resume sent, the requirements, practice, interview rounds, contacts, the offer) and its next step, instead of the search being split across a job board, a resume builder, a tracker and an interview app. Orbit is honest by construction: it never invents facts, numbers or qualifications, and nothing is submitted or sent without the user's approval.

## Operating Context

- **Daily loop:** Today shows the next step; Jobs finds and tracks opportunities; each job has its own page (currently "Mission room") through resume, practice, interview and offer; Prepare holds practice (mock interviews with voice, aptitude, group discussion, STAR checks, coding); My Career holds the user's materials (resume, stories, LinkedIn, contacts, offers).
- **Live:** Copilot assists during a real interview session, with the user's permission.
- **Automation:** review-first auto-apply prepares applications; the user approves before anything is sent.
- **Devices:** phones (often mid-range Android on patchy networks) and laptops; light and dark themes.

## Capabilities and Constraints

- Stack: React 18, Vite, Tailwind 3.4, react-router; shared components and tokens in `packages/ui`; FastAPI backend in `apps/api`. No framework migration.
- Feature set is broad (about 30 tools); routes and addresses must keep working when navigation changes.
- AI features cost credits; free and paid plans exist (`/billing`).
- Region-aware copy: India-specific terms appear for Indian accounts, neutral terms elsewhere.
- Undecided: whether the Orbit name and the current orbit mark stay through the redesign (not confirmed as binding).

## Brand Commitments

- **Truth and consent:** no invented facts, metrics, testimonials or qualifications; nothing is submitted or sent without the user's approval; AI produces drafts the user reviews.
- **Privacy and no stealth:** keep data minimal and say where it lives; no anti-proctoring or stealth features; candidates never see server, setup or admin errors.

## Evidence on Hand

- Real product screens of every signed-in surface (render locally; critique captures from 2026-10-22 under `apps/web/.impeccable/critique/`).
- No customer testimonials, logos, press, hiring statistics or outcome claims exist. Future work must not invent them.

## Product Principles

1. **The next step first.** Every screen answers "what should I do now?" before showing anything else.
2. **One job, one place.** Material, practice and decisions stay attached to the opportunity they belong to.
3. **Encourage before measuring.** Show numbers only when they are meaningful; never shame an early search.
4. **Honest by construction.** The user's facts, the user's approval, the user's data.
5. **Works on the phone in your hand.** A mid-range phone on a patchy network is the baseline, not the edge case.

## Accessibility & Inclusion

WCAG 2.2 AA in light and dark themes; touch targets of at least 44 px; usable on mid-range Android over slow or unstable connections; respects reduced-motion preferences (the app's Full / Gentle / Off motion setting).
