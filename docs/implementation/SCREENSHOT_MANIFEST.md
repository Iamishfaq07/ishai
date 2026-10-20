# V6 screenshots

Synthetic fixture accounts only. Before images are the old default Home at base9c39e601; after images are the implemented Today/My Career. These are intentional review captures, not an automatically approved pixel regression baseline.

## Review samples checked visually

- [after-career-1440.png](screenshots/after-career-1440.png) — 97678 bytes; SHA256 `2510030cf4d1e028c4dac6de086deaba99af4fc5fdab246bf9e3529e756c2add`.
- [after-career-320.png](screenshots/after-career-320.png) — 83215 bytes; SHA256 `d0801d353d2b78ba925a7274bf17e4bf2bc30c6a950e5f751a44219e20a53d2e`.
- [after-today-1440.png](screenshots/after-today-1440.png) — 120184 bytes; SHA256 `6640ff4323aa508f7543ba7c7e6b2095607f77c9e1f69ae0adee7ab389350136`.
- [after-today-320.png](screenshots/after-today-320.png) — 96391 bytes; SHA256 `f87d63336b8d6298291a418b572cdd96166b651fdb8741a0068cc947ade54bbd`.
- [after-today-empty-dark-1440.png](screenshots/after-today-empty-dark-1440.png) — 121676 bytes; SHA256 `4ba19336c7729c19d5943a1bb3ea1a14dd68e7185d234ee929885af04a95aabd`.
- [after-today-empty-light-320.png](screenshots/after-today-empty-light-320.png) — 95625 bytes; SHA256 `bf6bdbd2e913799988be010ba885a0243c8a715306e6743b51d4d65f255dd5b4`.
- [before-today-1440.png](screenshots/before-today-1440.png) — 169273 bytes; SHA256 `1b75f36135371e7c58911d8c215fffe442fc65ee7c6aa2a05a8ecfc9c8659979`.
- [before-today-320.png](screenshots/before-today-320.png) — 145542 bytes; SHA256 `e10d083662e7b183e2a771a23799dafa86f84df27fd6a9fb86dcfc09502acd4d`.

## Full generated matrix

`tools/e2e/personal-orbit-v6.e2e.ts` captures empty Today at320,360,390,768,1024,1280,1440,1920, both light/dark, explicit Motion Off and OS reduced motion. Also captures returning Today/My Career at320/1440. Latest complete files are in the local TEMP orbit-v6-journey-final output; the smaller committed selection above is for PR review. Reproduce with the command in BASELINE.md and Playwright --output of your choice.

Earlier `ORBIT_V6_BEFORE=1` capture mode ran before changing Home and saved the two committed before images. It is for capturing an actual base checkout; do not run it on the new Today and relabel the result as old Home.

Checks: no horizontal overflow; Axe and label-in-name; More dialog focus restoration; opportunity-step scroll below sticky header; narrow sidebar pipeline uses two columns to avoid overlapping Interviewing/Offer labels. The primary next step is a visible button. No animations run with Motion Off.

Playwright full-page captures place fixed phone navigation/support at the viewport position within the tall image. That does not mean the fixed bar occurs halfway down the live scrollable document. Live viewport/focus/overflow assertions run separately. Physical devices, manual screenreader traversal, comfortable/compact variants and every business/admin view are not certified by this matrix.
