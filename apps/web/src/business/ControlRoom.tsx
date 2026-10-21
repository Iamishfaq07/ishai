import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, Check, ArrowRight, cx, focusRing } from "@orbit/ui";
import { WorkspaceHero, WorkflowAdvice, type WorkflowFact } from "../components/WorkflowWorkspace";
import { api } from "../lib/api";
import { PageTitle, useCompany } from "./BusinessApp";
import { errorText, LoadError, Loading, Panel, Stat } from "./ui";

interface Role {
  id: string; title: string; status: string; path: string; active: number; stalled: number;
  checks: { id: string; label: string; ready: boolean; path: string }[];
  stages: { stage_id: string; name: string; active: number; stalled: number; oldest_days: number }[];
}
interface Room { version: string; jobs: Role[]; capacity: { id: string; name: string; interviews: number; minutes: number }[];
  booked_interviews: number; unassigned_interviews: number; tasks: Record<string, number>; facts: WorkflowFact[]; truncated: boolean; as_of: string }

export function ControlRoom() {
  const { company } = useCompany();
  const [data, setData] = useState<Room | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState("readiness");
  const [query, setQuery] = useState("");
  const live = useRef(false);
  const endpoint = `/v1/business/companies/${encodeURIComponent(company.id)}/control-room`;
  const refresh = useCallback(async () => {
    const next = await api.call<Room>(endpoint);
    if (live.current) { setData(next); setError(null); }
    return next.version;
  }, [endpoint]);
  useEffect(() => {
    live.current = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void refresh().catch((e: unknown) => { if (live.current) setError(e instanceof Error ? e : new Error(errorText(e))); });
    };
    load(); const timer = window.setInterval(load, 60_000); window.addEventListener("focus", load);
    return () => { live.current = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [refresh]);
  if (company.role === "interviewer") return <Callout>The control room is available to recruiting coordinators and assigned hiring managers.</Callout>;
  if (error && !data) return <LoadError error={error} onRetry={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))} />;
  if (!data) return <Loading label="Reading your hiring operations" />;
  const roles = data.jobs.filter((j) => `${j.title} ${j.status}`.toLowerCase().includes(query.toLowerCase()));
  const link = (path: string, label: string) => <Link to={path} className={cx("inline-flex items-center gap-2 rounded text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>{label}<ArrowRight className="h-4 w-4" /></Link>;
  return <div className="space-y-6">
    <PageTitle title="Hiring control room" subtitle="One view of readiness, response delays and panel commitments in the jobs you can access." />
    <WorkspaceHero title="Build a hiring rhythm your team can sustain"
      description="Prepare roles before interviews, spot aging stages and see the next week's booked panel workload. Every signal connects to the workspace where your team can act."
      labels={["Role readiness", "Pipeline response", "Panel capacity"]} />
    {error && <Callout tone="error">{error.message}</Callout>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Roles in view" value={data.jobs.length} detail="Open, draft and paused jobs" />
      <Stat label="Aging applications" value={data.jobs.reduce((sum, j) => sum + j.stalled, 0)} detail="3+ elapsed days in current stage" />
      <Stat label="Booked interviews" value={data.booked_interviews} detail="Next seven days" />
      <Stat label="Open follow-ups" value={data.tasks.open ?? 0} detail="Internal automation tasks" />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Control room views" className="flex flex-wrap gap-2">{[["readiness", "Role readiness"], ["pipeline", "Pipeline signals"], ["capacity", "Panel capacity"]].map(([key, label]) =>
        <Button key={key} variant={tab === key ? "primary" : "secondary"} aria-pressed={tab === key} onClick={() => setTab(key!)}>{label}</Button>)}</nav>
      <Button variant="ghost" onClick={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))}>Refresh signals</Button>
    </div>
    {tab !== "capacity" && <label className="block text-sm font-medium">Find a role<input value={query} onChange={(e) => setQuery(e.target.value)}
      className={cx("mt-2 block w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-zinc-900", focusRing)} placeholder="Search title or status" /></label>}
    {tab === "readiness" && <Panel title="Small checks before the next interview" hint="These are process suggestions. They do not change publishing requirements or score candidates.">
      <div className="grid gap-4 xl:grid-cols-2">{roles.map((job) => <article key={job.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
        <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{job.title}</h3><span className="text-xs text-zinc-500 dark:text-zinc-400">{job.status}</span></div>
        <ul className="mt-4 space-y-3">{job.checks.map((check) => <li key={check.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">{check.ready ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />}{check.label}</span>
          {check.ready ? <span className="text-xs text-zinc-500 dark:text-zinc-400">Ready</span> : <Link className={cx("shrink-0 rounded font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)} to={check.path}>Set up<span className="sr-only"> {check.label} for {job.title}</span></Link>}
        </li>)}</ul><div className="mt-4">{link(job.path, "Open pipeline")}</div>
      </article>)}</div>
      {!roles.length && <p className="text-sm">No matching roles. Create a job or adjust your search.</p>}
    </Panel>}
    {tab === "pipeline" && <Panel title="Where the process is waiting" hint="Confirmed, active applications only. Aging is time in the current stage; it does not imply candidate quality or predict outcomes.">
      <div className="space-y-4">{roles.map((job) => <article key={job.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{job.title}</h3>{link(job.path, "Review stage")}</div>
        {!job.stages.length ? <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No active confirmed applications in this role.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2">{job.stages.map((stage) => <li key={stage.stage_id} className="rounded-lg bg-zinc-100 p-3 dark:bg-white/5">
          <p className="text-sm font-medium">{stage.name}</p><p className="mt-2 text-sm">{stage.active} active · {stage.stalled} aging · oldest {stage.oldest_days} days</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"><div className="h-full bg-amber-500" style={{ width: `${Math.round(stage.stalled / stage.active * 100)}%` }} /></div>
        </li>)}</ul>}
      </article>)}</div>{!roles.length && <p className="text-sm">No matching roles.</p>}
    </Panel>}
    {tab === "capacity" && <Panel title="Booked panel commitments" hint="Next seven days in your visible jobs. This counts scheduled minutes per active panel member; it is not an employee performance measure.">
      {data.unassigned_interviews > 0 && <Callout>{data.unassigned_interviews} booked interviews have no active assigned panel. Review interview assignments before the meeting.</Callout>}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">{data.capacity.map((member) => <li key={member.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
        <h3 className="font-semibold">{member.name}</h3><p className="mt-2 text-sm">{member.interviews} booked interviews · {member.minutes} scheduled minutes</p>
      </li>)}</ul>{!data.capacity.length && <p className="mt-3 text-sm">No booked panel commitments in the next seven days.</p>}
      <div className="mt-4">{link(`/business/app/${company.id}/hiring-desk`, "Open hiring desk")}</div>
    </Panel>}
    <WorkflowAdvice key={company.id} endpoint={`${endpoint}/brief`} version={data.version} facts={data.facts}
      allowance="10 operations advice attempts per company per UTC day" onRefresh={refresh} disabled={company.status !== "active"} />
    {data.truncated && <Callout>Showing the latest 200 visible roles. These totals cover that selection.</Callout>}
    <p className="text-xs text-zinc-500 dark:text-zinc-400">Signals refresh each minute while visible and when you return. Closed jobs and unconfirmed/deleted applications are excluded. Calendar bookings are not completed interviews.</p>
  </div>;
}
