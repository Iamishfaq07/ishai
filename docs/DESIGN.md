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
Contrast: secondary text is remapped in `base.css` so it passes WCAG AA on every surface in both themes.

## Type

`font-display` (Space Grotesk) for headings — applied to `h1`–`h3` globally — `font-sans` (Inter) for body,
`font-mono` (JetBrains Mono) for code. Self-hosted via Fontsource.

## Surfaces

- `glass-panel` — frosted card (the `Card` primitive). In see-through desktop windows it drops its blur and follows
  the window's transparency.
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

Utilities: `animate-fade-up`, `stagger` (children enter one after another), `lift` (hover), `btn-sheen` (primary
buttons), `animate-float`, `animate-orbit*`, `animate-twinkle`, `animate-drift`, `animate-pulse-ring`,
`animate-spark`. All decorative motion uses `motion-safe:` or is disabled by `html.reduce-motion`
(Settings → Animations) and the OS reduced-motion setting.

## Brand

- `OrbitLogo` / `OrbitWordmark` — the mark (`busy` spins the ring; `animated` twinkles the spark).
- `PlanetHero`, `SpotIllustration`, `PulseRings` — illustrations.
- Icons: lucide only, re-exported from `packages/ui/src/icons.ts`.
- Static copies of the mark: `apps/*/public/favicon.svg`, web `apple-touch-icon.png` / `icon-*.png`,
  desktop `src-tauri/icons/*` (regenerate with `pnpm --filter @orbit/desktop exec tauri icon <1024px png>`).
