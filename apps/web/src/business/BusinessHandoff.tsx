import { useEffect, useId, useRef, useState } from "react";
import { Button, Callout, Field, Input, Select, Textarea, confirmDialog } from "@orbit/ui";
import { candidateBase, staffBase } from "./sabaApi";
import { handoffApi, joiningTasks, type JoiningState, type JoiningTask, type JoiningTaskDraft, type TaskStatus } from "./handoffApi";
import { requestKey, type PendingRequests } from "./requestKey";
import { errorText, Panel } from "./ui";

export function CandidateHandoff({ token, readOnly = false }: { token: string; readOnly?: boolean }) {
  return <Handoff key={token} base={candidateBase(token)} candidate readOnly={readOnly} />;
}
export function CompanyHandoff({ cid, aid, readOnly = false }: { cid: string; aid: string; readOnly?: boolean }) {
  return <Handoff key={`${cid}/${aid}`} base={staffBase(cid, aid)} candidate={false} readOnly={readOnly} />;
}
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const statusLabel = { todo: "To do", blocked: "Blocked", done: "Reported complete" };

function TaskFields({ value, change, prefix }: { value: JoiningTaskDraft; change: (next: JoiningTaskDraft) => void; prefix: string }) {
  return <div className="space-y-3">
    <Field label="Task title" htmlFor={`${prefix}-title`}><Input id={`${prefix}-title`} required minLength={3} maxLength={120} value={value.title} onChange={(e) => change({ ...value, title: e.target.value })} /></Field>
    <Field label="Instructions shared with candidate" htmlFor={`${prefix}-instructions`}><Textarea id={`${prefix}-instructions`} required minLength={12} maxLength={2000} rows={3} value={value.instructions} onChange={(e) => change({ ...value, instructions: e.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Who reports completion?" htmlFor={`${prefix}-owner`}><Select id={`${prefix}-owner`} value={value.owner} onChange={(e) => change({ ...value, owner: e.target.value as JoiningTaskDraft["owner"] })}><option value="team">Hiring team</option><option value="candidate">Candidate</option></Select></Field>
      <Field label="Target date (optional)" htmlFor={`${prefix}-due`}><Input id={`${prefix}-due`} type="date" value={value.due_date ?? ""} onChange={(e) => change({ ...value, due_date: e.target.value || null })} /></Field>
    </div>
  </div>;
}

function TaskRow({ task, writable, save }: { task: JoiningTask; writable: boolean; save: (status: TaskStatus, note: string) => Promise<boolean> }) {
  const id = useId();
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!note && status === task.status) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [note, status, task.status]);
  return <article className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium">{task.title}</h3><span className={`rounded-full px-2 py-1 text-xs ${task.status === "done" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200" : task.status === "blocked" ? "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200" : "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300"}`}>{statusLabel[task.status]}</span></div>
    <p className="text-xs text-zinc-500">Owner: {task.owner === "candidate" ? "Candidate" : "Hiring team"}{task.due_date ? ` · Target: ${dateLabel(task.due_date)}` : ""}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{task.instructions}</p>
    {task.history[0]?.note && <p className="whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-sm dark:bg-white/5">{task.history[0].note}</p>}
    {writable && <details><summary className="cursor-pointer text-sm font-medium">Update your task</summary><form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); setBusy(true); void save(status, note).then((saved) => { if (saved) setNote(""); }).finally(() => setBusy(false)); }}>
      <fieldset disabled={busy} className="space-y-3"><Field label="Task progress" htmlFor={`${id}-status`}><Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}><option value="todo">To do / reopen</option><option value="blocked">Blocked — need help</option><option value="done">Report complete</option></Select></Field>
        <Field label="Progress note" htmlFor={`${id}-note`} hint="Explain blockers or changed arrangements. Keep identity documents, bank details and passwords out of this page."><Textarea id={`${id}-note`} rows={3} required={status !== "done"} minLength={status !== "done" ? 10 : undefined} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field></fieldset>
      <Button type="submit" size="sm" loading={busy}>Save task progress</Button>
    </form></details>}
    {task.history.length > 0 && <details><summary className="cursor-pointer text-xs text-zinc-500">Progress history ({task.history.length})</summary><ol className="mt-3 space-y-3">{task.history.map((entry) => <li key={entry.id} className="border-l-2 border-indigo-200 pl-3 text-sm dark:border-indigo-400/30"><p>{statusLabel[entry.status]} · {entry.by === "candidate" ? "Candidate" : "Hiring team"}</p><time className="text-xs text-zinc-500" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>{entry.note && <p className="whitespace-pre-wrap break-words">{entry.note}</p>}</li>)}</ol></details>}
  </article>;
}

function Handoff({ base, candidate, readOnly }: { base: string; candidate: boolean; readOnly: boolean }) {
  const id = useId();
  const [data, setData] = useState<JoiningState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [introduction, setIntroduction] = useState("Welcome to the team. Review these next steps together and report blockers early. Your formal agreement and the hiring team's confirmation determine your employment arrangements.");
  const [startDate, setStartDate] = useState("");
  const [tasks, setTasks] = useState(joiningTasks);
  const [extra, setExtra] = useState<JoiningTaskDraft>({ title: "", instructions: "", owner: "team", due_date: null });
  const [dirty, setDirty] = useState(false);
  const requests = useRef<PendingRequests>({});
  useEffect(() => {
    let live = true;
    handoffApi.get(base).then((next) => { if (live) setData(next); }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [base]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const refresh = async () => {
    setBusy(true); setError("");
    try { setData(await handoffApi.get(base)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const act = async (action: string, body: object): Promise<boolean> => {
    if (readOnly || !data?.accepting) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await handoffApi.write(base, action, { ...body, request_id: requestKey(requests.current, action, body) });
      setData(next); delete requests.current[action]; setNotice("Joining update saved. Application status has not changed.");
      return true;
    } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!(await confirmDialog({ title: "Share this joining plan?", body: "The candidate can read every task and instruction on this page. The plan and its original tasks remain in the record; later changes can be explained in progress notes or added as new tasks.", confirmLabel: "Share joining plan" }))) return;
    if (await act("", { introduction, start_date: startDate, tasks })) setDirty(false);
  };
  const plan = data?.plan;
  const writable = !!data?.accepting && !readOnly && !busy;
  if (candidate && data && !plan) return null;
  return <Panel title={candidate ? "Your joining plan" : "Joining plan"} hint="Shared steps from an accepted offer to the first day. Progress is reported by each owner; it is not a signed agreement or a verification result."
    actions={<Button variant="secondary" size="sm" disabled={busy} onClick={() => void refresh()}>Refresh joining plan</Button>}>
    {!data && !error && <p role="status" className="text-sm">Loading joining plan…</p>}
    {plan && <div className="space-y-4">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/5"><p className="text-sm font-medium">Joining target: {dateLabel(plan.start_date)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{plan.introduction}</p>
        <label className="mt-4 block text-xs font-medium" htmlFor={`${id}-progress`}>{plan.completed} of {plan.tasks.length} tasks reported complete{plan.blocked ? ` · ${plan.blocked} blocked` : ""}</label><progress id={`${id}-progress`} className="mt-2 h-2 w-full accent-indigo-600" max={plan.tasks.length} value={plan.completed} />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">{plan.tasks.map((task) => <TaskRow key={`${task.id}/${task.revision}`} task={task} writable={writable && task.owner === (candidate ? "candidate" : "team")} save={(status, note) => act(`tasks/${task.id}/progress`, { status, note, base_revision: task.revision })} />)}</div>
      {plan.completed === plan.tasks.length && <Callout tone="success">All tasks are reported complete. Confirm the first-day arrangements with the team. This does not change your hiring status.</Callout>}
      {!candidate && writable && plan.tasks.length < 20 && <details><summary className="cursor-pointer text-sm font-medium">Add a joining task</summary><form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void act("tasks", { ...extra, base_revision: plan.revision }).then((saved) => { if (saved) { setExtra({ title: "", instructions: "", owner: "team", due_date: null }); setDirty(false); } }); }}>
        <TaskFields prefix={`${id}-extra`} value={extra} change={(next) => { setExtra(next); setDirty(true); }} /><Button type="submit" loading={busy}>Add shared task</Button>
      </form></details>}
    </div>}
    {!candidate && data && !plan && (data.eligible && !readOnly ? <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void publish(); }}>
      <fieldset disabled={busy} className="space-y-4"><Field label="Welcome and joining arrangements" htmlFor={`${id}-intro`}><Textarea id={`${id}-intro`} rows={3} minLength={20} maxLength={3000} required value={introduction} onChange={(e) => { setIntroduction(e.target.value); setDirty(true); }} /></Field>
        <Field label="Joining target date" htmlFor={`${id}-start`}><Input id={`${id}-start`} type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); setDirty(true); }} /></Field>
        {tasks.map((task, index) => <div key={index} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"><p className="mb-3 text-sm font-medium">Step {index + 1}</p><TaskFields prefix={`${id}-${index}`} value={task} change={(next) => { setTasks(tasks.map((item, i) => i === index ? next : item)); setDirty(true); }} /></div>)}
      </fieldset><Button type="submit" loading={busy}>Share joining plan</Button>
    </form> : <p className="text-sm text-zinc-500">A joining plan can be shared after an accepted offer summary or when the team confirms the hire.</p>)}
    {data && plan && !data.accepting && <Callout tone="info" className="mt-3">This joining plan is available for reading. Contact the hiring team for changes.</Callout>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <Callout tone="error" className="mt-3">{error} Unsent text remains here. Refresh to review a conflict before retrying.</Callout>}
  </Panel>;
}
