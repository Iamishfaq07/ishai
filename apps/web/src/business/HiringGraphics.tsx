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
      return <circle key={i} cx="66" cy="66" r="49" fill="none" strokeWidth="7"
        className={cx("motion-safe:transition-[stroke] motion-safe:duration-quick", i < assessed ? "stroke-indigo-500" : "stroke-zinc-200 dark:stroke-zinc-700")}
        strokeDasharray={`${Math.max(length - 5, 1)} ${2 * Math.PI * 49 - Math.max(length - 5, 1)}`}
        transform={`rotate(${-90 + i * 360 / count} 66 66)`} />;
    })}
    <text x="66" y="64" textAnchor="middle" className="fill-zinc-900 text-[25px] font-semibold dark:fill-zinc-100">{assessed}<tspan className="fill-zinc-500 text-[14px]">/{total}</tspan></text>
    <text x="66" y="84" textAnchor="middle" className="fill-zinc-500 text-[10px]">observed</text>
  </svg>;
}

export function HiringLoopGraphic() {
  const id = useId();
  return <svg viewBox="0 0 500 112" role="img" aria-labelledby={id} className="w-full max-w-xl">
    <title id={id}>Hiring workflow: plan the role, collect evidence, interview independently, then decide together</title>
    <path d="M55 41H445" fill="none" className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth="2" />
    {["Plan", "Evidence", "Interview", "Decision"].map((label, i) => <g key={label}>
      <circle cx={55 + i * 130} cy="41" r="20" className={i === 2 ? "fill-indigo-600" : "fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-600"} />
      <text x={55 + i * 130} y="46" textAnchor="middle" className={i === 2 ? "fill-white text-[13px]" : "fill-zinc-700 text-[13px] dark:fill-zinc-200"}>{String(i + 1).padStart(2, "0")}</text>
      <text x={55 + i * 130} y="84" textAnchor="middle" className="fill-zinc-600 text-[13px] dark:fill-zinc-400">{label}</text>
    </g>)}
  </svg>;
}

/** A zero-baseline daily chart; the adjacent table remains the exact-value alternative. */
export function ApplicationsChart({ days }: { days: Array<{ day: string; count: number }> }) {
  const id = useId();
  const max = Math.max(1, ...days.map((d) => d.count));
  const width = 560 / Math.max(days.length, 1);
  return <div>
    <svg viewBox="0 0 600 180" role="img" aria-labelledby={id} className="w-full">
      <title id={id}>{days.reduce((sum, d) => sum + d.count, 0)} applications over {days.length} UTC calendar days. Daily counts are in the table below.</title>
      {[0, 1, 2].map((n) => <g key={n}><path d={`M30 ${20 + n * 65}H590`} className="stroke-zinc-200 dark:stroke-zinc-700" fill="none" /><text x="22" y={24 + n * 65} textAnchor="end" className="fill-zinc-500 text-[10px]">{Math.round(max * (1 - n / 2))}</text></g>)}
      {days.map((d, i) => <rect key={d.day} x={30 + i * width + 2} y={150 - d.count / max * 130} width={Math.max(1, width - 4)} height={d.count / max * 130} rx="2" className="fill-indigo-500"><title>{d.day}: {d.count} applications</title></rect>)}
      <text x="30" y="174" className="fill-zinc-500 text-[10px]">{days[0]?.day}</text>
      <text x="590" y="174" textAnchor="end" className="fill-zinc-500 text-[10px]">{days.at(-1)?.day}</text>
    </svg>
  </div>;
}
