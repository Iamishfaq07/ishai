# Design system — "Deep Space"

Shared by the web and desktop apps. Source of truth: `packages/ui/tailwind.preset.ts` and
`packages/ui/src/design/base.css`.

## Two places: the front door and the workbench

- **The front door** (signed-out pages: the front page, the public product pages, sign-in) keeps the sky: the
  animated backdrop, glass, gradient headlines and the Orbit scenes. It's where Orbit introduces itself.
- **The workbench** (everything signed in, `html.app-shell` from the web Layout) is where people run their job search
  every day, so it reads as professional software: one still canvas (`--canvas`, #F5F6F8 / #0D121C), opaque surfaces
  (`--surface`) with a hairline border (`--line`) and no shadow, headings in the product face, and no gradients,
  glows, sheens or decorative blobs. Only things that float (a menu, a dialog, a toast) cast a shadow.
- **One accent, used sparingly**: the main action, links, focus and the page you're on. Everything else is ink. Status
  colours mean status only. Product colours mark a product's own content (its mark, its row on Home), not the nav.
- **Corners say how a thing behaves**: controls 8 px (`rounded-xl`), cards 12 px (`rounded-2xl`), large panels 16 px
  (`rounded-3xl`).
- **Buttons**: primary is the solid accent (white on accent-600 passes AA in every accent), secondary is bordered,
  ghost is plain. Nothing on a button moves except the press.
- **AI is named, not badged**: tools carry their name ("Resume AI", "Jobs AI") in the nav; there is no AI chip per
  item.
- **No new gradients in the app.** A highlighted block (the Windows app, the video interview) is a solid ink panel
  (`bg-zinc-900 text-white`); an icon tile is neutral (`bg-zinc-100 ring-zinc-200`) or the solid accent.

## Colour

Components use plain Tailwind names; the preset maps them to CSS variables (RGB triplets, so `/alpha` works):

| Tailwind name | Variable        | Meaning                                                                 |
| ------------- | --------------- | ----------------------------------------------------------------------- |
| `indigo-*`    | `--accent-*`    | The accent. Default **Nebula**; users can pick another in Settings.     |
| `zinc-*`      | `--ink-*`       | Neutrals: surfaces, borders, secondary text. Cool, slightly violet.     |
| `aurora-*`    | `--aurora-*`    | Cyan. Brand gradients only (logo, hero glows) — never UI state.         |
| `stage-*`     | `--stage-*`     | A job's stage: `saved`, `applied`, `interviewing`, `offer`, `rejected`. |

Status colours stay Tailwind's own (`emerald` live, `amber` warning, `rose` error).
**Stage colours** are fixed (not the accent, so a stage looks the same for everyone and never meets a status colour
that means something else): saved → applied → interviewing is one ordered violet ramp, further along = more ink
(darker in light mode, lighter in dark mode); an offer is the status green; "not this time" a quiet grey. They're
marks only (`STATUS_MARK` in `pages/jobs/model.ts`: the dot in a `StagePill`, a tracker card's edge, the Home pipeline
bar), never text, and always beside the stage's name. Both themes' steps passed the dataviz palette validator
(ordinal, colour-blind separation, contrast); re-run it if you change one.
Contrast: secondary text is remapped in `base.css` so it passes WCAG AA on every surface in both themes, and so are
`text-emerald-600` / `text-amber-600` in light mode (they draw in -700). Small text never takes `opacity-80`; text on
amber is `text-amber-950` (white on amber is 2.1:1). Figures are tabular by default (`tnum`, web), so columns of
numbers line up; a stat's big number (a tile, a ring) takes `stat-value`, the font's proportional figures.

## Charts

One series over time is `ColumnChart` (`components/ColumnChart.tsx`; geometry in `lib/chart.ts`): admin sign-ups
and interview minutes, the tracker's applications a week. Columns at most 24 px wide, 4 px rounded tops, square at the
baseline; one hue (the accent), so the title names it and there is no legend; solid hairline gridlines at the top of
the axis and its half; the busiest column carries its number. Hover, a tap or the arrow keys (Home and End too) show
any column, value first; "Show the numbers" is the same data as a table. While loading, the frame holds, faded. A
part-to-whole is one stacked bar with 2 px gaps between its parts (the Home pipeline), its counts below as legend.
Score rings: the fill says how it went, the track is a pale step of the same colour.

## Type

`font-sans` is **IBM Plex Sans** everywhere: body, numbers (tabular) and, in the workbench, headings too (base.css
maps `h1`–`h3` and `font-display` to it inside `html.app-shell`). Its engineered, institutional shapes read as a
serious tool. `font-display` (Space Grotesk) stays for the front door's headlines; `font-mono` (JetBrains Mono) is
for code only, never for small data labels. Self-hosted via Fontsource (`apps/web/src/fonts.css`, Latin only).

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
- **Calm inside the app**: the signed-in shell (`html.app-shell`, set by the web Layout) hides the starfield, dot
  grid and light orbs, and `glass-panel` / `orbit-card` / `orbit-panel` turn opaque there, so nothing shows through
  text while people work. The cinematic sky is for public pages and empty states.

## Navigation (web)

One definition, `apps/web/src/components/nav.ts`, feeds the desktop sidebar, the phone tab bar and the phone's Explore
sheet (drawn by `components/Layout.tsx`). Addresses never change when the nav does.
- **Desktop sidebar**, grouped by the job to be done: Home; **Prepare** (Practice and Video interview while mock
  interviews are on, Resume AI, Learning AI); **Apply** (Jobs AI, LinkedIn AI); **Interview & offer** (Copilot AI,
  Offer AI). Plan & credits, Settings, Admin (admins only) and Support sit at its foot. Every AI tool carries the AI
  mark at its icon's top right. It collapses to icons; the choice is kept on the device (`orbit.sidebar`), and with
  none it starts collapsed under 1280 px.
- **Top bar**: a wide "Search or jump to…" (Ctrl K, the command palette), a **New** menu (live session, mock
  interview, resume, job search, offer) and the account menu.
- **Phones**: five destinations, Home, Jobs, Resume, Practice (the copilot when mock interviews are off) and
  **Explore**, a sheet with the other tools as cards, then plan, settings, admin, support and sign out.
- **A product's own pages** sit under its item as `ProductTabs` (`components/products.tsx`): Jobs AI's Overview,
  Matches, Tracker and Profile. The tabs hide while a product has only one page. A product opens with a short
  header and one primary action, not a marketing banner.

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
  illustration, `<CountUp to={98} format={…} />` in text (the stat tiles). A new value counts on from the last one;
  a step under 10 isn't counted at all. At Gentle and Off the final number shows at once; screen readers only ever
  get the final number.
- **The workbench's few moments**, each once and each saying what changed: a chart's columns grow up from the
  baseline one after another the first time it's in view, and a stacked bar fills from the left (`.chart`,
  `.chart-bar`, `.chart-fill`; a fade at Gentle); a score ring draws round as its number counts; the sidebar's "you
  are here" bar grows in on arrival (`.nav-mark`); a tracker card that changes stage wears a fading accent ring where
  it lands (`.moved-flash`, opacity only, so Gentle keeps it).
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
- **Loading:** `Skeleton` (`line`, `card`, `job-card`, `resume-card`, `session-row`) with `useLoadPhase(loading)`.
  `LoadGate` is that timing around a list: nothing, then the skeleton, then the list.
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
