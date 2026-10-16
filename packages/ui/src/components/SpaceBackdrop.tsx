import { memo } from "react";
import { motionEnv } from "../design/design";
import { cx } from "./cx";

/** Deterministic PRNG so the sky is identical on every render and in every screenshot. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
}

function makeStars(count: number, seed: number, maxR: number): Star[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    r: 0.3 + rand() * maxR,
    o: 0.35 + rand() * 0.65,
  }));
}

const FAR = makeStars(110, 7, 0.55);
const NEAR = makeStars(36, 42, 0.9);
const BRIGHT = makeStars(7, 1337, 1.2);

function StarLayer({ stars, className }: { stars: Star[]; className?: string }) {
  return (
    // Percent positions + pixel radii: the sky stretches to any window while the stars stay round.
    <svg className={cx("absolute inset-0 h-full w-full", className)}>
      {stars.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r * 1.6} fill="white" opacity={s.o} />
      ))}
    </svg>
  );
}

/**
 * The animated sky behind every screen: two slow aurora clouds and three layers of twinkling stars. Purely
 * decorative (aria-hidden, no pointer events), GPU-cheap (opacity/transform only, no blur filters, stepped so an idle screen repaints a few times a second), stars only in
 * dark mode, and still when motion is reduced.
 */
export const SpaceBackdrop = memo(function SpaceBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("space-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      <div
        className="absolute -right-[20%] -top-[30%] h-[80vmax] w-[80vmax] rounded-full opacity-60 motion-safe:animate-drift dark:opacity-100"
        style={{ background: "radial-gradient(closest-side, rgb(var(--accent-500) / 0.22), transparent)" }}
      />
      <div
        className="absolute -bottom-[35%] -left-[25%] h-[70vmax] w-[70vmax] rounded-full opacity-50 motion-safe:animate-drift dark:opacity-100"
        style={{
          background: "radial-gradient(closest-side, rgb(var(--aurora-400) / 0.12), transparent)",
          animationDelay: "-11s",
          animationDirection: "reverse",
        }}
      />
      {/* Deep Space 2.0: two slow light orbs (cyan, indigo) under the glass, and a 24px dot grid that fades out toward
          the edges (base.css .cosmic-*). Transform-only, on their own layer; still when motion is reduced. */}
      <div className="cosmic-orb cosmic-orb--cyan" />
      <div className="cosmic-orb cosmic-orb--indigo" />
      <div className="cosmic-dots" />
      {/* With data saver on, no stars: the sky's glow alone (153 fewer shapes to draw on a low-end phone). */}
      {!motionEnv().saveData && (
        <div className="space-stars absolute inset-0 hidden dark:block">
          <StarLayer stars={FAR} className="opacity-70" />
          <StarLayer stars={NEAR} className="motion-safe:animate-twinkle-sky" />
          <StarLayer stars={BRIGHT} className="motion-safe:animate-twinkle-sky [animation-delay:-1.6s] [animation-duration:4.5s]" />
        </div>
      )}
    </div>
  );
});

/** The same sky under its Deep Space 2.0 name. */
export const CosmicBackground = SpaceBackdrop;
