import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";
import { useInView } from "../Reveal";

export { SPARK } from "../Illustrations";

export interface SceneProps {
  className?: string;
  /** What it shows, for screen readers. Without it the scene is decorative and hidden from them. */
  title?: string;
}

/**
 * The frame the Orbit scenes share: a 240 × 160 line drawing, like a page from a star atlas: hairline orbits,
 * paper surfaces and one subject in the accent, so the set reads as one hand in every theme and accent.
 * Motion (base.css, "Orbit scenes"): the first time a scene is in view (`data-shown`) its parts play one small
 * touch, then rest on the final frame: at Full strokes draw on (DRAW) and parts rise, pop or settle in; at Gentle
 * the same parts only fade in; at Off, in print and without JavaScript it's the final frame from the start. A part
 * marked NUDGE lifts a little on hover. Only the AI-working scenes (WorkingScene) loop, calmly, at Full only.
 */
export function Scene({ className = "", title, children }: SceneProps & { children: ReactNode }) {
  const [ref, shown] = useInView<SVGSVGElement>("0px");
  // A width in `className` ("w-24", "sm:w-40") sizes the scene; otherwise it fills its box, up to 15rem.
  const sized = /(?:^|\s)(?:[a-z0-9-]+:)*w-/.test(className);
  return (
    <svg
      ref={ref}
      viewBox="0 0 240 160"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-shown={shown ? "" : undefined}
      className={cx("scene h-auto overflow-visible font-sans", !sized && "w-full max-w-[15rem]", className)}
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
/** The accent, quieter: a highlighted line of text. */
export const ACCENT_BAR = "fill-indigo-500/60 dark:fill-indigo-400/60";
/** Placeholder text lines on paper. */
export const BAR = "fill-zinc-200 dark:fill-white/10";
/** A placeholder line drawn as a stroke, so it can draw on. */
export const BAR_LINE = "stroke-zinc-200 dark:stroke-white/10";
/** Small labels (9 px at the scene's own size; ink-500 on white passes 4.5:1). */
export const LABEL = "fill-zinc-500 text-[9px] font-medium dark:fill-zinc-400";

/* Motion: one of these per part (never two on one element, nor on an element with a `transform` attribute: wrap it
   in a <g>). `at(ms)` delays a part: a scene's steps sit 100–250 ms apart and are done within about a second. */
/** A stroke draws itself on. Give the element pathLength={1}; not for dashed strokes. */
export const DRAW = "scene-draw";
/** Fades in. */
export const FADE = "scene-fade";
/** Comes into place from a few px away: `at(ms, { x, y })` says from where (px; 6 px below by default). */
export const IN = "scene-in";
/** Grows into place from its centre. */
export const POP = "scene-pop";
/** Swings once and settles around its pivot, `at(ms, { o: "170px 55px" })` in scene units. */
export const SETTLE = "scene-settle";
/** Lifts a little while the scene, or the empty state around it, is hovered. */
export const NUDGE = "scene-nudge";

export const at = (ms: number, more: { x?: number; y?: number; o?: string } = {}): CSSProperties => {
  const style: Record<string, string> = { "--d": `${ms}ms` };
  if (more.x !== undefined) style["--x"] = `${more.x}px`;
  if (more.y !== undefined) style["--y"] = `${more.y}px`;
  if (more.o) style["--o"] = more.o;
  return style as CSSProperties;
};

/** A scatter of faint stars: [x, y, radius]. At Full they drift a hair, twice, then rest. */
export function Stars({ at: stars }: { at: Array<[number, number, number]> }) {
  return (
    <g className="scene-drift fill-zinc-300 dark:fill-white/40">
      {stars.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
      ))}
    </g>
  );
}

/** A tick in an accent disc at (x, y), radius r (`solid`: a filled disc, white tick); it draws in after `delay` ms. */
export function Tick({ x, y, r = 6, delay = 0, solid = false }: { x: number; y: number; r?: number; delay?: number; solid?: boolean }) {
  const s = r / 6;
  return (
    <>
      <circle cx={x} cy={y} r={r} className={solid ? ACCENT_FILL : `${ACCENT_SOFT} ${ACCENT}`} strokeWidth={solid ? undefined : 1.3} />
      <path
        d={`M${x - 2.8 * s} ${y + 0.2 * s}l${2 * s} ${2 * s} ${3.8 * s} ${-4.2 * s}`}
        pathLength={1}
        className={cx(solid ? "stroke-white dark:stroke-zinc-900" : ACCENT, DRAW)}
        strokeWidth={solid ? 1.8 : 1.5}
        style={at(delay)}
      />
    </>
  );
}

/** Someone, as a badge: a disc with a head and shoulders and no face (never a likeness). */
export function Person({ x, y, r, accent = false }: { x: number; y: number; r: number; accent?: boolean }) {
  const ink = accent ? ACCENT : LINE;
  return (
    <>
      <circle cx={x} cy={y} r={r} className={accent ? `${PAPER} ${ACCENT}` : PAPER} strokeWidth={accent ? 1.5 : 1} />
      <circle cx={x} cy={y - r * 0.22} r={r * 0.3} className={ink} strokeWidth="1.5" />
      <path d={`M${x - r * 0.56} ${y + r * 0.66}a${r * 0.56} ${r * 0.44} 0 0 1 ${r * 1.12} 0`} className={ink} strokeWidth="1.5" />
    </>
  );
}

/** A map pin standing on (x, y), head radius s. */
export const pin = (x: number, y: number, s: number) =>
  `M${x} ${y}C${x - 0.6 * s} ${y - 0.8 * s} ${x - s} ${y - 1.2 * s} ${x - s} ${y - 1.7 * s}A${s} ${s} 0 1 1 ${x + s} ${y - 1.7 * s}C${x + s} ${y - 1.2 * s} ${x + 0.6 * s} ${y - 0.8 * s} ${x} ${y}Z`;
