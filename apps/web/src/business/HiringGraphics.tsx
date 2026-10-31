import { useId } from "react";
import { cx } from "@orbit/ui";

/** A data graphic: each segment is one criterion, and fills only when a human submitted an observation. */
export function EvidenceOrbit({ assessed, total, className }: { assessed: number; total: number; className?: string }) {
  const id = useId();
  const count = Math.max(total, 1);
  return <svg viewBox="0 0 132 132" role="img" aria-labelledby={id} className={cx("h-28 w-28 shrink-0", className)}>
    <title id={id}>{assessed} of {total} criteria have interview evidence</title>
    {Array.from({ length: count }, (_, i) => {
      const length = 2 * Math.PI * 49 / count;
      return <circle key={i} cx="66" cy="66" r="49" fill="none" stroke="currentColor" strokeWidth="7"
        className={cx("motion-safe:transition-colors motion-safe:duration-quick", i < assessed ? "text-indigo-500" : "text-zinc-200 dark:text-zinc-700")}
        strokeDasharray={`${Math.max(length - 5, 1)} ${2 * Math.PI * 49 - Math.max(length - 5, 1)}`}
        transform={`rotate(${-90 + i * 360 / count} 66 66)`} />;
    })}
    <text x="66" y="64" fill="currentColor" textAnchor="middle" className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{assessed}<tspan fill="currentColor" className="text-sm text-zinc-500">/{total}</tspan></text>
    <text x="66" y="84" fill="currentColor" fontSize="10" textAnchor="middle" className="text-zinc-500">observed</text>
  </svg>;
}

export function HiringLoopGraphic() {
  const id = useId();
  return <svg viewBox="0 0 500 112" role="img" aria-labelledby={id} className="w-full max-w-xl">
    <title id={id}>Hiring workflow: plan the role, collect evidence, interview independently, then decide together</title>
    <path d="M55 41H445" fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" strokeWidth="2" />
    {["Plan", "Evidence", "Interview", "Decision"].map((label, i) => <g key={label}>
      <circle cx={55 + i * 130} cy="41" r="20" fill="currentColor" className={i === 2 ? "text-indigo-600" : "text-zinc-100 dark:text-zinc-800"} />
      <text x={55 + i * 130} y="46" fill="currentColor" fontSize="13" textAnchor="middle" className={i === 2 ? "text-white" : "text-zinc-700 dark:text-zinc-200"}>{String(i + 1).padStart(2, "0")}</text>
      <text x={55 + i * 130} y="84" fill="currentColor" fontSize="13" textAnchor="middle" className="text-zinc-600 dark:text-zinc-400">{label}</text>
    </g>)}
  </svg>;
}

/** A zero-baseline daily chart; the adjacent table remains the exact-value alternative. */
export function ApplicationsChart({ days }: { days: Array<{ day: string; count: number }> }) {
  const id = useId();
  // An even integer ceiling keeps the midpoint distinct from both ends, including charts with just one applicant.
  const max = Math.max(2, Math.ceil(Math.max(1, ...days.map((d) => d.count)) / 2) * 2);
  const width = 560 / Math.max(days.length, 1);
  return <div>
    <svg viewBox="0 0 600 180" role="img" aria-labelledby={id} className="w-full">
      <title id={id}>{days.reduce((sum, d) => sum + d.count, 0)} applications over {days.length} UTC calendar days. Daily counts are in the table below.</title>
      {[0, 1, 2].map((n) => <g key={n}><path d={`M30 ${20 + n * 65}H590`} stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" fill="none" /><text x="22" y={24 + n * 65} fill="currentColor" fontSize="10" textAnchor="end" className="text-zinc-500">{Math.round(max * (1 - n / 2))}</text></g>)}
      {days.map((d, i) => <rect key={d.day} x={30 + i * width + 2} y={150 - d.count / max * 130} width={Math.max(1, width - 4)} height={d.count / max * 130} rx="2" fill="currentColor" className="text-indigo-500"><title>{d.day}: {d.count} applications</title></rect>)}
      <text x="30" y="174" fill="currentColor" fontSize="10" className="text-zinc-500">{days[0]?.day}</text>
      <text x="590" y="174" fill="currentColor" fontSize="10" textAnchor="end" className="text-zinc-500">{days.at(-1)?.day}</text>
    </svg>
  </div>;
}
