import { Link } from "react-router-dom";
import { cx, focusRing } from "@orbit/ui";
import { ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { missionPath } from "./paths";

interface Skill { skill: string; jobs: number; examples: { id: string; title: string; company: string }[] }
interface Gaps { jobs: number; resume: string | null; has_resume: boolean; coverage: number | null; missing: Skill[]; shown: Skill[] }

const link = cx("rounded font-medium underline underline-offset-4", focusRing);

/**
 * The skills the whole shortlist asks for (GET /v1/jobs/skill-gaps): which ones the resume shows, and which ones it
 * doesn't, by how many tracked jobs ask. Not shown means not on the resume; the candidate may still have it.
 */
export function ShortlistSkills({ revision = 0 }: { revision?: number }) {
  const state = useAsync(() => api.call<Gaps>("/v1/jobs/skill-gaps"), [revision], `skill-gaps|${revision}`);
  const data = state.data;
  if (state.error && !data) return <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>;
  if (!data || data.jobs < 2) return null; // one job is a fit check, not a pattern
  return <details className="workspace-panel p-5">
    <summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>
      Skills your shortlist asks for{data.coverage !== null ? ` · ${data.coverage}% shown on your resume` : ""}
    </summary>
    <p className="mt-2 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">Across {data.jobs} active jobs{data.resume ? `, checked against “${data.resume}” and your profile skills` : ""}. A skill your resume doesn’t show might still be one you have: add the evidence if so. If it keeps coming up and you don’t, it’s a good next skill to build.</p>
    {!data.has_resume && <p className="mt-2 text-sm">Add a resume to see which of these it already shows. <Link className={link} to="/career">Open My Career</Link></p>}
    {data.missing.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Not shown on your resume</h3>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-white/10">{data.missing.map((s) => <li key={s.skill} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
        <span className="min-w-0"><span className="font-medium">{s.skill}</span> <span className="text-zinc-600 dark:text-zinc-400">· asked by {s.jobs} {s.jobs === 1 ? "job" : "jobs"}</span>
          <span className="block text-xs text-zinc-600 dark:text-zinc-400">{s.examples.map((e, i) => <span key={e.id}>{i ? ", " : ""}<Link className={link} to={missionPath(e.id)}>{e.company}</Link></span>)}</span></span>
        <Link className={cx(link, "text-xs")} to="/resume-ai">Add evidence if you have it</Link>
      </li>)}</ul></div>}
    {data.shown.length > 0 && <p className="mt-4 text-sm"><span className="font-semibold">Already shown: </span>{data.shown.map((s) => `${s.skill} (${s.jobs})`).join(", ")}</p>}
  </details>;
}
