import type { ReactNode } from "react";
import { cx } from "../cx";

export { SPARK } from "../Illustrations";

export interface SceneProps {
  className?: string;
  /** What it shows, for screen readers. Without it the scene is decorative and hidden from them. */
  title?: string;
}

/**
 * The frame the Orbit scenes share: a 240 × 160 line drawing, like a page from a star atlas: hairline orbits,
 * paper surfaces and one subject in the accent, so the set reads as one hand in every theme and accent. Motion is a
 * single, finite touch per scene at Full motion only (`motion-ok:`).
 */
export function Scene({ className, title, children }: SceneProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 160"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cx("h-auto w-full max-w-[15rem] overflow-visible font-sans", className)}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {children}
    </svg>
  );
}

/** Hairlines and orbit paths. */
export const LINE = "stroke-zinc-300 dark:stroke-white/20";
/** Paper: cards, pages, screens. */
export const PAPER = "fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-white/25";
/** The subject. */
export const ACCENT = "stroke-indigo-500 dark:stroke-indigo-400";
export const ACCENT_FILL = "fill-indigo-500 dark:fill-indigo-400";
export const ACCENT_SOFT = "fill-indigo-500/10 dark:fill-indigo-400/15";
/** Placeholder text lines on paper. */
export const BAR = "fill-zinc-200 dark:fill-white/10";
/** Small labels (9 px at the scene's own size; ink-500 on white passes 4.5:1). */
export const LABEL = "fill-zinc-500 text-[9px] font-medium dark:fill-zinc-400";

/** A scatter of faint stars: [x, y, radius]. */
export function Stars({ at }: { at: Array<[number, number, number]> }) {
  return (
    <g className="fill-zinc-300 dark:fill-white/40">
      {at.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
      ))}
    </g>
  );
}

/** A map pin standing on (x, y), head radius s. */
export const pin = (x: number, y: number, s: number) =>
  `M${x} ${y}C${x - 0.6 * s} ${y - 0.8 * s} ${x - s} ${y - 1.2 * s} ${x - s} ${y - 1.7 * s}A${s} ${s} 0 1 1 ${x + s} ${y - 1.7 * s}C${x + s} ${y - 1.2 * s} ${x + 0.6 * s} ${y - 0.8 * s} ${x} ${y}Z`;
