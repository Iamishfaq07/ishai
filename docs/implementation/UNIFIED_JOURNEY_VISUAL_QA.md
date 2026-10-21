# Unified journey visual QA — 2026-10-21

Base `e1426076`; local mock-provider API, real Chromium/React/HTTP, synthetic test accounts. Images are runtime captures, not Figma mockups or production-user data. Historical screenshots elsewhere remain historical.

## Capture manifest

`screenshots/unified/manifest.json` lists each PNG with dimensions, bytes and SHA256.90 PNGs:28 before,56 matrix after,6 additional populated-state proofs.

- Before: `before-{today,career}-{light,dark}-{320,360,390,768,1024,1440,1920}.png`, Motion Off. Initial capture13 pass/1 artifact teardown collision; all28 files exist. No redesigned runtime was relabeled as baseline.
- After: same naming with `after-`, Motion Off; suffix `-full.png` for Full motion.28 matrix cases capture both pages, check no horizontal overflow and run tagged axe checks. These cases are included in the follow-on87-pass browser run.
- Additional: `after-career-reviewed-320.png`, `after-opportunity-saba-390.png`, `after-today-20-opportunities-320.png`, `after-today-css-200-percent.png`. The last is CSS zoom, not certification of actual browser/OS zoom. The first two are from the cross-page reviewed identity journey; the filled320 layout was refined after manual inspection and recaptured separately.

## Manually inspected

Before Today1440/light,320/dark,768/light; My Career320/dark,1440/light,1920/dark. After Today1440/light,320/dark,768/light/Full,1920/dark/Full,1024/dark; My Career320/dark,1440/light,390/dark/Full,360/light/Full; populated My Career320 and Opportunity/Saba390. This is a representative inspection, not a claim that every image, screen or browser state was manually audited.

Visible transformation: repeated home action islands replaced by one next action, owned opportunity list and secondary disclosure; My Career changes from equal-weight tool catalog to selected master/review/goal context; job room replaces guided/expert split with five contextual sections, materials and Saba. Utilities remain reachable. No fake progress, hiring probability or invented history was added.

Confirmed defects repaired: selected opportunity tab contrast3.49 under accent (neutral high-contrast selection now passes); Today320 journey label padding; filled320 resume summary labels breaking midword (stacked rows on narrow widths). Cross-account identity leak was reproduced and repaired; it is a privacy fix, not visual polish.

## Coverage limits

Full/Off, light/dark and seven widths were captured for Today/My Career. Browser suites cover keyboard/route behavior, empty/populated state,20 opportunities, CSS zoom, account switches (including blocked storage), drafts, import/master/job-copy/Saba return, existing billing/business/extension/live/video flows and V6 continuity. Provider-dependent results use mocks; no real speech, camera quality, payment, audio hardware or production behavior is certified.

Remaining: complete all-screen loading/error/offline/responsive matrix, real browser zoom, Gentle/OS-setting-change audit, manual screen reader, meaningful task usability timing, comprehensive WCAG2.2 AA and RUM. Axe passing is not accessibility certification; bundle gates are not Web Vitals. Fixed navigation in full-page captures reflects browser capture behavior; inspect actual viewport interaction when assessing overlap/focus. Production visual sign-off remains partial.

## Follow-on screenshots and inspection

New actual-runtime files: after-session-reviewed-linked-390.png and after-session-unlinked-390.png, copied from the final focused attribution journey. The linked view shows one reviewed practice and explicit Unlink; the unlinked view shows zero and confirms the report is preserved. A first capture caught the shared confirmation exit animation; the test now waits for #orbit-confirm-title to leave the DOM before capture (its accessible role disappears earlier). No image editing, fabricated UI or timed sleep substituted for the actual state.

Both new390px captures were opened and manually inspected. The current root87-pass run refreshed the Today/My Career after matrix; before captures remain the original baseline. Additional populated identity/job/20-opportunity/CSS-zoom proofs were refreshed from that same run. Manifest SHA256/dimensions updated90 files. AXE and no-overflow assertions pass on the linked review state; full manual screen-reader/all-state/real-zoom certification remains outstanding.

Final attribution screenshot proof1 PASS15.9s; actual exiting dialog DOM was absent before capture. Both final copied images were re-opened for review. V6 continuity21 PASS2.4m; these are mocked local runtime checks, not live speech/provider certification.
