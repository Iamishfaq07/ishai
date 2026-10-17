/**
 * Shared Tailwind preset for the web and desktop apps — the "Deep Space" design system.
 *
 * Colours are CSS variables (RGB triplets, see design/base.css), so components keep using plain Tailwind names:
 * - `indigo-*` is the ACCENT (`--accent-50` … `--accent-950`, set by `applyDesign` from the user's choice).
 * - `zinc-*` is INK: the cool, blue-violet neutrals every surface, border and secondary text is drawn with.
 * - `aurora-*` is the fixed cyan the brand gradients fade into (logo, hero glows) — never used for UI state.
 * - `stage-*` is a job's stage (saved … rejected): fixed colours, not the accent.
 * Motion is tokens too (`--dur-*`, `--ease-*` in base.css): `duration-quick`, `ease-enter`, and the animations below.
 * (Untyped on purpose: @orbit/ui doesn't depend on tailwindcss; each app's config types it.)
 */
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const scale = (name: string) => Object.fromEntries(shades.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const stages = ["saved", "applied", "interviewing", "offer", "rejected"] as const;

export default {
  content: [],
  theme: {
    extend: {
      colors: {
        indigo: scale("accent"),
        zinc: scale("ink"),
        aurora: scale("aurora"),
        // `bg-stage-applied`: a job's stage, the same whatever the accent (base.css says why).
        stage: Object.fromEntries(stages.map((s) => [s, `rgb(var(--stage-${s}) / <alpha-value>)`])),
      },
      // Corners say how a thing behaves: controls (xl) are crisp, cards (2xl) a little softer, big panels (3xl) the
      // softest. Tighter than Tailwind's defaults (12 / 16 / 24 px), which read as a consumer app.
      borderRadius: { xl: "0.5rem", "2xl": "0.75rem", "3xl": "1rem" },
      fontFamily: {
        // IBM Plex Sans for the product (text, numbers, and the app's headings: base.css). Inter stays as the fallback.
        sans: ["IBM Plex Sans Variable", "IBM Plex Sans", "Inter Variable", "Inter", "ui-sans-serif", "system-ui",
               "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Space Grotesk Variable", "Space Grotesk", "Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--accent-400) / 0.25), 0 8px 32px -8px rgb(var(--accent-500) / 0.55)",
        "glow-sm": "0 0 0 1px rgb(var(--accent-400) / 0.2), 0 4px 16px -6px rgb(var(--accent-500) / 0.5)",
        panel: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 20px 50px -24px rgb(0 0 0 / 0.6)",
        // Elevation: only things that float cast a shadow, and the higher they sit the softer and wider it is (menu <
        // popover < dialog < toast). Tokens in base.css (--shadow-*), so dark mode has its own.
        menu: "var(--shadow-menu)",
        popover: "var(--shadow-popover)",
        dialog: "var(--shadow-dialog)",
        toast: "var(--shadow-toast)",
      },
      // The stacking order, low to high: sticky bars, the sidebar, menus and popovers, a dialog, a confirm over it,
      // toasts over everything (feedback must stay visible).
      zIndex: { bar: "20", sidebar: "30", menu: "40", popover: "40", dialog: "50", confirm: "60", toast: "70" },
      // press 100 ms (press, toggle) · quick 160 (hover, small fades) · panel 240 (popover, toast) · page 280 (route
      // change, card expand) · moment 700 (one-off celebrations only). Exits use ease-exit and run shorter.
      transitionDuration: {
        press: "var(--dur-press)",
        quick: "var(--dur-quick)",
        panel: "var(--dur-panel)",
        page: "var(--dur-page)",
        moment: "var(--dur-moment)",
      },
      transitionTimingFunction: { standard: "var(--ease-standard)", enter: "var(--ease-enter)", exit: "var(--ease-exit)" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { to: { opacity: "0" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.94)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        orbit: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        "orbit-reverse": { from: { transform: "rotate(360deg)" }, to: { transform: "rotate(0deg)" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        wave: { "0%, 100%": { transform: "scaleY(0.35)" }, "50%": { transform: "scaleY(1)" } },
        glow: { "0%, 100%": { opacity: "0.55" }, "50%": { opacity: "1" } },
        pop: { "0%": { transform: "scale(1)" }, "40%": { transform: "scale(1.18)" }, "100%": { transform: "scale(1)" } },
        twinkle: { "0%, 100%": { opacity: "0.25" }, "50%": { opacity: "1" } },
        spark: {
          "0%, 100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
          "50%": { transform: "scale(0.72) rotate(45deg)", opacity: "0.8" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(4%, -3%, 0) scale(1.08)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        sheen: { from: { transform: "translateX(-120%) skewX(-20deg)" }, to: { transform: "translateX(220%) skewX(-20deg)" } },
        // Overlays: a dialog fades in from a touch smaller; a phone sheet and a toast rise; a menu drops from its button.
        "dialog-in": { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "none" } },
        "sheet-up": { from: { transform: "translateY(16%)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "menu-in": { from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "panel-in": { from: { opacity: "0", transform: "translateX(24px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        // Entrances. Under Gentle motion base.css turns each into a plain fade.
        "fade-in": "fade-in var(--dur-quick) var(--ease-standard) both",
        "fade-up": "fade-up var(--dur-page) var(--ease-enter) both",
        "scale-in": "scale-in var(--dur-panel) var(--ease-enter) both",
        // A panel or toast coming up into view; its exit is the shorter fade-out.
        rise: "fade-up var(--dur-panel) var(--ease-enter) both",
        "fade-out": "fade-out var(--dur-quick) var(--ease-exit) both",
        shimmer: "shimmer 1.6s linear infinite",
        orbit: "orbit 6s linear infinite",
        // Decorative loops play for a while, then rest: an idle screen shouldn't keep repainting (battery, jank).
        "orbit-slow": "orbit 40s linear 0.5 forwards",
        "orbit-reverse": "orbit-reverse 60s linear 0.33 forwards",
        "orbit-fast": "orbit 1.4s linear infinite",
        float: "float 5s ease-in-out 4",
        wave: "wave 0.9s ease-in-out infinite",
        glow: "glow 2.4s ease-in-out infinite",
        "glow-calm": "glow 2.4s ease-in-out 6",
        "orbit-calm": "orbit 9s linear 2",
        pop: "pop var(--dur-panel) var(--ease-standard)",
        twinkle: "twinkle 3.2s ease-in-out 5",
        // The sky keeps twinkling, in steps: ~5 repaints a second instead of 60, and it looks the same.
        "twinkle-sky": "twinkle 3.2s steps(16) infinite",
        spark: "spark 2.8s ease-in-out 3",
        // ~4 steps a second over a 22 s sweep of a huge soft gradient: each step is a pixel or two, invisible.
        drift: "drift 22s steps(88) infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.2, 0.8, 0.2, 1) infinite",
        sheen: "sheen 0.9s ease-out",
        // Overlay entrances (Gentle turns each into a fade, Off into nothing: base.css).
        "dialog-in": "dialog-in var(--dur-panel) var(--ease-enter) both",
        "sheet-up": "sheet-up var(--dur-page) var(--ease-enter) both",
        "menu-in": "menu-in var(--dur-quick) var(--ease-enter) both",
        "panel-in": "panel-in var(--dur-page) var(--ease-enter) both",
      },
    },
  },
  plugins: [
    // `motion-ok:` styles apply at Full motion only: the in-app setting (html[data-motion], see design.ts) and the OS
    // both allow movement. Tailwind's own `motion-safe:` sees only the OS, so prefer this for anything that moves.
    ({ addVariant }: { addVariant: (name: string, definition: string) => void }) =>
      addVariant(
        "motion-ok",
        '@media (prefers-reduced-motion: no-preference) { :root:not([data-motion="reduced"]):not([data-motion="off"]) & }',
      ),
  ],
};
