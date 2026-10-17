# Design system — "Deep Space"

Shared by the web and desktop apps. Source of truth: `packages/ui/tailwind.preset.ts` and
`packages/ui/src/design/base.css`.

## Two places: the front door and the workbench

- **The front door** (signed-out pages: the front page, the public product pages, sign-in and sign-up, Contact, the
  warm-up, How Orbit works, the 404, and any new public page) is enterprise and product-led (D66): a white canvas
  (`html.site`), a strict grid, IBM Plex Sans headings, one accent, real screens of the app as its pictures, and
  restrained motion. No sky, no glass, no glows, no gradient headlines. Its rules are "The front door" below.
- **The workbench** (everything signed in: `html.app-shell`, set by the web Layout and by the live session page) is
  where people run their job search every day, so it reads as professional software: one still canvas (`--canvas`,
  #F5F6F8 / #0D121C), opaque surfaces (`--surface`) with a hairline border (`--line`) and no shadow, headings in the
  product face, and no gradients, glows, sheens or decorative blobs. Only things that float (a menu, a dialog, a
  toast) cast a shadow. The live session (`/live/:id`) is the workbench too: no sky behind the panel, no glow around
  it.
- **Dark mode is the light theme's twin** (D58): inside the workbench the ink's darkest steps are the same blue-grey
  family as the canvas: `zinc-950` (what `dark:` pairs with `bg-white`: the bars, fields, dialogs, the live panel) is
  the surface, `zinc-900` a raised step above it, `zinc-800` the line. The front door's dark mode is the same family
  (D66).
- **One accent, used sparingly**: the main action, links, focus and the page you're on. Everything else is ink: a
  heading's icon, an icon tile, a label, a loading placeholder. Status colours mean status only. Product colours mark a
  product's own content (its mark, its row on Home), not the nav.
- **Corners say how a thing behaves**: controls 8 px (`rounded-xl`), cards 12 px (`rounded-2xl`), large panels 16 px
  (`rounded-3xl`).
- **Buttons**: primary is the solid accent (white on accent-600 passes AA in every accent), secondary is bordered,
  ghost is plain, danger is rose-700 text, destructive is solid rose (inside a confirm), link is inline text. Nothing
  on a button moves except the press, and buttons cast no shadow.
- **Fields and buttons are one height**: a text field, a select and a regular button are all 38 px (every button
  variant carries a 1 px border, transparent unless it's bordered), so a field and its button line up in a row.
  `sm` buttons are for dense rows and cards, not beside a field.
- **Cards that are links** darken their border on hover (`Card interactive`, or `lift`, which the workbench keeps
  still); they don't rise.
- **AI is named, not badged**: tools carry their name ("Resume AI", "Jobs AI") in the nav and in text; there is no AI
  chip in the workbench (the front door's product pages keep theirs).
- **Labels are sentence case**: small labels, eyebrows and table headings are `text-xs font-medium` ink, never
  tracked capitals (`uppercase tracking-*`). The resume templates keep their own type.
- **No new gradients in the app.** A highlighted block (the Windows app, the video interview) is a solid ink panel
  (`bg-zinc-900 text-white`); an icon tile is neutral (`IconTile`, `bg-zinc-100 ring-zinc-200`) or the solid accent.

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
serious tool. The front door uses it for every heading too (`html.site`); Space Grotesk lives on only inside the logo's
wordmark, outlined (`BrandLogo`), so no page loads it for text. `font-mono` (JetBrains Mono) is
for code only, never for small data labels. Self-hosted via Fontsource (`apps/web/src/fonts.css`, Latin only).

## Surfaces

- `glass-panel` — frosted card (the `Card` primitive). In see-through desktop windows it drops its blur and follows
  the window's transparency.
- `Sheet` (also exported as `Dialog`) — the one modal. A sheet that rises from the bottom on a phone, a centred dialog
  that fades in from a touch smaller from `sm` up (sizes `sm`–`2xl`), portaled to `body` so the tab bar cannot cover
  it. `placement="end"` is the full-height panel from the right (an account or a message). Focus moves in, is
  trapped, and returns on close; Escape and the backdrop close it, and the page behind does not scroll. A `footer`
  (use `DialogActions`) stays pinned while the body scrolls. A confirm sits above it.
- `gradient-border` — 1 px accent → aurora hairline around hero cards.
- `text-gradient` — accent → aurora headline text.
- `SpaceBackdrop` — the animated sky, mounted once per app.
- **Calm inside the app**: the signed-in shell (`html.app-shell`, set by the web Layout) hides the starfield, dot
  grid and light orbs, and `glass-panel` / `orbit-card` / `orbit-panel` turn opaque there, so nothing shows through
  text while people work. The front door (`html.site`) hides the sky too; it remains only behind screens that set
  neither scope.

## Components (the inventory)

One system, in `packages/ui` (shared with the desktop app), exported from `@orbit/ui`. Use these before writing a
class string; `/dev/components` (development builds) shows each in its states, in both themes. D58 says why.

**Tokens**
- Radius: controls 8 px (`rounded-xl`), cards 12 px (`rounded-2xl`), large panels 16 px (`rounded-3xl`).
- Height: `sm` 30 px, `md` 38 px (fields and regular buttons), `lg` 46 px.
- Spacing: page sections `space-y-6`/`8`; a card's padding `p-5` (`p-4` dense); a page head `mb-6`; gaps 2/3/4.
- Elevation, floating things only, lowest to highest: `shadow-menu` (menus) < `shadow-popover` (popovers, tooltips,
  sticky action bars) < `shadow-dialog` (dialogs, side panels, the command palette) < `shadow-toast`; each with a
  hairline border, and its own dark value. Z order: `z-bar` 20 < `z-sidebar` 30 < `z-menu`/`z-popover` 40 <
  `z-dialog` 50 < `z-confirm` 60 < `z-toast` 70.
- Motion: `duration-press/quick/panel/page` (100/160/240/280 ms), `ease-standard/enter/exit`; overlay entrances
  `animate-dialog-in`, `animate-sheet-up`, `animate-menu-in`, `animate-panel-in`; the `.indicator` slide. Gentle turns
  each into a fade, Off into nothing.

**Actions**
- `Button` — `primary` (one per view), `secondary`, `ghost`, `danger` (quiet rose: a Delete that asks first),
  `destructive` (solid rose: the button that deletes, inside a confirm), `link`. `loading` swaps the label for a
  spinner at the same width (aria-busy); `aria-pressed` styles a toggle; `block` is full width on phones.
- `IconButton` (icon only, named by `label`, which is also its tooltip), `ButtonGroup`, `MenuButton`, `SplitButton`,
  `buttonClass(variant, size)` for links that look like buttons.

**Overlays**
- `Dialog`/`Sheet` + `DialogActions` (the way out first, the main action last; stacked, main on top, on phones).
- `confirmDialog({ title, body, confirmLabel, danger, typeToConfirm })` — `danger` uses the destructive button;
  `typeToConfirm` ("DELETE") for what can't be undone (an account).
- `MenuButton` / hand-built menus with `useDismiss`, `menuKeys`, `floatingClass`, `menuItemClass` (arrows, Home/End,
  first letters, Escape back to the button, a press outside closes). `Popover` for small forms and filters.
- `Tooltip` — on hover after 400 ms and on focus at once, aria-describedby, Escape hides. It only repeats or adds:
  never put information people need only in a tooltip (phones can't hover).
- `toast()` — `neutral`/`info`, `success`, `warning`, `error`; one action (Undo); stacks three; polite live region;
  above dialogs. `Callout` — inline banners: `info` (ink), `success`, `warning`, `error` (announced); optional title,
  action, dismiss. `ErrorNote` is the error callout with Retry.

**Forms**
- `Field` (label; `required` marker; `hint`; `error`, wired with aria-describedby and aria-invalid; `counter`, amber in
  the last tenth), `Input`, `Textarea`, `Select` (date fields are `Input type="date"`), `SearchInput`, `Checkbox`,
  `RadioGroup`, `Toggle` (a switch), `Slider`, `SegmentedControl` (a few exclusive options; a radio group with a
  sliding indicator), `Dropzone`.
- Errors say what to do ("Add a company name"), appear when the person leaves the field or submits, never while
  they type.

**Data**
- `Table`, `THead`, `Th` (sortable: `sort` + `onSort`, aria-sort, the direction's arrow), `Tr` (hover, `selected`),
  `Td` (`label` for the phone's card view with `stack`, `primary` for the row's title, `align="right"` for figures),
  `TableEmpty`, `TableLoading`. Wide tables scroll inside their card, never the page.
- `StatTile`, `Badge` (status only, always in words: `success`, `warning`, `danger`, `info`, `accent`, `neutral`),
  `Avatar` (initials, never photos), `ProgressBar`, `Stepper`, `Pagination`, `Breadcrumbs`, `Kbd`, `IconTile`.
- `Tabs` + `TabPanel` (a sliding underline, arrow keys; only the chosen panel is in the page), or `tabClass` /
  `tabListClass` for a tab list that manages itself. `ProductTabs` for a product's own pages (links).
- `PageHeader` (title, a line, actions, `back`, `art`: a product page's scene), `BackLink`, `Card`, `EmptyState` /
  `CosmicEmptyState` / `SceneArt`, `WorkingState` (an AI wait), `Skeleton`.

**Do / don't**
- Do reuse a primitive; extend it (a prop, a variant) rather than copying its classes. Don't hand-roll a button,
  badge, table header or menu.
- Do give every icon-only control a name (`IconButton label`). Don't show colour without words.
- Do use `shadow-*` tokens for things that float, and nothing else. Don't put a shadow, a gradient or a glow on a
  card.
- Do prefer Undo (a toast's action) to a confirm where the code can restore what was removed; keep the confirm for
  what can't come back.
- Do keep a phone's main action in thumb reach (`block`, `DialogActions`, the sheet's footer).

## Navigation (web)

One definition, `apps/web/src/components/nav.ts`, feeds the desktop sidebar, the phone tab bar and the phone's Explore
sheet (drawn by `components/Layout.tsx`). Addresses never change when the nav does.
- **Desktop sidebar**, grouped by the job to be done: Home; **Prepare** (Practice and Video interview while mock
  interviews are on, Resume AI, Learning AI); **Apply** (Jobs AI, LinkedIn AI); **Interview & offer** (Copilot AI,
  Offer AI). Plan & credits, Settings, Admin (admins only) and Support sit at its foot. Each tool is named in full
  ("Resume AI"), one ink icon each, no AI mark. It collapses to icons; the choice is kept on the device (`orbit.sidebar`), and with
  none it starts collapsed under 1280 px.
- **Top bar**: a wide "Search or jump to…" (Ctrl K, the command palette), a **New** menu (live session, mock
  interview, resume, job search, offer) and the account menu.
- **Phones**: five destinations, Home, Jobs, Resume, Practice (the copilot when mock interviews are off) and
  **Explore**, a sheet with the other tools as cards, then plan, settings, admin, support and sign out. The support
  button keeps the bottom-right corner above the tab bar; a page's own floating button (Resume AI's Preview) sits
  centred, clear of it.
- **A product's own pages** sit under its item as `ProductTabs` (`components/products.tsx`): Jobs AI's Overview,
  Matches, Tracker and Profile. The tabs hide while a product has only one page. A product opens with a short
  header and one primary action, not a marketing banner.
- **Page header** (`PageHeader`): the title, one line under it, and the page's actions at the row's end, beside
  the title while there's room (a long line wraps under the title rather than pushing the actions down). A detail
  page puts its way back above the title (`back={<BackLink to=… >All offers</BackLink>}`). The icon tile shows from
  `sm` up, so a phone's title gets the width; a long title wraps, it isn't cut to one line. Actions are regular size.

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
  press-in on touch; the workbench keeps it still and darkens the border instead), `btn-sheen` (primary buttons, hover devices), `animate-float`, `animate-orbit*`,
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
  it lands (`.moved-flash`, opacity only, so Gentle keeps it); a scene plays its one touch the first time it's in
  view (see "Scenes").
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
  (shown after 150 ms, kept at least 300 ms). A `loading` button keeps its name and width (a spinner takes the
  label's place; no "Saving…" swap needed). Spinners (`Spinner`, the
  orb) are for small or unknown-shaped waits. In the workbench a placeholder is an ink tint, not the accent.
- **AI waits over two seconds** (reading a resume, writing a letter or a review, matching jobs): `WorkingState`
  (`label`, `kind` `reading` / `writing` / `matching`; `compact` side by side, for a panel), the AI-working scene over
  the same words, in place of a big spinner. A button's own "Reading…" label stays as it is.
- **Empty states:** `EmptyState` with `kind` `first-use` (with a `GhostPreview` of the filled screen), `no-results`,
  `cleared` or `offline` (`onRetry`). A headline, one line, one imperative action. Its art is an Orbit scene
  (`CosmicEmptyState variant=…`, see "Scenes") or an `icon` in a `SpotIllustration`, which the workbench draws flat:
  a hairline orbit, a solid accent planet, a small moon, no halo.
- **Success moments:** `celebrate(milestone, { message, action })`, once per device, never in a live session; the
  burst plays at Full motion only. Wired: the first offer (added in Offer AI, or a job moved to offer on the
  tracker) and the first edit that takes a resume's ATS score past 80. Home's "You're set up" shows the celebration
  scene, its sparks bursting only the first time on a device (`CelebrationScene still`).

## Scenes

The feature pictures (D68): hand-drawn SVG line drawings in `packages/ui/src/components/scenes/`, one module each,
shared pieces in `parts.tsx`. Offer AI's letter and balance is the reference.

**Style.** A 240 × 160 frame. Thin ink strokes (`LINE`), paper surfaces (`PAPER`: white, or ink-900 in dark), text
as bars (`BAR`), and **one** subject in the accent (`ACCENT`, `ACCENT_SOFT`); a few faint stars. Flat: no gradients,
glows, shadows, filters or images, and nothing that needs its own dark version: the classes carry both themes and
every accent. Status colours only where they mean status (Practice's scorecard). People are a badge (`Person`: a disc,
a head, shoulders), never a face or a likeness; no real names, companies or brands. Decorative (`aria-hidden`)
unless given a `title`. Under 3 KB of source each (WorkingScene holds three kinds in 3.4 KB).

**Where they go.** At most one scene in a view, and never in a dense table or form.
- An empty state's art: `CosmicEmptyState variant=…`; on its own, `SceneArt` (sized by its class).
- A product's main page with no empty state to carry one: `PageHeader art={<CodeScene />}`, at the row's end from
  `lg` up, 144 px, overhanging the row instead of making it taller.
- An AI wait over two seconds: `WorkingState`. An onboarding step or Home's next step: the scene of what it's about.
- A width in `className` (`w-24`, `sm:w-40`) sizes a scene; otherwise it fills its box up to 15rem.

| Scene | Variant | Shows | Used on |
| --- | --- | --- | --- |
| `OfferScene` | `offers` | a letter with its seal; a balance that settles | Offer AI |
| `CopilotScene` (`quiet`) | `copilot`, `quiet` | a headset, its waveform, the transcript | Copilot sessions, Home's next step, desktop Home and History; a review with nothing captured |
| `PracticeScene` | `practice` | a microphone and its scorecard, ticks drawing in | Practice, Home's next step, a session before its review |
| `ResumeScene` | `resume` | a page in orbit and its ATS ring | Resume AI, Home's next step |
| `TrackerScene` | `tracker` | three columns, a card sliding into the last | the tracker, Home's next step |
| `JobsScene` | `jobs` | a constellation of openings | (spare: its labels are Indian cities) |
| `StoriesScene`, `AnswersScene`, `EvidenceScene`, `DocumentsScene` | same names | a STAR book, a kept answer, a quote under a shield, a fanned stack | the story bank, answers, evidence, documents (web and desktop) |
| `LinkedInScene` | `linkedin` | a profile card, its headline rewritten, the search that finds it | LinkedIn AI's header |
| `CodeScene` | `code` | a code window, a blinking cursor, tests ticking | Code AI's header |
| `LearningScene` | `learning` | a path of lessons, the one you're on | Learning AI's header |
| `VideoScene` | `video` | a call with the interviewer, her question, her voice | the video interview's header |
| `BillingScene` | `billing` | a receipt, paid, and a credit landing | Plan & billing's header, admin payments |
| `SecurityScene` | `security` | a shield closing with a tick, a key, a six-digit code | two-step sign-in while it's off |
| `ReferralScene` | `people` | two people and the link between them | People (Jobs AI outreach) |
| `InboxScene` | `inbox` | a letter into the tray, a chat waiting | admin inbox and support |
| `InterviewDayScene` | `interview-day` | a calendar with the day ringed, its checklist | (for the interview-day screens) |
| `NoResultsScene`, `OfflineScene` | `no-results`, `offline` | a telescope on empty sky; a dish losing its satellite | no matches; a job, offer or problem not found; boards down |
| `WelcomeScene` | `support` | Orbit with a moon per product | the first welcome question |
| `CelebrationScene` (`still`) | `success` | a ticked world, sparks thrown out | "You're set up" |
| `WorkingScene` (`kind`) | — | reading (a band scans a page), writing (lines write in), matching (signals pass) | `WorkingState`: Jobs AI's matching, Resume AI's prep, letter and AI panel, outreach writing, a resume import, a review being written |

**Motion** (base.css, "Every scene's one touch"). The first time a scene is in view (`Scene` sets `data-shown`), its
parts play one small touch and rest on the final frame, done within about a second: strokes draw on (`DRAW`, with
`pathLength={1}`), parts fade (`FADE`), come in from a few px (`IN`, `at(ms, { x, y })`), grow from their centre
(`POP`) or swing and settle round a pivot (`SETTLE`, `at(ms, { o })`); `at(ms)` staggers them 100–250 ms apart. Small
finite touches: a cursor blinks five times, a waveform pulses three, a ripple rings twice, the stars drift a hair
twice. A part marked `NUDGE` lifts 3 px while the scene, or the empty state or header around it (`.scene-host`), is
hovered. Only the AI-working scene loops (`scene-scan`, `scene-write`, `scene-travel`, `scene-breathe`), calmly and
only for as long as the wait lasts.
- **Full:** as drawn. **Gentle** (and the OS asking for less motion): the same parts only fade in, staggered;
  nothing loops. **Off**, print and no JavaScript: the final frame from the start (the hidden "before" state exists
  only in CSS, behind `data-motion`).
- Only `opacity`, `transform` and `stroke-dashoffset` animate, inside an SVG of fixed size: nothing around a scene
  moves. One motion class per element, never on an element with its own `transform` attribute (wrap it in a `<g>`).
  `scenes.test.ts` checks these rules.
- **Plain words:** `<Term term="ats">ATS</Term>` (glossary: ats, jd, utr, star, fit-check, tailor) or `tip="…"`.
- **Links that look like buttons:** `buttonClass(variant, size)`, never a copied class string.

## Brand

- `OrbitLogo` / `OrbitWordmark` — the mark (`busy` spins the ring; `animated` twinkles the spark).
- `PlanetHero`, `SpotIllustration`, `PulseRings` — illustrations. `SpotIllustration` is for small spots only.
- **Orbit scenes**: the feature pictures, one per product and moment; see "Scenes" above for the set, the style, where
  they go and how they move. A page gets one gradient headline and one glow at most; secondary cards stay flat.
- Icons: lucide only, re-exported from `packages/ui/src/icons.ts`.
- Static copies of the mark: `apps/*/public/favicon.svg`, web `apple-touch-icon.png` / `icon-*.png` /
  `icon-maskable-512.png` (all from `marketing/brand/render-icons.mjs`: the mark on a flat ink tile), desktop
  `src-tauri/icons/*` (from the same master: `pnpm --filter @orbit/desktop tauri icon
  <repo>/marketing/brand/orbit-app-icon-1024.png`, then keep only `src-tauri/icons/*`, not the android/ios folders it
  also writes).

## The front door

The public site: everything a visitor sees before signing in (D66). The model is Stripe, Linear, Vercel: it says
plainly what Orbit is, shows the real product, and gets out of the way. Code: `apps/web/src/marketing/`.

- **One frame**: `PublicLayout` (skip link, `PublicHeader`, the page, `PublicFooter`, and `html.site` while it's
  mounted). Every public page uses it, the interview guides (/companies, /roles, pages/bank) included: a page just
  puts its sections inside. Props: `authState` (where sign-in and sign-up come back to), `context` (a short label
  after the logo), `actions` (replaces Sign in / Start free). `components/Footer` and `SiteMenu` render the same
  footer and phone menu. A section with pages of its own gets tabs under the header (the guides' Companies, Roles,
  Free warm-up).
- **Header**: the logo, a **Products** menu (all eight tools from `marketing/catalog.ts`, grouped "Interview,
  prepare, apply" / "More in your account", with the guides and the free question at its foot), Interview guides,
  Pricing, Security, Contact (the current section in ink), then Sign in (ghost) and Start free (primary); "Open
  Orbit" when signed in. Sticky, opaque, a hairline once scrolled. The menu is the shared one's behaviour and look
  (`useDismiss`, `floatingClass` from @orbit/ui).
  Phones: the logo, Start free and a menu button that opens the whole site as one full-screen sheet (a dialog: focus
  stays inside, Escape closes, the page behind doesn't scroll). No menu item ends on a sign-in wall: the four tools
  without a page of their own have anchors in the front page's "More in your account".
- **Canvas**: white, with `--site-subtle` (#F7F8FA) bands for alternate sections; dark mode is the workbench's blue-
  grey family (canvas #0B0F17, surface #141B27, line #232C3B, and the same ink steps, so shared components look the
  same signed in or out). Tokens: `mk-canvas`, `mk-band`, `mk-surface`, `mk-line`, `mk-divide` (site.css).
- **Grid and rhythm**: one container (`Container`: 72 rem, 20 px gutters, 32 px from `sm`), twelve columns on wide
  screens (a section is 5 + 7, text beside its picture, alternating sides), sections of 64 / 96 / 112 px
  (`Section`, a hairline above or a band). A section opens with `SectionIntro` (eyebrow, h2, one lead paragraph).
- **Type scale** (IBM Plex Sans, weight 600 headings, tight tracking): `mk-display` 36 to 60 px (one per page, the
  h1), `mk-h2` 28 to 40 px, `mk-h3` 20 px, `mk-lead` 17 to 20 px; body 15 to 16 px, secondary text ink-600. Eyebrows
  are sentence case in the accent (`Eyebrow`; `plain` for ink with a product mark), never tracked capitals. Prose uses
  proportional figures; prices and tables keep tabular ones. Keep a line from breaking with a no-wrap span: Plex has
  no non-breaking hyphen (it would pull in a fallback font).
- **Colour**: ink, and one accent for the main action, links and eyebrows. Product colours (copilot violet, Practice
  orange, Resume AI emerald, Jobs AI sky) mark a product's own tile only. The only gradients are the logo's (the one
  place cyan appears) and one still detail behind each hero (`mk-hero-detail`: a hairline grid that fades out and a
  faint accent light at the top).
- **Elevation**: flat. Only floating things cast a shadow: the product windows (`mk-float`), menus and the sticky bar
  (`mk-menu-shadow`). Cards are a surface with a hairline, often in a hairline grid (`gap-px` over the line colour).
- **Pictures are the product**: the hero is the live session drawn in HTML (`LiveAnswerDemo`: crisp, both themes,
  every accent); each product section shows a real screen (`ProductShot`: WebP 1600 x 1000 per theme and an 800 x 600
  crop for phones, plain markup: both themes' pictures are in the page and CSS hides the other one, so only the shown
  one is fetched, lazily, its size reserved, and the built HTML is the same). Screens come from a local stack with
  fictional demo data
  (`marketing/screens`: `seed.py`, then `capture.mjs`, `--webp` for the site, `--store` for the Store); re-capture
  them when those screens change. No stock photos, no people, no logos of companies that aren't customers. Sample
  data is labelled as such.
- **Icons**: lucide on a 40 px tile with a hairline ring (`IconTile`): the app's own neutral IconTile, or a main
  product's tint at 1.75 stroke.
  Line drawings (the 404's probe) use the line colour and one accent, no fills or glows.
- **Buttons**: `buttonClass` (primary solid accent, secondary bordered, ghost). On the closing ink panel
  (`CtaBand`), `inkButton.primary` (white) and `.secondary` (white outline). Google sign-in is `GoogleButton`, drawn
  to Google's rules (the standard G from Google's assets, Google Sans Medium 14/20 from public/fonts, 40 px, 12 px
  padding, 10 px gap, Google's light and dark fills); its label is "Sign in with Google" or "Sign up with Google".
- **Motion**, restrained and the app's own levels: `Reveal` for sections as they scroll in, the hero's answer
  streaming once at Full motion (Gentle, Off and data saver show the finished card), a 4 px nudge on a link's
  arrow. No parallax, no looping decoration, nothing that moves while someone reads.
- **Prompts**, never dark patterns: one inline sticky bar on phones and tablets (`StickyCta`: after the hero's
  buttons scroll away, waits for the cookie note, steps aside near the end, `×` hides it for good). No exit-intent
  or scroll-depth pop-ups, no timers, no "only N left", no confirm-shaming; Sign up is a page, not a modal (it needs
  the captcha, the terms box and somewhere to come back to). The cookie note is a notice (one strictly necessary
  sign-in cookie), a slim corner card, dismissed for good.
- **Copy**: what's true and checkable. Prices only from the server (`/v1/billing/packs`, `/v1/billing/monthly`,
  `/v1/plans`), never typed in; numbers only from the server (the job counts); the honest line (`USE_WHERE_ALLOWED`)
  in the hero, the footer and the sign-in panel; no "undetectable", no outcome promises, no vendor names.
- **Brand files** (`marketing/brand`): the wordmark and mark outlined (`orbit-wordmark-{light,dark}.svg`,
  `orbit-mark-*.svg`), the app icons (`render-icons.mjs`: the mark on a flat ink tile, web icons, a maskable icon and
  the 1024 px master for the desktop's `tauri icon`). Link previews: `apps/web/og/render.mjs` writes each public
  page's SVG and renders it to `public/og/<page>.jpg` (1200 x 630, under 300 KB). `PAGE_IMAGES` in
  `worker/meta.js` is the one list of which page shows which card: the Worker reads it, and so does the build's
  `<head>` for every built page (src/prerender/seo.ts; a company or role guide shows its list's card). Ads:
  `marketing/ads` (one template, `copy.json`, `export.mjs`; prices filled in at export only).
- **What's in git**: the sources (templates, copy, the seed, capture and export scripts, the brand SVGs, the 1024 px
  icon master) and what the site serves (the WebP screens, the link-preview JPGs, the icons). Exports that the
  scripts make again (the ad PNGs, the Store PNGs, the raw captures) are ignored (`marketing/.gitignore`) and handed
  over outside the repo.
- **Built as HTML**: the public pages are also rendered at build time (src/prerender, D63), so the first paint is the
  page itself. A built page opens with `<html class="site">`; when the app's copy takes over (lib/prerender.tsx) it
  keeps the class on a public page and drops it for anything else. A front-door component must render without the
  browser: no `window` or `document` at module scope or during render (effects are fine). Nothing is hydrated, so
  the app's copy may differ (the visitor's own prices and country arrive then). Until Plex arrives, front-door text
  is drawn in "Plex Fallback" (site.css: local Arial size-adjusted to Plex, a touch wide on purpose), so the built
  copy's first paint is never smaller than the app's copy of the same text, which would otherwise count as a later,
  larger paint (the LCP) when the app takes over.
- **Speed**: the public pages are lazy chunks; on an address with a public face its chunk starts with the session
  check, and a browser nobody has signed in on gets the page at once instead of a spinner. Pictures below the fold
  are lazy and sized; the front door loads one text face (Plex) and no font for the logo.
- **Checks**: `tools/e2e/public-pages.spec.ts` (axe WCAG 2.2 AA on every public page, light and dark, 1280 and 390 px,
  no sideways scroll on a phone, the menus' keyboard behaviour).
