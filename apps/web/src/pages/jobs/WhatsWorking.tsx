import { cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

interface Stats { applied: number; heard_back: number; interviews: number; enough: boolean; response_rate: number | null; interview_rate: number | null }
interface Performance {
  applied: number; min_sample: number; no_resume_recorded: number;
  by_resume: (Stats & { resume_id: string; title: string })[]; tailored: Stats; general: Stats;
}

function Rates({ s, min }: { s: Stats; min: number }) {
  if (!s.applied) return <span className="text-zinc-500">none yet</span>;
  if (!s.enough) return <span className="text-zinc-600 dark:text-zinc-400">{s.applied} applied · too few to compare (needs {min})</span>;
  return <span><span className="tabular-nums">{s.applied}</span> applied · <span className="font-medium tabular-nums">{s.response_rate}%</span> heard back · <span className="font-medium tabular-nums">{s.interview_rate}%</span> interviews</span>;
}

/**
 * What's working (GET /v1/jobs/resume-performance): how applications did by the resume sent, and tailored copies
 * against general ones, from what the candidate recorded. Small groups are labelled too few to compare.
 */
export function WhatsWorking({ revision = 0 }: { revision?: number }) {
  const state = useAsync(() => api.call<Performance>("/v1/jobs/resume-performance"), [revision], `resume-performance|${revision}`);
  const d = state.data;
  if (!d || d.applied < 3 || !d.by_resume.length) return null;
  return <details className="workspace-panel p-5">
    <summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>What’s working: results by resume</summary>
    <p className="mt-2 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">From the {d.applied} applications you recorded. Heard back means any reply you logged, including a no. Patterns firm up after about {d.min_sample} applications per group; employers decide for many reasons, so read these as hints, not proof.</p>
    <ul className="mt-4 divide-y divide-zinc-200 text-sm dark:divide-white/10">{d.by_resume.map((r) => <li key={r.resume_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span className="min-w-0 break-words font-medium">{r.title}</span><Rates s={r} min={d.min_sample} /></li>)}</ul>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><dt className="font-medium">Tailored for the job</dt><dd className="mt-1"><Rates s={d.tailored} min={d.min_sample} /></dd></div>
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><dt className="font-medium">General resume</dt><dd className="mt-1"><Rates s={d.general} min={d.min_sample} /></dd></div>
    </dl>
    {d.no_resume_recorded > 0 && <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">{d.no_resume_recorded} applied {d.no_resume_recorded === 1 ? "job has" : "jobs have"} no resume linked, so {d.no_resume_recorded === 1 ? "it isn’t" : "they aren’t"} counted by resume. Link one from the job’s Resume tab.</p>}
  </details>;
}
