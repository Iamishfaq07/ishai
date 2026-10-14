import type { ReactNode } from "react";
import { EmptyState, type EmptyStateProps } from "./ui";

export type CosmicEmptyVariant = "jobs" | "resume" | "practice" | "capture-recovery" | "support";

const CYAN = "#38bdf8";
const INDIGO = "#818cf8";
const EMERALD = "#34d399";

/** The small moving scenes (base.css .cosmic-sweep / -float / -blink / -link; all still with reduced motion). */
function Art({ variant }: { variant: CosmicEmptyVariant }): ReactNode {
  const frame = (children: ReactNode) => (
    <svg viewBox="0 0 120 120" width="112" height="112" aria-hidden="true" focusable="false" className="overflow-visible">
      <defs>
        <radialGradient id="cosmic-empty-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={INDIGO} stopOpacity="0.28" />
          <stop offset="1" stopColor={INDIGO} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#cosmic-empty-glow)" />
      {children}
    </svg>
  );
  switch (variant) {
    case "jobs": // a radar sweeping for openings
      return frame(
        <>
          {[44, 30, 16].map((r) => (
            <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={CYAN} strokeOpacity="0.3" strokeWidth="1.2" />
          ))}
          <g className="cosmic-sweep">
            <path d="M60 60 L60 16 A44 44 0 0 1 98 38 Z" fill={CYAN} fillOpacity="0.16" />
            <line x1="60" y1="60" x2="60" y2="16" stroke={CYAN} strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <circle className="cosmic-blink" cx="82" cy="44" r="3" fill={EMERALD} />
          <circle className="cosmic-blink" style={{ animationDelay: "0.6s" }} cx="40" cy="78" r="2.5" fill={INDIGO} />
          <circle cx="60" cy="60" r="3" fill={CYAN} />
        </>,
      );
    case "resume": // a page drifting in orbit, sparks around it
      return frame(
        <>
          <g className="cosmic-float">
            <rect x="38" y="26" width="44" height="58" rx="6" fill="none" stroke={INDIGO} strokeWidth="1.6" />
            {[38, 46, 54, 62].map((y, i) => (
              <line key={y} x1="46" y1={y} x2={i === 0 ? 66 : 74} y2={y} stroke={CYAN} strokeOpacity={i === 0 ? 0.9 : 0.45} strokeWidth="2" strokeLinecap="round" />
            ))}
            <line x1="46" y1="72" x2="62" y2="72" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" />
          </g>
          <ellipse cx="60" cy="92" rx="34" ry="6" fill="none" stroke={INDIGO} strokeOpacity="0.3" strokeWidth="1.2" />
          <path className="cosmic-blink" d="M92 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill={CYAN} />
          <path className="cosmic-blink" style={{ animationDelay: "0.9s" }} d="M26 64 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill={INDIGO} />
        </>,
      );
    case "practice": // a planet with a voice ring
      return frame(
        <>
          <circle cx="60" cy="60" r="18" fill={INDIGO} fillOpacity="0.22" stroke={INDIGO} strokeWidth="1.6" />
          <ellipse cx="60" cy="60" rx="40" ry="12" fill="none" stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.4" transform="rotate(-18 60 60)" />
          <g className="cosmic-float">
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1={50 + i * 5} y1={60 - [3, 7, 10, 7, 3][i]!} x2={50 + i * 5} y2={60 + [3, 7, 10, 7, 3][i]!} stroke={CYAN} strokeWidth="2" strokeLinecap="round" />
            ))}
          </g>
          <circle className="cosmic-blink" cx="96" cy="48" r="3" fill={EMERALD} />
        </>,
      );
    case "capture-recovery": // a screen reconnecting to Orbit
      return frame(
        <>
          <rect x="22" y="34" width="50" height="36" rx="5" fill="none" stroke={INDIGO} strokeWidth="1.6" />
          <line x1="40" y1="78" x2="54" y2="78" stroke={INDIGO} strokeWidth="1.6" strokeLinecap="round" />
          <path className="cosmic-link" d="M72 52 C84 52 84 40 96 40" fill="none" stroke={CYAN} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="98" cy="40" r="6" fill="none" stroke={CYAN} strokeWidth="1.6" />
          <circle className="cosmic-blink" cx="98" cy="40" r="2.5" fill={EMERALD} />
          <path d="M38 52 l6 6 12 -12" fill="none" stroke={EMERALD} strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>,
      );
    case "support": // two messages, one typing
      return frame(
        <>
          <g className="cosmic-float">
            <rect x="22" y="30" width="52" height="28" rx="10" fill={INDIGO} fillOpacity="0.2" stroke={INDIGO} strokeWidth="1.4" />
            <path d="M34 58 l-4 8 10 -8" fill={INDIGO} fillOpacity="0.2" stroke={INDIGO} strokeWidth="1.4" strokeLinejoin="round" />
          </g>
          <rect x="50" y="64" width="48" height="26" rx="10" fill="none" stroke={CYAN} strokeWidth="1.4" />
          {[64, 74, 84].map((x, i) => (
            <circle key={x} className="cosmic-blink" style={{ animationDelay: `${i * 0.25}s` }} cx={x} cy="77" r="2.6" fill={CYAN} />
          ))}
        </>,
      );
  }
}

/**
 * An EmptyState with one of Orbit's small animated space scenes in place of an icon: `jobs` (radar), `resume` (a
 * drifting page), `practice` (a planet with a voice ring), `capture-recovery` (a screen reconnecting), `support`.
 */
export function CosmicEmptyState({ variant, ...props }: Omit<EmptyStateProps, "art" | "icon"> & { variant: CosmicEmptyVariant }) {
  return <EmptyState {...props} art={<Art variant={variant} />} />;
}
