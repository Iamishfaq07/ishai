import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Progress, ProgressPoint } from "@orbit/types";
import { ArrowRight, cx, focusRing } from "@orbit/ui";
import { Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const H = 180;
const PAD = { top: 16, right: 36, bottom: 24, left: 28 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/**
 * Review score (1–5) per scored session, oldest → newest. One series: no legend (the heading names it), 2px line,
 * 8px markers with a surface ring, a crosshair + tooltip on hover, the latest value labelled, and a table view.
 */
function ScoreChart({ points }: { points: ProgressPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (score: number) => PAD.top + innerH - ((score - 1) / 4) * innerH;
  const coords = points.map((p, i) => [x(i), y(p.overall_score ?? 1)] as const);
  const line = coords.map(([cx_, cy], i) => `${i ? "L" : "M"}${cx_},${cy}`).join(" ");
  const area = `${line} L${coords.at(-1)?.[0] ?? 0},${PAD.top + innerH} L${coords[0]?.[0] ?? 0},${PAD.top + innerH} Z`;
  const last = points.at(-1);
  const lastXY = coords.at(-1);
  const hp = hover !== null ? points[hover] : null;
  const hc = hover !== null ? coords[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    coords.forEach(([cx_], i) => {
      if (Math.abs(cx_ - px) < Math.abs((coords[best]?.[0] ?? 0) - px)) best = i;
    });
    setHover(best);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`Review score over your last ${points.length} scored sessions, latest ${last?.overall_score ?? "–"} out of 5`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-none"
      >
        {[1, 2, 3, 4, 5].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-white/10" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
              {t}
            </text>
          </g>
        ))}
        <path d={area} className="fill-indigo-600/10 dark:fill-indigo-500/10" />
        <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-indigo-600 dark:stroke-indigo-500" />
        {hc && <line x1={hc[0]} x2={hc[0]} y1={PAD.top} y2={PAD.top + innerH} className="stroke-zinc-300 dark:stroke-white/20" strokeWidth={1} />}
        {coords.map(([cx_, cy], i) => (
          <circle
            key={points[i]?.id}
            cx={cx_}
            cy={cy}
            r={hover === i ? 6 : 4}
            strokeWidth={2}
            className="fill-indigo-600 stroke-white dark:fill-indigo-500 dark:stroke-zinc-900"
          />
        ))}
        {last && lastXY && (
          <text x={lastXY[0] + 10} y={lastXY[1]} dy="0.32em" className="fill-zinc-900 text-xs font-semibold dark:fill-zinc-100">
            {last.overall_score}
          </text>
        )}
        <text x={PAD.left} y={H - 4} className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
          {shortDate(points[0]?.ended_at ?? null)}
        </text>
        <text x={width - PAD.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
          {shortDate(last?.ended_at ?? null)}
        </text>
      </svg>
      {hp && hc && (
        <div
          role="status"
          className="glass-panel pointer-events-none absolute z-10 w-52 rounded-xl p-2.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(hc[0] - 104, 0), width - 208), top: Math.max(hc[1] - 96, 0) }}
        >
          <p className="truncate font-medium">{hp.title}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {SESSION_TYPE_LABEL[hp.type]} · {shortDate(hp.ended_at)}
          </p>
          <p className="mt-1 tabular-nums">
            Score <span className="font-semibold">{hp.overall_score}/5</span>
            {hp.words_per_minute !== null && ` · ${hp.words_per_minute} wpm`}
            {hp.fillers_per_minute !== null && ` · ${hp.fillers_per_minute} fillers/min`}
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs">{detail}</p>}
    </div>
  );
}

function ScoreDelta({ recent, before }: { recent: number | null; before: number | null }) {
  if (recent === null || before === null) return null;
  const d = Math.round((recent - before) * 10) / 10;
  if (d === 0) return <span className="text-zinc-500 dark:text-zinc-400">Same as the 5 before</span>;
  return (
    <span className={d > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
      {d > 0 ? "▲" : "▼"} {d > 0 ? "+" : ""}
      {d} vs the 5 before
    </span>
  );
}

/** "Your progress": practice cadence, review scores over time and the latest speaking tips. */
export function ProgressSection() {
  const progress = useAsync<Progress>(() => api.progress(), [], "progress");
  if (progress.loading) return <Spinner />;
  if (progress.error) return <ErrorNote onRetry={progress.reload}>{errorText(progress.error)}</ErrorNote>;
  const data = progress.data;
  if (!data || data.summary.sessions === 0) return null; // nothing to show yet: the prep/practice below comes first

  const s = data.summary;
  const scored = data.points.filter((p) => p.overall_score !== null);
  const latestPace = [...data.points].reverse().find((p) => p.words_per_minute !== null)?.words_per_minute ?? null;

  return (
    <section aria-labelledby="progress-title" className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="progress-title" className="font-display text-lg font-semibold">
              Your progress
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Review scores and speaking habits across your sessions.</p>
          </div>
          <Link to="/sessions" className={cx("inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
            All sessions <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Sessions this week" value={String(s.this_week)} />
          <Tile label="Streak" value={`${s.streak_days} day${s.streak_days === 1 ? "" : "s"}`} />
          <Tile
            label="Average score (last 5)"
            value={s.average_score_recent !== null ? `${s.average_score_recent}/5` : "–"}
            detail={<ScoreDelta recent={s.average_score_recent} before={s.average_score_before} />}
          />
          <Tile label="Latest pace" value={latestPace !== null ? `${latestPace} wpm` : "–"} />
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold">Review score over time</h3>
          {scored.length >= 2 ? (
            <>
              <ScoreChart points={scored} />
              <details className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <summary className={cx("cursor-pointer select-none", focusRing)}>Show as table</summary>
                <table className="mt-2 w-full text-left tabular-nums">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="py-1 font-medium">Session</th>
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 font-medium">Score</th>
                      <th className="py-1 font-medium">Pace</th>
                      <th className="py-1 font-medium">Fillers/min</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-700 dark:text-zinc-300">
                    {scored.map((p) => (
                      <tr key={p.id} className="border-t border-zinc-200 dark:border-white/[0.06]">
                        <td className="max-w-[12rem] truncate py-1">
                          <Link to={`/sessions/${p.id}`} className="hover:underline">
                            {p.title}
                          </Link>
                        </td>
                        <td className="py-1">{shortDate(p.ended_at)}</td>
                        <td className="py-1">{p.overall_score}/5</td>
                        <td className="py-1">{p.words_per_minute ?? "–"}</td>
                        <td className="py-1">{p.fillers_per_minute ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Review two sessions to see your trend. Mock interviews are reviewed automatically.
            </p>
          )}
        </div>

        {s.latest_tips.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold">From your latest session</h3>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {s.latest_tips.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
