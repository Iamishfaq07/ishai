import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { BizAutomationJob, BizAutomationPreview, BizAutomationRecipe, BizHiringTask, BizTaskAction, BizTaskQueue } from "@orbit/types";
import { Badge, Button, Callout, Field, Input, Select, buttonClass } from "@orbit/ui";
import { PageTitle, useCompany } from "./BusinessApp";
import { automationApi } from "./automationApi";
import { applicationPath, jobPath } from "./model";
import { LoadError, Loading, Panel } from "./ui";

const RULES = [
  { key: "stalled_days", name: "Stalled pipeline", help: "Flag a candidate who has stayed in the same stage.", unit: "days", max: 90, initial: 3 },
  { key: "question_hours", name: "Candidate questions", help: "Follow up on each question still waiting for a reply.", unit: "hours", max: 168, initial: 24 },
  { key: "feedback_hours", name: "Interview feedback", help: "Collect missing panel feedback after the interview ends.", unit: "hours", max: 168, initial: 24 },
  { key: "assessment_hours", name: "Assessment review", help: "Review completed work samples, Saba interviews or alternative requests.", unit: "hours", max: 168, initial: 24 },
  { key: "scheduling_hours", name: "Interview time requests", help: "Reply when a candidate needs different interview times. Off until you enable this rule.", unit: "hours", max: 168, initial: 24 },
  { key: "prep_hours", name: "Interview preparation", help: "Before a booked interview, flag a missing active panel or saved interview criteria. Off until enabled.", unit: "hours", max: 168, initial: 24 },
] as const;
const errorOf = (e: unknown) => e instanceof Error ? e : new Error(String(e));

function RecipeEditor({ job, cid, onSaved }: { job: BizAutomationJob; cid: string; onSaved: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState<BizAutomationRecipe>(job.recipe);
  const [preview, setPreview] = useState<BizAutomationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const { company } = useCompany();
  const edit = (next: BizAutomationRecipe) => { setDraft(next); setPreview(null); setMessage(""); };
  const perform = async (action: "save" | "preview" | "run") => {
    setBusy(true); setError(null); setMessage("");
    try {
      if (action === "preview") setPreview(await automationApi.preview(cid, job.job_id, draft));
      else {
        if (action === "save") await automationApi.save(cid, job.job_id, draft, job.revision);
        else await automationApi.run(cid, job.job_id);
        setMessage(action === "save" ? "Automation settings saved and queue reconciled." : "Queue reconciled using saved settings.");
        onSaved();
      }
    } catch (e) { setError(errorOf(e)); }
    finally { setBusy(false); }
  };
  const disabled = busy || company.status === "suspended";
  return <Panel title="Role playbook" hint="Elapsed calendar time in UTC; weekends are included. Every recipe is optional.">
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void perform("save"); }} className="space-y-4">
      <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" checked={draft.enabled}
        disabled={disabled || job.status !== "open"} onChange={(e) => edit({ ...draft, enabled: e.target.checked })} className="mt-1" />
        Run these automations for {job.title}</label>
      {job.status !== "open" && <p className="text-sm text-zinc-500">Open this job before enabling automation. Pending work pauses while the job is closed or paused.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{RULES.map((rule) => <div key={rule.key} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft[rule.key] !== null} disabled={disabled}
          onChange={(e) => edit({ ...draft, [rule.key]: e.target.checked ? rule.initial : null })} />{rule.name}</label>
        <p className="my-2 text-xs text-zinc-500 dark:text-zinc-400">{rule.help}</p>
        <Field label={`${rule.key === "prep_hours" ? "Prepare before" : "Follow up after"} (${rule.unit})`} htmlFor={`${id}-${rule.key}`}>
          <Input id={`${id}-${rule.key}`} type="number" min={1} max={rule.max} required={draft[rule.key] !== null}
            disabled={disabled || draft[rule.key] === null} value={draft[rule.key] ?? ""}
            onChange={(e) => edit({ ...draft, [rule.key]: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
      </div>)}</div>
      <Field label="Default task owner" htmlFor={`${id}-owner`} hint="Unassigned tasks remain in the shared queue. Changing the default applies to new tasks.">
        <Select id={`${id}-owner`} value={draft.default_assignee_id ?? ""} disabled={disabled}
          onChange={(e) => edit({ ...draft, default_assignee_id: e.target.value || null })}>
          <option value="">Unassigned</option>{job.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={disabled}>Save playbook</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void perform("preview")}>Preview conditions</Button>
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => void perform("run")}>Run saved playbook now</Button></div>
      {preview && <Callout title={`${preview.total} current follow-up conditions`}><p>{preview.description}</p>
        <ul className="mt-2 list-inside list-disc">{Object.entries(preview.counts).map(([kind, n]) => <li key={kind}>{kind}: {n}</li>)}</ul></Callout>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <Callout tone="error">{error.message}</Callout>}
      <p className="text-xs text-zinc-500">Last successful reconciliation: {job.last_run_at ? new Date(job.last_run_at).toLocaleString() : "Not run yet"}.
        {job.recipe.enabled ? " Saved playbook enabled." : " Saved playbook disabled."}</p>
    </form>
  </Panel>;
}

function TaskCard({ task, job, cid, onSaved }: { task: BizHiringTask; job?: BizAutomationJob | undefined; cid: string; onSaved: () => void }) {
  const id = useId();
  const [action, setAction] = useState<BizTaskAction["action"]>(task.status === "done" ? "reopen" : "done");
  const [owner, setOwner] = useState(task.assignee_id ?? "");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { company } = useCompany();
  const overdue = task.status === "open" && Date.parse(task.due_at) < Date.now();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await automationApi.update(cid, task.id, { base_revision: task.revision, action, note,
        ...(action === "assign" ? { assignee_id: owner || null } : {}),
        ...(action === "snooze" ? { until: new Date(until).toISOString() } : {}) });
      setNote(""); onSaved();
    } catch (e) { setError(errorOf(e)); }
    finally { setBusy(false); }
  };
  return <li className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/60">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">
      <h3 className="break-words font-semibold">{task.title}</h3><p className="mt-1 text-sm">{task.name} · {task.job_title}</p>
      <p className="mt-1 text-xs text-zinc-500">{task.reference} · {task.kind === "manual" ? "Custom task" : "Automatic follow-up"}</p>
    </div><Badge tone={overdue ? "warning" : task.status === "done" ? "success" : "neutral"}>{task.status}{overdue ? " · overdue" : ""}</Badge></div>
    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Due {new Date(task.due_at).toLocaleString()} · Owner: {job?.owners.find((o) => o.id === task.assignee_id)?.name ?? (task.assignee_id ? "Former or unavailable coordinator" : "Unassigned")}</p>
    {task.snoozed_until && <p className="mt-1 text-sm">Snoozed until {new Date(task.snoozed_until).toLocaleString()}</p>}
    {task.resolution && <p className="mt-1 text-sm text-zinc-500">{task.resolution}</p>}
    <Link className={`mt-3 ${buttonClass("secondary", "sm")}`} to={applicationPath(cid, task.application_id)}>Open application</Link>
    {task.kind === "prep" && <div className="mt-3 space-y-2"><p className="text-xs text-zinc-600 dark:text-zinc-400">Check the active panel and saved interview criteria. This reminder resolves when the setup is ready or the booking clears.</p>
      <Link className={buttonClass("secondary", "sm")} to={`${jobPath(cid, task.job_id)}/interview-plan`}>Open interview plan</Link></div>}
    {task.actionable && task.status !== "resolved" && company.status !== "suspended" ? <details className="mt-3 text-sm">
      <summary className="cursor-pointer rounded py-1 font-medium focus-visible:outline focus-visible:outline-2">Update task</summary>
      <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-3">
        <Field label="Action" htmlFor={`${id}-action`}><Select id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value as BizTaskAction["action"])}>
          <option value="done">Mark handled</option><option value="snooze">Snooze</option><option value="assign">Assign owner</option><option value="reopen">Reopen</option>
        </Select></Field>
        {action === "assign" && <Field label="Task owner" htmlFor={`${id}-owner`}><Select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Unassigned</option>{job?.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select></Field>}
        {action === "snooze" && <Field label="Snooze until (your local time)" htmlFor={`${id}-until`}><Input id={`${id}-until`} type="datetime-local" required value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
        <Field label="Reason for the audit trail" htmlFor={`${id}-note`}><Input id={`${id}-note`} required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button type="submit" size="sm" loading={busy} disabled={busy}>Save task update</Button>
      </form>
    </details> : !task.actionable && <p className="mt-3 text-xs text-zinc-500">Updates paused: application or job no longer active.</p>}
    {error && <Callout tone="error" className="mt-3">{error.message} Refresh the queue if this task changed.</Callout>}
  </li>;
}

export function AutomationCenter() {
  const { company } = useCompany();
  const [jobs, setJobs] = useState<BizAutomationJob[] | null>(null);
  const [queue, setQueue] = useState<BizTaskQueue | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("open");
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => {
    let live = true;
    setError(null); setQueue(null);
    Promise.all([automationApi.settings(company.id), automationApi.tasks(company.id, status, mine, selected)])
      .then(([s, q]) => { if (live) { setJobs(s.jobs); setQueue(q); } })
      .catch((e: unknown) => { if (live) setError(errorOf(e)); });
    return () => { live = false; };
  }, [company.id, version, status, mine, selected]);
  const refresh = () => setVersion((n) => n + 1);
  const more = async () => {
    if (!queue?.next_after) return;
    setBusy(true); setError(null);
    try {
      const next = await automationApi.tasks(company.id, status, mine, selected, queue.next_after);
      setQueue({ ...next, items: [...queue.items, ...next.items] });
    } catch (e) { setError(errorOf(e)); }
    finally { setBusy(false); }
  };
  if (!company.permissions.move_applicants) return <Callout>Your company role does not have access to hiring automations.</Callout>;
  if (error && !jobs) return <LoadError error={error} onRetry={refresh} />;
  if (!jobs) return <Loading label="Loading hiring automations" />;
  const job = jobs.find((j) => j.job_id === selected);
  return <div className="space-y-5">
    <PageTitle title="Automation center" subtitle="Turn hiring follow-ups into owned work, with a reason behind every change."
      actions={<Button variant="secondary" onClick={refresh}>Refresh queue</Button>} />
    <section className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 dark:border-indigo-400/20 dark:from-indigo-950/60 dark:via-zinc-950 dark:to-cyan-950/30">
      <svg aria-hidden="true" viewBox="0 0 280 80" className="pointer-events-none absolute right-0 top-0 hidden h-28 w-72 opacity-20 sm:block"><path d="M0 40H280" stroke="currentColor" strokeDasharray="4 5" />{[35, 105, 175, 245].map((x) => <g key={x}><circle cx={x} cy="40" r="18" fill="none" stroke="currentColor" /><circle cx={x} cy="40" r="5" fill="currentColor" /></g>)}</svg>
      <div className="relative max-w-2xl"><h2 className="font-semibold">Detect → assign → follow through → resolve</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Saved playbooks run in the background about every five minutes while the API is running. Open conditions create one task per source event. Cleared conditions resolve automatically.</p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Internal tasks only. Candidate decisions and communications stay with your team. Marking a task handled records follow-up work; it does not advance or reject a candidate.</p></div>
    </section>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Open", queue?.counts.open ?? 0], ["Overdue", queue?.overdue ?? 0], ["Snoozed", queue?.counts.snoozed ?? 0], ["Handled", queue?.counts.done ?? 0]].map(([label, count]) => <div key={label} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p></div>)}</div>
    <Panel title="Shared task queue" hint="Counts reflect your selected job and ownership filter. Refresh to pick up background updates.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Job" htmlFor={`${id}-job`}><Select id={`${id}-job`} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">All accessible jobs</option>{jobs.map((j) => <option key={j.job_id} value={j.job_id}>{j.title} · {j.status}</option>)}</Select></Field>
        <Field label="Task status" htmlFor={`${id}-status`}><Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>{["open", "snoozed", "done", "resolved", "all"].map((s) => <option key={s} value={s}>{s === "done" ? "Handled" : s[0]?.toUpperCase() + s.slice(1)}</option>)}</Select></Field>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Assigned to me</label>
      </div>
    </Panel>
    {error && <Callout tone="error">{error.message} <Button variant="ghost" size="sm" onClick={refresh}>Retry queue</Button></Callout>}
    {!queue ? <Loading label="Refreshing tasks" /> : <>
      {queue.items.length ? <ul className="grid items-start gap-4 lg:grid-cols-2">{queue.items.map((t) => <TaskCard key={t.id} task={t} cid={company.id} job={jobs.find((j) => j.job_id === t.job_id)} onSaved={refresh} />)}</ul> : <Panel title="No tasks in this view"><p className="text-sm text-zinc-500">Select a job to configure its playbook, or add a custom follow-up from an application.</p></Panel>}
      {queue.next_after && <Button variant="secondary" loading={busy} onClick={() => void more()}>Load more tasks</Button>}
      <p className="text-xs text-zinc-500">Queue snapshot {new Date(queue.as_of).toLocaleString()}.</p>
    </>}
    {job ? <RecipeEditor key={`${job.job_id}:${job.revision}`} job={job} cid={company.id} onSaved={refresh} /> : <p className="text-sm text-zinc-500">Choose a specific job above to preview or configure its playbook.</p>}
  </div>;
}
