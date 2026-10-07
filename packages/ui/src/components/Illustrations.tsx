import { useId, type ComponentType } from "react";
import { cx } from "./cx";

/** Orbit's four-point spark (the logo's), centred on x, y with radius r: an SVG path. */
export const SPARK = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3}Z`;

/**
 * Hero art: a ringed planet with an atmosphere, a moon and the Orbit spark circling it. Follows the accent colour.
 * Decorative only. Motion is CSS (orbit + twinkle) at Full motion only (`motion-ok:`), so Gentle, Off and the OS
 * setting all keep it still.
 */
export function PlanetHero({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const g = (name: string) => `${id}-${name}`;
  return (
    <svg viewBox="0 0 320 320" className={cx("overflow-visible", className)} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={g("atmo")} cx="50%" cy="50%" r="50%">
          <stop offset="0.55" stopColor="rgb(var(--accent-400))" stopOpacity="0.45" />
          <stop offset="1" stopColor="rgb(var(--accent-400))" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g("body")} cx="34%" cy="28%" r="80%">
          <stop offset="0" stopColor="rgb(var(--accent-200))" />
          <stop offset="0.35" stopColor="rgb(var(--accent-500))" />
          <stop offset="0.75" stopColor="rgb(var(--accent-800))" />
          <stop offset="1" stopColor="rgb(var(--ink-950))" />
        </radialGradient>
        <linearGradient id={g("ring")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgb(var(--accent-400))" stopOpacity="0.1" />
          <stop offset="0.45" stopColor="rgb(var(--accent-300))" />
          <stop offset="1" stopColor="rgb(var(--aurora-300))" />
        </linearGradient>
        <radialGradient id={g("moon")} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="white" />
          <stop offset="1" stopColor="rgb(var(--ink-400))" />
        </radialGradient>
        <clipPath id={g("planet")}>
          <circle cx="160" cy="160" r="86" />
        </clipPath>
        <clipPath id={g("front")}>
          <rect x="-40" y="160" width="400" height="200" />
        </clipPath>
      </defs>

      {/* Orbit paths */}
      <circle cx="160" cy="160" r="150" fill="none" stroke="rgb(var(--accent-400))" strokeOpacity="0.18" strokeDasharray="2 7" />
      <circle cx="160" cy="160" r="122" fill="none" stroke="rgb(var(--aurora-400))" strokeOpacity="0.12" />

      {/* Atmosphere + ring (back half) */}
      <circle cx="160" cy="160" r="118" fill={`url(#${g("atmo")})`} className="motion-ok:animate-glow-calm" />
      <g transform="rotate(-16 160 160)">
        <ellipse cx="160" cy="160" rx="138" ry="30" fill="none" stroke={`url(#${g("ring")})`} strokeWidth="5" strokeOpacity="0.55" />
      </g>

      {/* Planet with soft bands */}
      <circle cx="160" cy="160" r="86" fill={`url(#${g("body")})`} />
      <g clipPath={`url(#${g("planet")})`} opacity="0.35">
        <ellipse cx="150" cy="128" rx="120" ry="9" fill="rgb(var(--accent-200))" opacity="0.35" />
        <ellipse cx="170" cy="168" rx="120" ry="14" fill="rgb(var(--accent-900))" opacity="0.5" />
        <ellipse cx="150" cy="205" rx="120" ry="7" fill="rgb(var(--aurora-300))" opacity="0.3" />
      </g>
      <circle cx="160" cy="160" r="86" fill="none" stroke="rgb(var(--accent-200))" strokeOpacity="0.35" />

      {/* Ring (front half) */}
      <g transform="rotate(-16 160 160)">
        <ellipse
          cx="160"
          cy="160"
          rx="138"
          ry="30"
          fill="none"
          stroke={`url(#${g("ring")})`}
          strokeWidth="5"
          clipPath={`url(#${g("front")})`}
        />
      </g>

      {/* Moon on the outer orbit, spark on the inner one */}
      <g className="motion-ok:animate-orbit-slow" style={{ transformOrigin: "160px 160px" }}>
        <circle cx="160" cy="10" r="11" fill={`url(#${g("moon")})`} />
      </g>
      <g className="motion-ok:animate-orbit-reverse" style={{ transformOrigin: "160px 160px" }}>
        <path d={SPARK(282, 160, 10)} fill="white" />
        <circle cx="282" cy="160" r="16" fill="rgb(var(--aurora-300))" opacity="0.18" />
      </g>

      {/* Distant sparkles */}
      <path d={SPARK(40, 60, 6)} fill="white" className="motion-ok:animate-twinkle" />
      <path d={SPARK(292, 262, 5)} fill="white" className="motion-ok:animate-twinkle [animation-delay:-1.2s]" />
      <circle cx="58" cy="258" r="2" fill="white" className="motion-ok:animate-twinkle [animation-delay:-2s]" />
      <circle cx="268" cy="44" r="1.6" fill="white" className="motion-ok:animate-twinkle [animation-delay:-0.6s]" />
    </svg>
  );
}

/**
 * Small spot art for empty states and feature cards: an icon in a glowing orb, circled by a dashed orbit with a
 * satellite. Pass any lucide icon.
 */
export function SpotIllustration({
  icon: Icon,
  size = 112,
  className,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <span className={cx("relative inline-block shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id={`${id}-orb`} cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="rgb(var(--accent-400))" />
            <stop offset="1" stopColor="rgb(var(--accent-700))" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0.4" stopColor="rgb(var(--accent-500))" stopOpacity="0.35" />
            <stop offset="1" stopColor="rgb(var(--accent-500))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="56" cy="56" r="44" fill={`url(#${id}-halo)`} />
        <circle cx="56" cy="56" r="46" fill="none" stroke="rgb(var(--accent-400))" strokeOpacity="0.35" strokeDasharray="3 6" />
        <circle cx="56" cy="56" r="26" fill={`url(#${id}-orb)`} />
        <circle cx="56" cy="56" r="26" fill="none" stroke="white" strokeOpacity="0.25" />
        <g className="motion-ok:animate-orbit-calm" style={{ transformOrigin: "56px 56px" }}>
          <circle cx="56" cy="10" r="4" fill="rgb(var(--aurora-300))" />
          <circle cx="56" cy="10" r="8" fill="rgb(var(--aurora-300))" opacity="0.2" />
        </g>
        <path d={SPARK(97, 22, 5)} className="fill-zinc-400 motion-ok:animate-twinkle dark:fill-white" />
        <circle cx="16" cy="88" r="1.8" className="fill-zinc-400 motion-ok:animate-twinkle [animation-delay:-1.4s] dark:fill-white" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-white">
        <Icon className="h-[22%] w-[22%]" strokeWidth={2} />
      </span>
    </span>
  );
}

/** Pulsing rings behind a live indicator (listening, recording). */
export function PulseRings({ className }: { className?: string }) {
  return (
    <span className={cx("pointer-events-none absolute inset-0", className)} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border border-current motion-ok:animate-pulse-ring" />
      <span className="absolute inset-0 rounded-full border border-current motion-ok:animate-pulse-ring [animation-delay:0.6s]" />
    </span>
  );
}
