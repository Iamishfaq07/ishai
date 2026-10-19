import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Button, Callout, Sparkles, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { shortDate } from "./model";

interface Action {
  id: string; kind: "interview" | "follow_up" | "contact" | "application";
  title: string; detail: string; due_at: string | null; overdue: boolean; path: string;
}
interface Queue { version: string; items: Action[]; truncated: boolean; as_of: string; horizon_days: number }
interface Brief { version: string; source: "ai" | "mock"; steps: { action_id: string; source_quote: string; suggestion: string }[] }

export function JobActionDeskPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [load, setLoad] = useState(0);
  const [filter, setFilter] = useState("all");
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
  const visible = queue?.items.filter((a) => filter === "all" || (filter === "overdue" ? a.overdue : a.kind === filter)) ?? [];
  return <div className="space-y-6">
    <section className="grid items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900 md:grid-cols-2">
      <div><p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Your next seven days</p>
        <h2 className="mt-2 text-2xl font-semibold">Action desk</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Interview dates, contact follow-ups and applications that need you, brought together automatically from your saved records.</p>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Updates every minute while open and when you return. Completing or rescheduling the source updates this queue.</p></div>
      <svg viewBox="0 0 360 120" role="img" aria-label="Saved records flow into a focused next step" className="w-full text-indigo-500">
        <path d="M65 25 Q140 25 180 60 M65 60 H180 M65 95 Q140 95 180 60 H300" fill="none" stroke="currentColor" strokeWidth="2" opacity=".4" />
        {[25, 60, 95].map((y) => <g key={y}><rect x="20" y={y - 12} width="75" height="24" rx="8" fill="currentColor" opacity=".12" /><path d={`M32 ${y}h45`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></g>)}
        <circle cx="180" cy="60" r="17" fill="currentColor" opacity=".15" className="motion-safe:animate-pulse" /><path d="m172 60 6 6 12-13" fill="none" stroke="currentColor" strokeWidth="3" />
        <rect x="235" y="34" width="105" height="52" rx="14" fill="currentColor" opacity=".12" /><text x="287" y="65" textAnchor="middle" fill="currentColor" fontSize="14">Next step</text>
      </svg>
    </section>
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void generate()} loading={busy} disabled={!queue?.items.length}><Sparkles className="h-4 w-4" /> Build my AI brief</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setLoad((n) => n + 1)}>Refresh records</Button>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">5 AI previews a day · resets at midnight UTC</span>
    </div>
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
    <div className="flex flex-wrap gap-2" aria-label="Filter actions">{[["all", "All"], ["overdue", "Past due"], ["interview", "Interviews"], ["contact", "Contacts"], ["application", "Applications"]].map(([key, label]) =>
      <Button key={key} size="sm" variant={filter === key ? "primary" : "secondary"} aria-pressed={filter === key} onClick={() => setFilter(key!)}>{label}</Button>)}</div>
    {!queue && !error && <p role="status">Loading your saved actions…</p>}
    {queue && !queue.items.length && <div className="rounded-xl border border-zinc-200 p-5 dark:border-white/10"><h3 className="font-medium">Room for your next opportunity</h3>
      <p className="mt-2 text-sm">Add your next interview or follow-up date in the tracker, or a contact follow-up in Outreach. Actions appear here when they are due within seven days.</p>
      <Link to="/jobs/tracker" className={cx("mt-3 inline-flex items-center gap-2 rounded text-sm hover:underline", focusRing)}>Open tracker <ArrowRight className="h-4 w-4" /></Link></div>}
    {queue && queue.items.length > 0 && !visible.length && <p className="text-sm">No actions in this filter.</p>}
    <ul className="space-y-3">{visible.map((action) => <li key={action.id} className="rounded-xl border border-zinc-200 bg-white p-4 transition-colors motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{action.title}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{action.overdue ? "Past due · " : ""}{action.due_at ? shortDate(action.due_at) : "Needs your review"}</span></div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{action.detail}</p>
      <Link to={action.path} className={cx("mt-3 inline-flex items-center gap-2 rounded text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>Open workspace <ArrowRight className="h-4 w-4" /></Link>
    </li>)}</ul>
    {queue?.truncated && <Callout>Showing the first 100 actions. Resolve or reschedule records to see later items.</Callout>}
  </div>;
}
