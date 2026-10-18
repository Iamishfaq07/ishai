import { useRef } from "react";
import type { LinkedInSectionScore } from "@orbit/types";
import { cx, useCountUp, useInView } from "@orbit/ui";
import { scoreWord } from "./model";

// A score's ring: the fill says how it went; the track is a pale step of the same colour, so the whole ring reads.
const RING_TONE = {
  good: ["stroke-emerald-500", "stroke-emerald-500/15"],
  fair: ["stroke-indigo-500", "stroke-indigo-500/15"],
  low: ["stroke-amber-500", "stroke-amber-500/20"],
} as const;

/** The value before the latest change (the first value at first). */
function usePrevious(value: number): number {
  const seen = useRef<{ now: number; before: number }>({ now: value, before: value });
  if (seen.current.now !== value) seen.current = { now: value, before: seen.current.now };
  return seen.current.before;
}

/**
 * The score as a ring: the number in the middle says it; the ring is decoration. The first time it's in view the ring
 * draws round as the number counts up; after a fix is applied it moves on from the old score, with the change beside
 * it for a moment (Full motion; otherwise the new value is simply there). Screen readers get the final number only.
 */
export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const [ref, seen] = useInView<HTMLDivElement>();
  const before = usePrevious(score);
  // The first time: up from 0. After a change: on from the old score (stable across unrelated renders).
  const changed = before !== score;
  const shown = useCountUp(score, seen, { from: changed ? before : 0, duration: 900 });
  const [fill, track] = RING_TONE[score >= 85 ? "good" : score >= 65 ? "fair" : "low"];
  const delta = score - before;
  return (
    <div ref={ref} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className={track} />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, shown)) / 100)}
                className={cx(fill, shown < 1 && "opacity-0")} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="stat-value font-display text-2xl font-semibold">
          <span aria-hidden>{Math.round(shown)}</span>
          <span className="sr-only">{score} out of 100</span>
        </span>
        <span aria-hidden className="text-[10px] text-zinc-500">out of 100</span>
      </span>
      {changed && (
        <span key={score} aria-hidden className={cx("absolute -right-2 -top-1 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums animate-fade-out [animation-delay:1600ms]",
          delta > 0 ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" : "bg-amber-500/15 text-amber-900 dark:text-amber-200")}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </div>
  );
}

/** "Strong", "Good"…, under the ring. */
export function ScoreWord({ score }: { score: number }) {
  return <p className="mt-1 text-center text-sm font-medium">{scoreWord(score)}</p>;
}

/**
 * Each section's points as a bar, the latest roles under Experience. The bars grow in from the left the first time
 * they're in view (Full; a fade at Gentle; there at once at Off), and a bar whose section a fix just changed wears a
 * fading accent ring. Sections LinkedIn's PDF doesn't carry say so instead of showing an empty bar.
 */
export function SectionBars({ sections, flash }: { sections: LinkedInSectionScore[]; flash: { id: string; at: number } | null }) {
  const [ref, seen] = useInView<HTMLUListElement>();
  const known = sections.filter((s) => s.known);
  const unknown = sections.filter((s) => !s.known);
  return (
    <div>
      <ul ref={ref} data-shown={seen ? "" : undefined} className="chart grid gap-x-6 gap-y-2 sm:grid-cols-2" aria-label="Your score by section">
        {known.map((s, i) => (
          <li key={`${s.id}-${flash?.id === s.id ? flash.at : 0}`} className={cx("-mx-1.5 rounded-lg px-1.5 py-1 text-sm", flash?.id === s.id && "moved-flash")}>
            <Bar label={s.label} points={s.points} max={s.max} delay={i * 60} />
            {s.roles.length > 0 && (
              <ul className="mt-1.5 space-y-1 border-l border-zinc-200 pl-3 dark:border-white/10" aria-label="Each of your latest roles">
                {s.roles.map((r) => (
                  <li key={r.index} className="text-xs">
                    <Bar label={r.label} points={r.points} max={r.max} delay={i * 60 + 120} small />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {unknown.length > 0 && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Not scored, because LinkedIn's PDF doesn't include them: {unknown.map((s) => s.label.toLowerCase()).join(", ")}. Check them yourself below.
        </p>
      )}
    </div>
  );
}

function Bar({ label, points, max, delay, small = false }: { label: string; points: number; max: number; delay: number; small?: boolean }) {
  const full = max > 0 && points >= max;
  const pct = max > 0 ? Math.max(0, Math.min(1, points / max)) : 0;
  return (
    <>
      <div className="flex justify-between gap-2">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
          {points}/{max}
          <span className="sr-only"> points</span>
        </span>
      </div>
      <span aria-hidden className={cx("chart-marks mt-0.5 block overflow-hidden rounded-full bg-zinc-500/15", small ? "h-1" : "h-1.5")}>
        <span className="chart-fill block h-full" style={{ animationDelay: `${delay}ms` }}>
          <span
            className={cx("block h-full origin-left rounded-full motion-ok:transition-transform motion-ok:duration-panel motion-ok:ease-standard", full ? "bg-emerald-500" : "bg-indigo-500")}
            style={{ transform: `scaleX(${pct})` }}
          />
        </span>
      </span>
    </>
  );
}

/** As read → now → with every fix: where the score came from and where the suggestions take it. */
export function ScoreTrail({ read, now, projected }: { read: number; now: number; projected: number }) {
  const steps = [
    { label: "As read from LinkedIn", value: read },
    { label: "Orbit's copy now", value: now },
    { label: "With every fix applied", value: projected },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 text-center" aria-label="Your score, before and after the fixes">
      {steps.map((s, i) => (
        <div key={s.label} className={cx("rounded-xl px-2 py-2", i === 2 ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/20" : "bg-zinc-500/5")}>
          <dt className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">{s.label}</dt>
          <dd className="stat-value mt-0.5 font-display text-lg font-semibold tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
