/**
 * Shared Tailwind preset for the web and desktop apps.
 *
 * Accent colour: every `indigo-*` class resolves to CSS variables (`--accent-50` … `--accent-950`, RGB
 * triplets set by `applyDesign`), so the whole UI follows the user's accent choice without touching
 * components. The defaults in design/base.css are Tailwind's indigo, so nothing changes until a user picks.
 * (Untyped on purpose: @orbit/ui doesn't depend on tailwindcss; each app's config types it.)
 */
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const accent = Object.fromEntries(shades.map((s) => [s, `rgb(var(--accent-${s}) / <alpha-value>)`]));

export default {
  content: [],
  theme: {
    extend: {
      colors: { indigo: accent },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.94)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        orbit: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-4px)" } },
        wave: { "0%, 100%": { transform: "scaleY(0.35)" }, "50%": { transform: "scaleY(1)" } },
        glow: { "0%, 100%": { opacity: "0.55" }, "50%": { opacity: "1" } },
        pop: { "0%": { transform: "scale(1)" }, "40%": { transform: "scale(1.18)" }, "100%": { transform: "scale(1)" } },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "fade-up": "fade-up 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "scale-in": "scale-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
        orbit: "orbit 6s linear infinite",
        "orbit-fast": "orbit 1.4s linear infinite",
        float: "float 3.5s ease-in-out infinite",
        wave: "wave 0.9s ease-in-out infinite",
        glow: "glow 2.4s ease-in-out infinite",
        pop: "pop 0.35s ease-out",
      },
    },
  },
};
