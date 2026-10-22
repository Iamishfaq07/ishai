import { Link } from "react-router-dom";
import type { ApplyCoverageKind } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { ErrorNote } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { missionPath } from "../paths";
import { applyApi } from "./applyApi";

export const COVERAGE: Record<ApplyCoverageKind, { label: string; tone: string }> = {
  auto: { label: "Orbit applies", tone: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" },
  kit: { label: "Ready for you to send", tone: "bg-indigo-500/10 text-indigo-800 dark:text-indigo-200" },
  board: { label: "Apply on the job board", tone: "bg-amber-500/10 text-amber-900 dark:text-amber-200" },
  manual: { label: "Needs the application link", tone: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
};

export const useCoverage = () => useAsync(() => applyApi.applyCoverage(), [], "apply-coverage");

/** What Orbit can send among your tracked jobs, and what each of the rest needs, before anything is prepared. */
export function CoveragePanel() {
  const cov = useCoverage();
  const data = cov.data;
  if (cov.error) return <ErrorNote onRetry={cov.reload}>{errorText(cov.error)}</ErrorNote>;
  if (!data || data.jobs.length === 0) return null;
  const total = data.jobs.length;
  return <section aria-labelledby="coverage-title" className="workspace-panel p-5">
    <h2 id="coverage-title" className="text-lg font-semibold">What Orbit can apply to</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Your {total} open job{total === 1 ? "" : "s"}, by where each application goes.</p>
    <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden>
      {(Object.keys(COVERAGE) as ApplyCoverageKind[]).map((k) => data.counts[k] > 0 && <span key={k} style={{ width: `${(data.counts[k] / total) * 100}%` }}
        className={cx(k === "auto" ? "bg-emerald-500" : k === "kit" ? "bg-indigo-500" : k === "board" ? "bg-amber-500" : "bg-zinc-400")} />)}
    </div>
    <ul className="mt-3 flex flex-wrap gap-2 text-sm">{(Object.keys(COVERAGE) as ApplyCoverageKind[]).map((k) => data.counts[k] > 0 && <li key={k}
      className={cx("rounded-full px-3 py-1 font-medium", COVERAGE[k].tone)}>{data.counts[k]} · {COVERAGE[k].label}</li>)}</ul>
    {!data.hosted && data.counts.kit > 0 && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Employer forms are prepared in full: tailored resume, cover letter and answers. You send each in one sitting.</p>}
    <details className="mt-3">
      <summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-medium", focusRing)}>See each job</summary>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-white/10">{data.jobs.map((j) => <li key={j.entry_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
        <span className="min-w-0 flex-1 basis-60"><Link to={missionPath(j.entry_id)} className={cx("rounded font-medium hover:underline", focusRing)}>{j.title} · {j.company}</Link>
          <span className="block text-[13px] text-zinc-600 dark:text-zinc-400">{j.where} · {j.note}</span></span>
        <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", COVERAGE[j.kind].tone)}>{COVERAGE[j.kind].label}</span>
      </li>)}</ul>
    </details>
  </section>;
}
