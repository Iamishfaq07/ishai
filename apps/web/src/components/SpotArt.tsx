import type { ReactElement } from "react";
import { cx } from "@orbit/ui";

/**
 * Small pictures for page headers, from the same trail-map world as RouteMapArt: the contour lines, a dotted route
 * and one subject drawn in ink with the accent on the part that matters. Decorative (aria-hidden); the route draws in
 * and the accent pops on Full motion (base.css `.route-draw`, `.route-stop`).
 */
export type SpotKind = "search" | "resume" | "offer" | "practice" | "route";

export function SpotArt({ kind, className }: { kind: SpotKind; className?: string }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden focusable="false" className={cx("h-auto w-36 text-zinc-300 dark:text-zinc-700", className)}>
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M-6 104c24-10 44-6 62-16s30-28 54-26 34 16 56 8" />
        <path d="M-6 86c22-8 40-2 56-14s28-32 52-32 36 14 64 2" />
        <path d="M-6 66c20-6 34-2 48-12s26-34 50-34 38 10 74-2" />
      </g>
      <path className="route-draw text-indigo-600 dark:text-indigo-400" style={{ ["--len" as string]: "220" }}
        d="M14 100c18-6 30-20 46-22s30 10 46 4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 7" />
      <circle cx="14" cy="100" r="4.5" className="route-stop fill-indigo-600 dark:fill-indigo-400" style={{ ["--i" as string]: 1, transformOrigin: "14px 100px" }} />
      <g className="route-stop" style={{ ["--i" as string]: 3, transformOrigin: "112px 54px" }}>{SUBJECTS[kind]}</g>
    </svg>
  );
}

const ink = "fill-white stroke-zinc-500 dark:fill-zinc-900 dark:stroke-zinc-400";
const accent = "fill-indigo-600 dark:fill-indigo-400";
const accentLine = "stroke-indigo-600 dark:stroke-indigo-400";

const SUBJECTS: Record<SpotKind, ReactElement> = {
  // A magnifier over the map, its lens on the next stop.
  search: <>
    <circle cx="108" cy="50" r="20" className={ink} strokeWidth="2.5" />
    <circle cx="108" cy="50" r="6" className={accent} />
    <path d="M123 65l14 14" className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth="5" strokeLinecap="round" />
  </>,
  // A page with lines and an accent bookmark: the resume the route starts from.
  resume: <>
    <rect x="92" y="22" width="40" height="52" rx="4" className={ink} strokeWidth="2" />
    <path d="M100 36h20M100 44h24M100 52h18M100 60h22" className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M122 22v14l5-4 5 4V22z" className={accent} />
  </>,
  // An envelope with the route's flag: the offer at the end of it.
  offer: <>
    <rect x="88" y="38" width="46" height="32" rx="4" className={ink} strokeWidth="2" />
    <path d="M88 42l23 16 23-16" fill="none" className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth="2" strokeLinejoin="round" />
    <path d="M128 38V14" className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth="2" strokeLinecap="round" />
    <path d="M129 15h16l-4 6 4 6h-16z" className={accent} />
  </>,
  // Two speech marks: a question asked, an answer rehearsed.
  practice: <>
    <path d="M86 28h34a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6h-20l-10 8v-8h-4a6 6 0 0 1-6-6V34a6 6 0 0 1 6-6z" className={ink} strokeWidth="2" />
    <path d="M110 48h30a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5h-4v7l-9-7h-17a5 5 0 0 1-5-5V53a5 5 0 0 1 5-5z" className={accent} />
    <path d="M96 40h16" className="stroke-zinc-400" strokeWidth="2.5" strokeLinecap="round" />
  </>,
  // The route's next stop, ringed, with the flag beyond it.
  route: <>
    <circle cx="106" cy="66" r="7" className="fill-white dark:fill-zinc-900" strokeWidth="3" stroke="currentColor" />
    <circle cx="106" cy="66" r="7" fill="none" className={accentLine} strokeWidth="3" />
    <path d="M128 60V26" className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth="2" strokeLinecap="round" />
    <path d="M129 27h18l-5 7 5 7h-18z" className={accent} />
  </>,
};
