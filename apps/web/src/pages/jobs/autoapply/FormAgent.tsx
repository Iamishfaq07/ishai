import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ApplyAgentState } from "@orbit/types";
import { Button, Card, ErrorNote } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { applyApi } from "./applyApi";
import { STATUS_LABEL } from "./model";

const STATE: Record<ApplyAgentState["applications"][number]["decisions"][number]["state"], string> = {
  observing: "Observation reserved", matched: "Profile match proposed", needs_you: "Uncertain · needs you",
  cancelled: "Stopped · permissions or application changed", allowance_used: "Daily AI allowance reached",
  unavailable: "AI unavailable · needs you",
};

export function FormAgent({ eligible, onChanged }: { eligible: boolean; onChanged: () => void }) {
  const state = useAsync(applyApi.getAgent, [], "apply-agent");
  const reload = state.reload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = state.data;
  useEffect(() => {
    const timer = window.setInterval(reload, 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  async function toggle() {
    if (!data) return;
    setBusy(true); setError(null);
    try { await applyApi.setAgent(!data.enabled); reload(); onChanged(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <Card className="overflow-hidden border-indigo-200 p-5 dark:border-indigo-500/30">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-12 w-12 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="12" y="15" width="24" height="21" rx="6" /><path d="M24 9v6M19 25h.01M29 25h.01M19 30h10M7 23v6M41 23v6" strokeLinecap="round" />
          <circle cx="24" cy="8" r="2" />
        </svg>
        <div><h2 className="text-xl font-semibold">Agent mode</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">Let AI help the application worker understand unfamiliar contact and profile text fields. It chooses an approved profile fact; Orbit copies the saved value and continues the form.</p>
        </div>
      </div>
      <Button variant={data?.enabled ? "secondary" : "primary"} loading={busy} disabled={!data || (!eligible && !data.enabled)} aria-pressed={data?.enabled ?? false} onClick={() => void toggle()}>
        {data?.enabled ? "Turn off agent mode" : "Turn on agent mode"}
      </Button>
    </div>
    <ol className="my-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="How agent mode applies">
      {[["Observe", "Read the employer form"], ["Match", "AI selects an approved fact"], ["Act", "Fill within your permissions"], ["Confirm", "Save the employer receipt"]].map(([title, detail], i) =>
        <li key={title} className="rounded-xl bg-indigo-50/70 p-3 dark:bg-indigo-500/5"><span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{i + 1} · {title}</span><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{detail}</p></li>)}
    </ol>
    <p className="text-sm">Works with your hosted queue while your browser is closed. Review first waits for your approval. Login, CAPTCHA, employer checks and unknown screening answers return to you.</p>
    <details className="mt-3 text-sm"><summary className="min-h-8 cursor-pointer font-medium">Supported sites and agent limits{data ? ` · ${data.used_today}/${data.daily_allowance} AI calls today` : ""}</summary>
      <p className="mt-2 text-xs text-zinc-500">Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee. The hosted worker must be online.</p>
      <p className="mt-2 text-xs text-zinc-500">AI cannot invent answers, accept agreements or choose diversity answers. Up to 3 observations per application and {data?.daily_allowance ?? 5} AI calls per day, resetting at midnight UTC. Failed calls count. Turning this off leaves standard hosted applying available; use Pause agent to stop applications.</p>
    </details>
    {!eligible && !data?.enabled && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">To enable: configure hosted execution, approve your resume, give hosted consent and resume applying. <Link to="/jobs/auto-apply" className="underline">Open setup</Link>.</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {state.error && <ErrorNote onRetry={reload}>{errorText(state.error)}</ErrorNote>}
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-white/10">
      <h3 className="font-semibold">Agent decision history</h3>
      <p className="mt-1 text-xs text-zinc-500">Profile matches are preparation steps. Only an employer confirmation marks an application submitted.</p>
      {state.loading && !data ? <p className="mt-3 text-sm">Loading agent history…</p> : data?.applications.length ?
        <ul className="mt-3 space-y-3">{data.applications.map((job) => <li key={job.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
          <div className="flex flex-wrap justify-between gap-2"><Link className="text-sm font-semibold text-indigo-700 underline dark:text-indigo-300" to={`/jobs/applications?packet=${encodeURIComponent(job.id)}`}>{job.title} · {job.company}</Link><span className="text-xs text-zinc-500">{STATUS_LABEL[job.status] ?? job.status}</span></div>
          <details className="mt-2 text-sm"><summary className="min-h-8 cursor-pointer">View {job.decisions.length} agent observation{job.decisions.length === 1 ? "" : "s"}</summary>
            <ol className="space-y-3 border-l-2 border-indigo-200 pl-3 dark:border-indigo-500/30">{job.decisions.map((decision, index) => <li key={`${decision.at}-${index}`}>
              <p className="font-medium">{STATE[decision.state]}{decision.provider === "mock" ? " · simulated AI" : ""}</p>
              <time className="text-xs text-zinc-500" dateTime={decision.at}>{new Date(decision.at).toLocaleString()}</time>
              <ul className="mt-1 list-inside list-disc text-xs">{decision.matches.length ? decision.matches.map((match) => <li key={match.label}>{match.label} → approved {match.source.replaceAll("_", " ")}</li>) : decision.questions.map((question) => <li key={question}>{question}</li>)}</ul>
            </li>)}</ol>
          </details>
        </li>)}</ul> : <p className="mt-3 text-sm text-zinc-500">No AI observations yet. The worker uses exact matches first, then asks the agent about eligible unfamiliar fields when agent mode is on.</p>}
    </div>
  </Card>;
}
