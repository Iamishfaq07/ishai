import { cx } from "./cx";

export interface OrbitLogoProps {
  size?: number;
  /** Satellite circles the planet (off = static mark). */
  animated?: boolean;
  /** Faster orbit, e.g. while the AI is working. */
  busy?: boolean;
  className?: string;
}

/** The Orbit mark: an accent-coloured planet with a satellite on a tilted orbit. Follows the accent colour. */
export function OrbitLogo({ size = 20, animated = true, busy = false, className }: OrbitLogoProps) {
  return (
    <span className={cx("relative inline-block shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-[22%] rounded-full bg-gradient-to-br from-indigo-300 via-indigo-500 to-indigo-700 shadow-[0_0_12px_rgb(var(--accent-500)/0.55)]" />
      <span
        className="absolute inset-0 rounded-full border border-indigo-400/50"
        style={{ transform: "rotateX(62deg) rotateZ(-18deg)" }}
      />
      <span className={cx("absolute inset-0", animated && (busy ? "animate-orbit-fast" : "animate-orbit"))}>
        <span
          className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full bg-indigo-200 shadow-[0_0_6px_rgb(var(--accent-300))]"
          style={{ width: Math.max(3, size * 0.2), height: Math.max(3, size * 0.2) }}
        />
      </span>
    </span>
  );
}
