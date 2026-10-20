# F01 / F06 integration slice: Today to the reviewed kit

Status: PARTIAL against the full V6 feature; current slice implemented and fixture verified.

User problem: a candidate should resume pending application review and return to the same opportunity without searching across tools.

Reuse: HomePage/CareerCompanion progress; action queue priority; JobMission/GuidedOpportunity; ApplicationPacket and packetGuidance; existing PacketDetail approval/receipt paths. New functionality: five task destinations, contextual Prepare/My Career, exact application reference in the owned mission read model, job-specific kit link.

Data/API: optional additive mission.application projection (id, status, submission_uncertain, updated_at). No schema migration, new personal data or changed export/delete rules. No writes occur on navigation. Existing source freshness, consent, once-only receipt/billing and stale resume review checks remain authoritative.

States: first-use resume starter, loading skeletons, empty preparation, explicit failed progress retry without a misleading next action, pending review, ambiguous outcome, received/manual statuses, missing/foreign job, unavailable previews. Optional AI never runs on mount. Network failures expose existing retry paths; this is not offline parity.

Concurrency: exact user/listing and explicit tracker link; old API may omit application. Existing auth cache generation and preview version checks retained. No packet mutation or external action added.

UX: 320–1920 widths, light/dark, Motion Off, keyboard More dialog focus return and existing opportunity-step focus/scroll flows. Existing design components/tokens; decorative orbital SVG is aria-hidden and not a readiness indicator. Compact side-panel counts prevent label overlap.

Costs/performance: no new model allowance or package. One fixed indexed projection query; existing bundle budgets retained. See BASELINE.md for measured build and tests.

Tests: owned matching/mismatching application projection and ambiguous state; full existing mission/priority/proxy/resume security regressions; Today → exact kit → same opportunity → history; empty and failed progress recovery; navigation and endpoint isolation; screenshot matrix.

Rollout: no feature flag for backwards-compatible navigation/read projection or preview security fix. Review/merge is required; operator staging setup remains separate. Revert UI/projection without migration; retain preview boundary. Later provenance graphs, new kit editing and broader feature acceptance remain deferred.
