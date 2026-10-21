import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ApplyPlanReport } from "@orbit/types";
import { buttonClass, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { useJobsAi } from "../JobsAi";
import { applyApi } from "./applyApi";
import { ATS_LABEL, sendsItself } from "./model";
import { PlanSummary } from "./Setup";
import { FormAgent } from "./FormAgent";

export function AgentConsole({ onChanged }: { onChanged: () => void }) {
  const setup = useAsync(() => applyApi.getApplySetup(), [], "apply-setup");
  const status = useAsync(() => applyApi.applyStatus(), [], "apply-status");
  const { tracker } = useJobsAi();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ApplyPlanReport | null>(null);
  const s = setup.data;
  const reloadSetup = setup.reload, reloadStatus = status.reload;
  const saved = (tracker.data ?? []).filter((j) => j.status === "saved" && j.live);
  const chosen = selected.filter((id) => saved.some((j) => j.listing_id === id));
  useEffect(() => {
    const timer = window.setInterval(() => { reloadSetup(); reloadStatus(); onChanged(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [reloadSetup, reloadStatus, onChanged]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null); setReport(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "created" in result) setReport(result as ApplyPlanReport);
      setup.reload(); status.reload(); tracker.reload(); onChanged();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const ready = !!s?.configured && !s.paused;
  const hosted = s?.execution === "hosted" && !!s.hosted_enabled;
  return <section aria-label="Application agent controls" className="space-y-4">
    <Card className="p-5">
      <h2 className="text-xl font-semibold">Approve once. Follow every step.</h2>
      <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">Orbit finds matches, prepares truthful materials, sends eligible applications within your limits, and records the result. Questions and employer checks return to you.</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {[["Sending", !s ? "Loading…" : hosted ? "Orbit sends for you" : sendsItself(s) ? "Connected browser" : "You send · kit ready"],
          ["Status", !s ? "Loading…" : !s.configured ? "Setup needed" : s.paused ? "Paused" : hosted ? s.hosted_online ? "Running" : "Starting up · applications wait" : "Running"],
          ["Today", status.data ? `${status.data.today} / ${status.data.limit} applications` : "Loading…"]].map(([label, value]) =>
          <div key={label} className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 text-sm font-semibold"><span role={label === "Status" ? "status" : undefined}>{value}</span></dd></div>)}
      </dl>
      <p className="mt-4 text-sm">{hosted ? "Your device can be off. Logins, human checks and unknown attestations come back to you."
        : s && sendsItself(s) ? "Your connected browser sends external applications while it is open."
        : "Orbit Business applications are sent for you. Other employer applications wait in Needs you with answers and a tailored resume, ready to send. Nothing to install."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button loading={busy} disabled={!ready} onClick={() => void run(applyApi.planApplications)}>Find and prepare matches</Button>
        <Button variant="secondary" loading={busy} disabled={!s?.configured} onClick={() => void run(s?.paused ? applyApi.resumeApply : applyApi.pauseApply)}>{s?.paused ? "Resume agent" : "Pause agent"}</Button>
        <Link to="/jobs/applications" className={buttonClass("secondary", "md")}>Needs you & receipts</Link>
      </div>
      {status.data && status.data.sites_paused.length > 0 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Temporarily paused: {status.data.sites_paused.map((site) => ATS_LABEL[site] ?? site).join(", ")}.</p>}
      {setup.error && <ErrorNote onRetry={setup.reload}>{errorText(setup.error)}</ErrorNote>}
      {status.error && <ErrorNote onRetry={status.reload}>{errorText(status.error)}</ErrorNote>}
    </Card>
    {/* AI help for unfamiliar form fields runs inside the hosted worker only. */}
    {s?.hosted_enabled && <FormAgent eligible={!!(ready && s.execution === "hosted")} onChanged={onChanged} />}
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Send your shortlist to the agent</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Save jobs in Matches, then choose up to 20 here. Your approved filters, match threshold, freshness rules and application limits still apply. In automatic mode eligible packets can be sent; review mode waits for approval.</p>
      {tracker.error && <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>}
      {tracker.loading && !tracker.data ? <p className="mt-4 text-sm">Loading saved jobs…</p> : saved.length === 0 ? <p className="mt-4 text-sm">No live saved jobs yet. <Link to="/jobs/matches" className="text-indigo-700 underline dark:text-indigo-300">Find and save matches</Link>.</p> :
        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{saved.map((job) => <label key={job.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
          <input type="checkbox" className={focusRing} checked={chosen.includes(job.listing_id)} disabled={busy || (!chosen.includes(job.listing_id) && chosen.length >= 20)} onChange={(e) => setSelected(e.target.checked ? [...chosen, job.listing_id] : chosen.filter((id) => id !== job.listing_id))} />
          <span className="min-w-0 text-sm"><span className="block font-semibold">{job.title}</span><span className="text-zinc-500">{job.company}</span></span>
        </label>)}</div>}
      <Button className="mt-4" loading={busy} disabled={!ready || chosen.length === 0} onClick={() => void run(() => applyApi.planShortlist(chosen))}>Prepare selected ({chosen.length}/20)</Button>
    </Card>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}{report && <PlanSummary report={report} />}</div>
  </section>;
}
