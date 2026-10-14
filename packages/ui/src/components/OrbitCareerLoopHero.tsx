import { useId } from "react";
import { useMotion } from "../hooks/useMotion";
import { focusRing } from "./cx";

export interface CareerLinks { jobs: string; resume: string; practice: string; coding: string }
const nodes = [
  { key: "jobs", x: 110, y: 95, title: "Orbit Jobs AI", detail: "Discover & match", number: "01" },
  { key: "resume", x: 490, y: 95, title: "Orbit Resume AI", detail: "Tailor & stress-test", number: "02" },
  { key: "practice", x: 490, y: 295, title: "Orbit Practice", detail: "Role & company mock", number: "03" },
  { key: "coding", x: 110, y: 295, title: "Coding & desktop", detail: "Live workspace", number: "04" },
] as const;

export function OrbitCareerLoopHero({ links }: { links: CareerLinks }) {
  const id = useId().replace(/:/g, "");
  const motion = useMotion();
  return <section aria-label="Orbit career preparation loop" className="glass-panel overflow-hidden rounded-3xl px-2 py-4 sm:px-6">
    <div className="px-4 pt-2"><p className="telemetry text-xs uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">Your next move</p>
      <h2 className="mt-1 font-display text-xl font-semibold">One job. A complete preparation loop.</h2></div>
    <div className="grid grid-cols-2 gap-3 px-3 py-5 sm:hidden">{nodes.map((node) => <a key={node.key}
      href={links[node.key]} className={`rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 ${focusRing}`}>
      <span className="telemetry text-xs text-cyan-700 dark:text-cyan-300">{node.number}</span>
      <span className="mt-2 block text-sm font-semibold">{node.title}</span>
      <span className="mt-1 block text-xs text-zinc-500">{node.detail}</span>
    </a>)}</div>
    <svg viewBox="0 0 600 390" className="mx-auto hidden w-full max-w-3xl sm:block" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>Discover jobs, tailor your resume, practise, and open the live coding workspace</title>
      <defs><linearGradient id={`${id}-gradient`}><stop stopColor="#38BDF8" /><stop offset="1" stopColor="#6366F1" /></linearGradient></defs>
      <path d="M110 95 C225 -5 375 -5 490 95 C605 150 605 240 490 295 C375 390 225 390 110 295 C-5 240 -5 150 110 95Z"
        fill="none" stroke={`url(#${id}-gradient)`} strokeOpacity="0.22" strokeWidth="1.5" />
      <path className={motion === "full" ? "career-telemetry-flow" : undefined}
        d="M110 95 C225 -5 375 -5 490 95 C605 150 605 240 490 295 C375 390 225 390 110 295 C-5 240 -5 150 110 95Z"
        fill="none" stroke={`url(#${id}-gradient)`} strokeWidth="2" strokeDasharray="5 105" />
      {nodes.map((node) => <g key={node.key}>
        <path d={`M${node.x} ${node.y} L300 195`} stroke="currentColor" opacity="0.1" strokeDasharray="3 5" />
        <a href={links[node.key]} className={focusRing} aria-label={`${node.title}: ${node.detail}`}>
          <rect x={node.x - 97} y={node.y - 38} width="194" height="76" rx="18" className="fill-white dark:fill-[#0B101E]" stroke={`url(#${id}-gradient)`} strokeOpacity="0.4" />
          <text x={node.x - 77} y={node.y - 15} fontSize="10" className="telemetry fill-cyan-700 dark:fill-cyan-300">{node.number}</text>
          <text x={node.x} y={node.y + 1} textAnchor="middle" fontSize="14" fontWeight="600" className="fill-zinc-900 dark:fill-zinc-100">{node.title}</text>
          <text x={node.x} y={node.y + 22} textAnchor="middle" fontSize="11" className="fill-zinc-500 dark:fill-zinc-400">{node.detail}</text>
        </a>
      </g>)}
      <circle cx="300" cy="195" r="33" fill={`url(#${id}-gradient)`} fillOpacity="0.12" stroke={`url(#${id}-gradient)`} />
      <ellipse cx="300" cy="195" rx="48" ry="19" fill="none" stroke={`url(#${id}-gradient)`} transform="rotate(-25 300 195)" />
      <circle cx="300" cy="195" r="7" fill={`url(#${id}-gradient)`} />
    </svg>
  </section>;
}
