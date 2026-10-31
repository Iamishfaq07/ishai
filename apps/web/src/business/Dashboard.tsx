// Orbit for Business (D82): the company dashboard: open jobs, applicants, where they came from, how fast the team
// first answers them, and each job's funnel.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BizCompanyAnalytics } from "@orbit/types";
import { Briefcase, Plus, Table, THead, Td, Th, Tr, buttonClass, cx, focusRing } from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import { ApplicationsChart } from "./HiringGraphics";
import { companyPath, jobPath } from "./model";
import { Loading, LoadError, Panel, Stat } from "./ui";
import { BusinessWorkspaceHero, BusinessWorkspaceShortcuts } from "./WorkspaceIllustration";

const SOURCE_LABEL: Record<string, string> = {
  careers: "Careers page",
  widget: "Your website (widget)",
  orbit: "Orbit job seekers",
  google: "Google",
  linkedin: "LinkedIn",
  direct: "Direct link",
  other: "Other",
};

/** " · first reply 3 h", or " · no replies yet": the stat as it reads after an applicant count. */
export function firstReply(h: number | null): string {
  return h === null ? " · no replies yet" : ` · first reply ${hours(h).toLowerCase()}`;
}

export function hours(h: number | null): string {
  if (h === null) return "No replies yet";
  if (h < 1) return "Under an hour";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export function SourceTable({ bySource, total }: { bySource: Record<string, number>; total: number }) {
  const rows = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <p className="text-sm text-zinc-600 dark:text-zinc-400">No applicants yet.</p>;
  return (
    <Table label="Applicants by source" dense>
      <THead>
        <tr>
          <Th>Source</Th>
          <Th className="text-right">Applicants</Th>
          <Th className="text-right">Share</Th>
        </tr>
      </THead>
      <tbody>
        {rows.map(([source, n]) => (
          <Tr key={source}>
            <Td><span className="block">{SOURCE_LABEL[source] ?? source}</span><div aria-hidden="true" className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${total > 0 ? Math.min(100, n / total * 100) : 0}%` }} /></div></Td>
            <Td className="text-right tabular-nums">{n}</Td>
            <Td className="text-right tabular-nums">{total ? Math.round((n / total) * 100) : 0}%</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Dashboard() {
  const { company } = useCompany();
  const [data, setData] = useState<BizCompanyAnalytics | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (company.role === "interviewer") return;
    setData(null); setError(null);
    biz.analytics(company.id).then((d) => { if (live) setData(d); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { live = false; };
  }, [company.id, company.role, n]);
  const actions = company.permissions.manage_jobs ? (
    <Link to={companyPath(company.id, "jobs/new")} className={buttonClass("primary")}>
      <Plus className="h-4 w-4" aria-hidden /> New job
    </Link>
  ) : undefined;
  return (
    <div className="space-y-5">
      <PageTitle title="Dashboard" subtitle={`${company.name}'s hiring at a glance.`} actions={actions} />
      <BusinessWorkspaceHero />
      {company.role === "interviewer" ? <Panel title="Your interview workspace" hint="Company-wide analytics are available to recruiting coordinators. Open your assigned interview work to review evidence and record scorecards."><Link to={companyPath(company.id, "hiring-desk")} className={buttonClass("secondary")}>Open assigned interview work</Link></Panel> : error ? (
        <LoadError error={error} onRetry={() => setN((x) => x + 1)} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
            <section aria-label="Hiring metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Open jobs" value={data.open_jobs} />
            <Stat label="Applicants" value={data.applicants_total} />
            <Stat label="Last 30 days" value={data.applicants_30d} />
            <Stat label="Hired" value={data.hired} />
              <Stat label="Withdrawn" value={data.withdrawn} />
            <Stat label="Time to first reply" value={<span className="text-base">{hours(data.median_first_response_hours)}</span>} detail="Median, from applying to the team's first move" />
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Where applicants come from">
              <SourceTable bySource={data.by_source} total={data.applicants_total} />
            </Panel>
            <Panel title="Applicants per day" hint="Today and the previous 29 UTC calendar days.">
              <ApplicationsChart days={data.daily} />
              {data.daily.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">No applicants in the last 30 days.</p>
              ) : (
                <details><summary className="mt-2 cursor-pointer text-sm font-medium">Daily counts</summary><div className="mt-3 max-h-64 overflow-y-auto">
                  <Table label="Applicants per day" dense>
                    <THead>
                      <tr>
                        <Th>Day</Th>
                        <Th className="text-right">Applicants</Th>
                      </tr>
                    </THead>
                    <tbody>
                      {[...data.daily].reverse().map((d) => (
                        <Tr key={d.day}>
                          <Td>{new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Td>
                          <Td className="text-right tabular-nums">{d.count}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div></details>
              )}
            </Panel>
          </div>
          <Panel title="Jobs" hint="How far applicants get in each job's stages.">
            {data.jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-white/20 dark:bg-white/[0.02] sm:p-9">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-indigo-700 dark:border-white/10 dark:bg-zinc-900 dark:text-indigo-300"><Briefcase className="h-7 w-7" aria-hidden="true" /></span>
                <h3 className="mt-4 text-lg font-semibold">Your next role starts here.</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{company.permissions.manage_jobs ? "Draft a role, agree on the requirements and bring your team into the process. Your pipeline will appear here when a job is created." : "Jobs you can access will appear here. Ask your recruiting team to assign you to the relevant work."}</p>
                {actions && <div className="mt-5 flex justify-center">{actions}</div>}
              </div>
            ) : (
              <div className="space-y-4">
                {data.jobs.map((j) => (
                  <div key={j.job_id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link to={jobPath(company.id, j.job_id)} className={cx("rounded font-medium hover:underline", focusRing)}>
                        {j.title}
                      </Link>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        {j.applicants} {j.applicants === 1 ? "applicant" : "applicants"}{j.applicants > 0 ? firstReply(j.median_first_response_hours) : ""}
                      </span>
                    </div>
                    <ol className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3" aria-label={`${j.title}: applicants who reached each stage`}>
                      {j.funnel.map((f) => (
                        <li key={f.stage_id} className="rounded-xl bg-zinc-50 p-3 tabular-nums dark:bg-white/5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{f.name}</span><span><strong>{f.reached}</strong> ({Math.round(f.rate * 100)}%)</span></div><div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, f.rate * 100))}%` }} /></div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
      <BusinessWorkspaceShortcuts />
    </div>
  );
}
