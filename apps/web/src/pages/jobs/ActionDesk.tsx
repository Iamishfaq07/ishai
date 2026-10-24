import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Button, Callout, Sparkles, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import { shortDate } from "./model";
import { PlaybookEditor } from "./PlaybookEditor";

interface Action {
  id: string; kind: "interview" | "follow_up" | "contact" | "application" | "preparation";
  title: string; detail: string; due_at: string | null; overdue: boolean; path: string;
  rule?: keyof typeof RULE_NAMES;
  action_label?: string; priority_reason?: string;
}
const RULE_NAMES = {
  application_follow_up: "Application follow-up", interview_preparation: "Interview preparation",
  interview_thank_you: "Thank-you note", application_quiet: "Quiet application", saved_job_decision: "Saved job",
  commitment: "Promise to keep", after_rejection: "After a no", wrap_up: "Wrap up your search", find_contacts: "Find who's hiring",
} as const;
interface Queue { version: string; items: Action[]; focus_id?: string | null; truncated: boolean; as_of: string; horizon_days: number }
interface Brief { version: string; source: "ai" | "mock"; steps: { action_id: string; source_quote: string; suggestion: string }[] }

/** The due-in-seven-days queue. `embedded` (on Today): the companion above already names one next step, so every
 *  saved action is listed alike instead of a second "Start here" card. */
export function JobActionDeskPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [load, setLoad] = useState(0);
  const [filter, setFilter] = useState("all");
  const [savedRules, setSavedRules] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      api.call<Queue>("/v1/jobs/actions").then((next) => {
        if (!live) return;
        setQueue(next); setError(null);
        setBrief((old) => old?.version === next.version ? old : null);
      }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  const generate = async () => {
    if (!queue) return;
    setBusy(true); setError(null); setBrief(null);
    try {
      const result = await api.call<Brief>("/v1/jobs/actions/brief", { method: "POST", body: JSON.stringify({ version: queue.version }) });
      // Verify against the latest source after generation, including changes made in other tabs.
      const latest = await api.call<Queue>("/v1/jobs/actions");
      setQueue(latest);
      if (latest.version === result.version) setBrief(result);
      else setError("Your action queue changed. Generate a fresh brief from the updated records.");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const focus = filter === "all" && !embedded ? queue?.items.find((item) => item.id === queue.focus_id) : null;
  const visible = queue?.items.filter((a) => a.id !== focus?.id && (filter === "all" || (filter === "overdue" ? a.overdue : filter === "playbook" ? !!a.rule : a.kind === filter))) ?? [];
  const exportCalendar = async () => {
    try {
      const { agendaIcs } = await import("./agenda");
      downloadText("orbit-next-seven-days.ics", agendaIcs(queue?.items ?? []), "text/calendar;charset=utf-8");
    } catch (e) { setError(errorText(e)); }
  };
  return <div className="space-y-6">
    <header><h2 id="needs-attention" className="text-lg font-semibold">Needs your attention</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Interviews, follow-ups and applications to review in the next seven days. Updates every minute from your saved records.</p>
      {queue && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{queue.truncated ? "Showing the first " : ""}{queue.items.length} saved {queue.items.length === 1 ? "action" : "actions"}{queue.truncated ? "; more in your workspaces" : ""}. Choose any action that fits your priorities.</p>}
    </header>
    {focus && <section aria-label="Recommended next action" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-400/30 dark:bg-indigo-500/10">
      <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">Start here</p>
      <h3 className="mt-2 break-words font-display text-lg font-semibold">{focus.title}</h3>
      <p className="mt-2 text-sm font-medium">{focus.priority_reason}</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{focus.detail}</p>
      {focus.rule && <p className="mt-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Your playbook · {RULE_NAMES[focus.rule]}</p>}
      {focus.due_at && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Saved date: {shortDate(focus.due_at)}{focus.overdue ? " · Past due" : ""}</p>}
      <Link to={focus.path} className={cx("mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700", focusRing)}>
        {focus.action_label ?? "Open workspace"}<ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>}
    {savedRules && <p role="status" className="text-sm">Workflow rules saved.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void generate()} loading={busy} disabled={!queue?.items.length} disabledReason="Nothing is due in the next seven days, so there is nothing to brief on yet."><Sparkles className="h-4 w-4" /> Build my AI brief</Button>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">5 AI previews/day · resets at midnight UTC.</span>
    </div>
    <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <summary className={cx("cursor-pointer rounded text-sm font-medium", focusRing)}>Filters, refresh & calendar{filter !== "all" ? " · filter active" : ""}</summary>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Filter actions">{[["all", "All"], ["overdue", "Past due"], ["interview", "Interviews"], ["follow_up", "Job follow-ups"], ["contact", "Contacts"], ["application", "Applications"], ["preparation", "Preparation"], ["playbook", "Playbook"]].map(([key, label]) =>
        <Button key={key} size="sm" variant={filter === key ? "primary" : "secondary"} aria-pressed={filter === key} onClick={() => setFilter(key!)}>{label}</Button>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => setLoad((n) => n + 1)}>Refresh records</Button>
        <Button variant="secondary" disabled={!queue?.items.some((a) => a.due_at && new Date(a.due_at) > new Date())} disabledReason="No upcoming dates to export yet."
          onClick={() => void exportCalendar()}>Export upcoming dates</Button></div>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Calendar export is a snapshot of upcoming dates.</p>
    </details>
    <div aria-live="polite">{busy && <p className="text-sm">Reading your saved actions and preparing a focused brief…</p>}</div>
    {error && <Callout tone="error">{error}</Callout>}
    {brief && queue?.version === brief.version && <section aria-label="Your AI brief" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-white/10 dark:bg-zinc-900">
      <h3 className="font-semibold">{brief.source === "mock" ? "Demo AI brief" : "Your AI brief"}</h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Suggestions based on your saved actions. Review them in the linked workspace.</p>
      <ol className="mt-4 space-y-4">{brief.steps.map((step) => {
        const action = queue.items.find((a) => a.id === step.action_id);
        return action && <li key={step.action_id}><Link to={action.path} className={cx("rounded text-sm font-medium hover:underline", focusRing)}>{action.title}</Link>
          <p className="mt-1 text-sm">{step.suggestion}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Source: “{step.source_quote}”</p></li>;
      })}</ol>
    </section>}
    {!queue && !error && <p role="status">Loading your saved actions…</p>}
    {queue && !queue.items.length && !queue.truncated && <div className="rounded-xl border border-zinc-200 p-5 dark:border-white/10"><h3 className="font-medium">Room for your next opportunity</h3>
      <p className="mt-2 text-sm">Add your next interview or follow-up date in the tracker, or a contact follow-up in People. Actions appear here when they are due within seven days.</p>
      <Link to="/jobs/tracker" className={cx("mt-3 inline-flex items-center gap-2 rounded text-sm hover:underline", focusRing)}>Open tracker <ArrowRight className="h-4 w-4" /></Link></div>}
    {queue && queue.items.length > 0 && !visible.length && !focus && <p className="text-sm">No actions in this filter.</p>}
    {focus && visible.length > 0 && <h3 className="text-sm font-semibold">Other saved actions</h3>}
    <ul className="space-y-3">{visible.map((action) => <li key={action.id} className="rounded-xl border border-zinc-200 bg-white p-4 transition-colors motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 max-w-full break-words font-medium">{action.title}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{action.overdue ? "Past due · " : ""}{action.due_at ? shortDate(action.due_at) : "Needs your review"}</span></div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{action.detail}</p>
      {action.rule && <p className="mt-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Your playbook · {RULE_NAMES[action.rule]}</p>}
      <Link to={action.path} className={cx("mt-3 inline-flex items-center gap-2 rounded text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>{action.action_label ?? "Open workspace"} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
    </li>)}</ul>
    {queue?.truncated && <Callout>This queue is bounded to 100 actions. Resolve or reschedule records, and review your tracker for the full list.</Callout>}
    <PlaybookEditor onChanged={(saved) => { setLoad((n) => n + 1); setBrief(null); setSavedRules(saved); }} />
  </div>;
}
