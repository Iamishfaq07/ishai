import { useId } from "react";
import { cx } from "./cx";

export interface OrbitLogoProps {
  size?: number;
  /** Gentle life: the spark twinkles (off = static mark). */
  animated?: boolean;
  /** Working: the orbit ring spins, e.g. while the AI is answering. */
  busy?: boolean;
  className?: string;
}

// Geometry on a 64-unit grid: a planet core, an orbit ring broken at the upper right, and a four-point spark
// (the AI) riding the orbit in that gap. Drawn once here; public/favicon.svg and the app icons are the same paths.
const RING = "M51.41 20.84 A23 23 0 1 1 43.16 12.59";
const SPARK = "M48.26 6.76 L50.34 13.66 L57.24 15.74 L50.34 17.82 L48.26 24.72 L46.18 17.82 L39.28 15.74 L46.18 13.66Z";

/** The Orbit mark. Ring and planet follow the accent colour into the aurora cyan; the spark is always starlight. */
export function OrbitLogo({ size = 20, animated = true, busy = false, className }: OrbitLogoProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cx("shrink-0 overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ring`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="rgb(var(--accent-600))" />
          <stop offset="0.5" stopColor="rgb(var(--accent-400))" />
          <stop offset="1" stopColor="rgb(var(--aurora-400))" />
        </linearGradient>
        <linearGradient id={`${id}-core`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--accent-300))" />
          <stop offset="1" stopColor="rgb(var(--accent-600))" />
        </linearGradient>
      </defs>
      <g className={cx(busy && "origin-center animate-orbit-fast")} style={{ transformBox: "view-box" }}>
        <path d={RING} fill="none" stroke={`url(#${id}-ring)`} strokeWidth="8" strokeLinecap="round" />
      </g>
      <circle cx="32" cy="32" r="8.5" fill={`url(#${id}-core)`} />
      <path
        d={SPARK}
        className={cx("fill-zinc-900 dark:fill-white", animated && "animate-spark")}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />
    </svg>
  );
}

/** Mark + "orbit" wordmark, for headers and sign-in screens. */
export function OrbitWordmark({
  size = 24,
  animated = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <OrbitLogo size={size} animated={animated} />
      <span className="font-display font-semibold tracking-tight" style={{ fontSize: size * 0.8 }}>
        orbit
      </span>
    </span>
  );
}
