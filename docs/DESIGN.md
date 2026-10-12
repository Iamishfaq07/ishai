# Design system — "Deep Space"

Shared by the web and desktop apps. Source of truth: `packages/ui/tailwind.preset.ts` and
`packages/ui/src/design/base.css`.

## Colour

Components use plain Tailwind names; the preset maps them to CSS variables (RGB triplets, so `/alpha` works):

| Tailwind name | Variable        | Meaning                                                                 |
| ------------- | --------------- | ----------------------------------------------------------------------- |
| `indigo-*`    | `--accent-*`    | The accent. Default **Nebula**; users can pick another in Settings.     |
| `zinc-*`      | `--ink-*`       | Neutrals: surfaces, borders, secondary text. Cool, slightly violet.     |
| `aurora-*`    | `--aurora-*`    | Cyan. Brand gradients only (logo, hero glows) — never UI state.         |

Status colours stay Tailwind's own (`emerald` live, `amber` warning, `rose` error).
Contrast: secondary text is remapped in `base.css` so it passes WCAG AA on every surface in both themes, and so are
`text-emerald-600` / `text-amber-600` in light mode (they draw in -700). Small text never takes `opacity-80`; text on
amber is `text-amber-950` (white on amber is 2.1:1). Figures are tabular by default (`tnum`, web).

## Type

`font-display` (Space Grotesk) for headings — applied to `h1`–`h3` globally — `font-sans` (Inter) for body,
`font-mono` (JetBrains Mono) for code. Self-hosted via Fontsource.

## Surfaces

- `glass-panel` — frosted card (the `Card` primitive). In see-through desktop windows it drops its blur and follows
  the window's transparency.
- `Sheet` — the one modal. A sheet from the bottom on a phone, a centred dialog from `sm` up, portaled to `body` so
  the tab bar cannot cover it. `placement="end"` is the full-height panel from the right (an account or a message).
  Focus is trapped, Escape and the backdrop close it, and the page behind does not scroll. A `footer` stays pinned
  while the body scrolls. A confirm sits above it.
- `gradient-border` — 1 px accent → aurora hairline around hero cards.
- `text-gradient` — accent → aurora headline text.
- `SpaceBackdrop` — the animated sky, mounted once per app.

## Navigation (web)

- **Main nav** (`apps/web/src/components/Layout.tsx`): the daily destinations only, the same on the top bar and the
  phone tab bar: Home, Practice, Sessions, Documents, Resume AI, Jobs AI. The AI products show their word and the
  gradient `AiPill` ("Resume", "Jobs"; their links are labelled "Resume AI" and "Jobs AI"). Settings is a gear beside
  the account menu (and in it, with Plan & billing). The top bar drops its icons between 768 and 1023 px; the tab bar
  has a column each and fits a 360 px phone.
- **A product's own pages** sit under its nav item as `ProductTabs` (`components/products.tsx`): Jobs AI's Overview,
  Matches, Tracker and Profile. The tabs hide while a product has only one page (Resume AI today).

## Motion

- **Tokens** (`base.css`, Tailwind `duration-*` / `ease-*`): `press` 100 ms, `quick` 160, `panel` 240, `page` 280,
  `moment` 700 (celebrations only); `ease-standard`, `ease-enter`, `ease-exit`; `--stagger-step` 35 ms. UI motion
  stays under 300 ms. Animate `transform` and `opacity` only; never `transition: all`.
- **Three levels** (Settings → Appearance → Animations: Full / Gentle / Off, `DesignPrefs.motion`), applied as
  `html[data-motion]`. Gentle (`reduced`) keeps fades and drops all movement; Off stops everything. The OS
  reduced-motion setting caps Full at Gentle; a new device starts at Gentle when the OS asks or data saver is on
  (D47).
- **Writing motion:** use `motion-ok:` (Full only) for anything that moves, not `motion-safe:` (which sees only the
  OS). Anything animated from JS (canvas, `element.animate`, rAF) reads `useMotion()`; the `Orb` already does.
  Entrances (`animate-fade-in` / `fade-up` / `scale-in` / `rise`, `stagger`, or `.motion-fade` on your own) become
  fades under Gentle on their own.
- Utilities: `animate-fade-up` (page), `animate-rise` / `animate-fade-out` (panels, toasts), `stagger` (first 6
  children, 35 ms apart), `appear` (an item added later, `@starting-style`), `lift` (hover lift where there is hover,
  press-in on touch), `btn-sheen` (primary buttons, hover devices), `animate-float`, `animate-orbit*`,
  `animate-twinkle`, `animate-drift`, `animate-pulse-ring`, `animate-spark`.
- **Scroll reveal:** `<Reveal>` rises content into place the first time it scrolls into view (`delay` in ms to stagger
  neighbours); `<Reveal stagger>` brings a list's children in one after another instead (cards in a grid). Gentle
  fades only; Off, print and no-JS show everything as is. For public pages and long marketing sections, not for
  the app's working screens.
- **Counting numbers:** `useCountUp(to, start, { from })` (with `useInView()`) for a score or percentage drawn on an
  illustration, `<CountUp to={98} />` in text. At Gentle and Off the final number shows at once; screen readers only
  ever get the final number.
- **Bars stay solid:** the sticky header and the phone tab bar are opaque (no see-through, no backdrop blur: page
  text under the labels made them hard to read, and blur over the animated sky costs too much on a phone).
- `scroll-padding` keeps a focused field clear of the sticky header and the phone tab bar.
- **Page transitions:** same-document View Transitions through `withViewTransition(update, to?)` or React Router's
  `viewTransition={useViewTransitionOk(to)}`: a 160 ms crossfade, and a morph for an element given a
  `view-transition-name` (a job card into its page title). Gentle crossfades only; Off and `/live/*` never start
  one. Leave them off for things done many times a minute or started from the keyboard.

## Feedback and empty screens

- **Toasts:** `toast("Copied")`, or `toast({ message, detail, tone, action: { label: "Undo", onClick } })`; one
  polite live region (`ToastHost`, mounted once in `main.tsx`). Name the action as the button did ("Saved to
  tracker"). Not for errors that need action (`ErrorNote`) or questions (`confirmDialog`).
- **Loading:** `Skeleton` (`line`, `card`, `job-card`, `resume-card`, `session-row`) with `useLoadPhase(loading)`
  (shown after 150 ms, kept at least 300 ms). Buttons keep their label with `loading`. Spinners (`Spinner`, the
  orb) are for small or unknown-shaped waits.
- **Empty states:** `EmptyState` with `kind` `first-use` (with a `GhostPreview` of the filled screen), `no-results`,
  `cleared` or `offline` (`onRetry`). A headline, one line, one imperative action.
- **Success moments:** `celebrate(milestone, { message, action })`, once per device, never in a live session; the
  burst plays at Full motion only.
- **Plain words:** `<Term term="ats">ATS</Term>` (glossary: ats, jd, utr, star, fit-check, tailor) or `tip="…"`.
- **Links that look like buttons:** `buttonClass(variant, size)`, never a copied class string.

## Brand

- `OrbitLogo` / `OrbitWordmark` — the mark (`busy` spins the ring; `animated` twinkles the spark).
- `PlanetHero`, `SpotIllustration`, `PulseRings` — illustrations. `SpotIllustration` is for small spots only.
- **Orbit scenes** (`components/scenes/`, one module each): `WelcomeScene` (a planet with a moon per product),
  `ResumeScene` (a page in orbit with its ATS ring; `score`), `JobsScene` (a constellation of Bengaluru, Pune,
  Hyderabad and remote), `PracticeScene` (a microphone and its scorecard), `TrackerScene` (three ghost columns),
  `NoResultsScene` (a telescope on an empty patch of sky), `OfflineScene` (a dish losing its satellite) and
  `CelebrationScene` (a burst). Line drawings like a star atlas: hairline orbits, paper surfaces and one subject in
  the accent, so they hold in both themes and every accent; `title` makes one an image for screen readers, otherwise
  decorative. One small motion each, at Full only. Pass them to `EmptyState` as `art`. A page gets one gradient
  headline and one glow at most; secondary cards stay flat.
- Icons: lucide only, re-exported from `packages/ui/src/icons.ts`.
- Static copies of the mark: `apps/*/public/favicon.svg`, web `apple-touch-icon.png` / `icon-*.png`,
  desktop `src-tauri/icons/*` (regenerate with `pnpm --filter @orbit/desktop exec tauri icon <1024px png>`).
