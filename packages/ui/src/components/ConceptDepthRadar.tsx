import { useId } from "react";
import type { DebriefItem, DepthDimension, DepthScores } from "@orbit/types";

export const DEPTH_LABELS: Record<DepthDimension, string> = {
  problem_framing: "Problem framing", technical_depth: "Technical depth", scalability: "System scalability",
  edge_case_rigor: "Edge-case rigor", communication_clarity: "Communication clarity",
};
const dimensions = Object.keys(DEPTH_LABELS) as DepthDimension[];
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
export function aggregateDepth(items: DebriefItem[]): DepthScores {
  return Object.fromEntries(dimensions.map((key) => {
    const values = items.map((item) => (item.attempts.at(-1)?.dimensions ?? item.dimensions)[key]).filter(valid);
    return [key, values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null];
  }));
}

export function ConceptDepthRadar({ scores }: { scores: DepthScores }) {
  const id = useId();
  if (!dimensions.some((key) => valid(scores[key]))) return null;
  const point = (i: number, radius: number) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / 5;
    return [210 + Math.cos(angle) * radius, 145 + Math.sin(angle) * radius] as const;
  };
  const all = dimensions.every((key) => valid(scores[key]));
  return <figure className="glass-panel rounded-2xl p-4" aria-labelledby={`${id}-title`}>
    <figcaption><h3 id={`${id}-title`} className="font-display font-semibold">Concept depth radar</h3>
      <p className="mt-1 text-xs text-zinc-500">Scores 1–5 from this session. Latest retries replace their earlier assessments.</p></figcaption>
    <svg viewBox="0 0 420 305" className="mx-auto w-full max-w-md" role="img" aria-label="Five assessed interview dimensions, scored from one to five">
      {[1, 2, 3, 4, 5].map((level) => <polygon key={level} points={dimensions.map((_, i) => point(i, level * 16).join(",")).join(" ")}
        fill="none" stroke="currentColor" opacity={0.09} />)}
      {dimensions.map((key, i) => {
        const end = point(i, 80); const label = point(i, 112); const value = scores[key];
        return <g key={key}>
          <line x1="210" y1="145" x2={end[0]} y2={end[1]} stroke="currentColor" opacity="0.12" />
          <text x={label[0]} y={label[1]} textAnchor={i === 0 ? "middle" : i < 3 ? "start" : "end"} fontSize="10" fill="currentColor">
            {DEPTH_LABELS[key].split(" ").map((word, j) => <tspan key={j} x={label[0]} dy={j ? 12 : 0}>{word}</tspan>)}
          </text>
          {valid(value) && <circle cx={point(i, value * 16)[0]} cy={point(i, value * 16)[1]} r="4" fill="#38BDF8" />}
        </g>;
      })}
      {all && <polygon points={dimensions.map((key, i) => point(i, scores[key]! * 16).join(",")).join(" ")}
        fill="rgba(56,189,248,0.10)" stroke="#38BDF8" strokeWidth="1.5" />}
    </svg>
    <dl className="grid gap-1 text-xs sm:grid-cols-2">{dimensions.map((key) => <div key={key} className="flex justify-between gap-3">
      <dt className="text-zinc-500">{DEPTH_LABELS[key]}</dt><dd className="telemetry">{valid(scores[key]) ? `${scores[key]} / 5` : "Not assessed"}</dd>
    </div>)}</dl>
  </figure>;
}
