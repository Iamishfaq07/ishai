import { Link, useSearchParams } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { ArrowRight, LayoutGrid, MOCK_INTERVIEW_ENABLED, Search, cx, focusRing } from "@orbit/ui";
import { Button, Input, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { missionPath } from "../jobs/paths";
import { TOOLS, WORKSPACES, type Tool, type Workspace } from "./catalog";
import { toolIcon } from "./homes";

/** Tools that work on one job, and the tab of that job's page they live on. They open on your most recent active job
 *  instead of the tracker, so they're one click away instead of three. */
const JOB_TAB: Record<string, string> = {
  "first-look": "resume", "cover-letter": "resume", "scam-check": "company", pitch: "practice", references: "interview", promises: "interview",
  "red-flags": "interview", "interview-checklist": "interview", debrief: "interview", "first-90": "offer",
};
const CLOSED = new Set(["hired", "rejected", "withdrawn"]);

/**
 * Every personal tool in one place, by stage of the search, with a search box: many of them live inside a job's
 * tabs or a hub's folded catalogue, so this is where a candidate sees all of them. The list is the same catalogue the
 * public tools page reads (catalog.ts), so the two never disagree.
 */
export function ToolkitPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set("q", value); else next.delete("q");
    setParams(next, { replace: true });
  };
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const job = (tracker.data ?? []).filter((e) => !CLOSED.has(e.status)).sort((a, b) => b.status_at.localeCompare(a.status_at))[0];
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tools = TOOLS.filter((t) => t.audience === "personal" && (MOCK_INTERVIEW_ENABLED || !["saba", "video"].includes(t.id))
    && words.every((w) => `${t.name} ${t.line} ${t.detail} ${(t.keywords ?? []).join(" ")}`.toLowerCase().includes(w)));
  const count = TOOLS.filter((t) => t.audience === "personal" && (MOCK_INTERVIEW_ENABLED || !["saba", "video"].includes(t.id))).length;
  return <div className="workspace-page">
    <PageHeader icon={LayoutGrid} title="All tools" subtitle="Everything Orbit can do for your search, grouped by what you're working on. Search to find one tool." />
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <Input type="search" aria-label="Search tools" placeholder="Search tools: salary, GitHub, scam, aptitude…" value={query} onChange={(e) => setQuery(e.target.value)} className="!pl-9" />
    </div>
    <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{query ? `${tools.length} of ${count} tools matching “${query}”` : `${count} tools in ${WORKSPACES.length} workspaces`}</p>
      {query && <Button variant="ghost" onClick={() => setQuery("")}>Clear tool search</Button>}</div>
    {words.length ? (
      tools.length === 0
        ? <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">No tool matches “{query}”. Try a shorter word.</p>
        : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tools.map((t, i) => <li key={t.id} className="route-rise" style={{ ["--i" as string]: Math.min(i, 8) + 1 }}>
          <ToolTile tool={t} job={job} />
        </li>)}</ul>
    ) : (
      // Six workspaces and the Copilot, each one card with its tools as one-tap links: 40-odd tools without 40 cards.
      <ul className="grid gap-4 lg:grid-cols-2">{WORKSPACES.map((w, i) => {
        const list = w.tools.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => Boolean(t));
        return list.length ? <li key={w.id} className="route-rise" style={{ ["--i" as string]: i + 1 }}><WorkspaceCard workspace={w} tools={list} job={job} /></li> : null;
      })}</ul>
    )}
  </div>;
}

function ToolTile({ tool, job }: { tool: Tool; job: JobTrackerEntry | undefined }) {
  const Icon = toolIcon(tool);
  const tab = JOB_TAB[tool.id];
  const to = jobLink(tool, job);
  return <Link to={to} className={cx("workspace-panel route-card group flex h-full flex-col gap-2 p-4", focusRing)}>
    <span className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><Icon className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0 flex-1 font-semibold">{tool.name}</span>
      {tool.ai && <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">Uses AI</span>}
    </span>
    <span className="text-sm text-zinc-600 dark:text-zinc-400">{tool.line}</span>
    <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-indigo-700 dark:text-indigo-300">
      {tab ? job ? `Open for ${job.company}` : "Save a job to use it" : tool.label}
      <ArrowRight className="h-3.5 w-3.5 motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden />
    </span>
  </Link>;
}

function jobLink(tool: Tool, job: JobTrackerEntry | undefined): string {
  const tab = JOB_TAB[tool.id];
  return tab && job ? `${missionPath(job.id)}?tab=${tab}` : tool.href;
}

/** One workspace: what it's for, a way in, and each of its tools one tap away. */
function WorkspaceCard({ workspace: w, tools, job }: { workspace: Workspace; tools: Tool[]; job: JobTrackerEntry | undefined }) {
  const Icon = toolIcon(tools[0]!);
  const href = w.perJob && job ? missionPath(job.id) : w.href;
  return <section aria-labelledby={`ws-${w.id}`} className="workspace-panel flex h-full flex-col gap-3 p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><Icon className="h-5 w-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <h2 id={`ws-${w.id}`} className="font-semibold">{w.name} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {tools.length}</span></h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{w.line}</p>
      </div>
    </div>
    {w.perJob && <p className="text-xs text-zinc-500 dark:text-zinc-400">{job ? `These open on ${job.title} at ${job.company}, your most recent job.` : "Save or add a job, then these open on its page."}</p>}
    <ul className="flex flex-wrap gap-2">{tools.map((t) => {
      const TIcon = toolIcon(t);
      return <li key={t.id}><Link to={w.perJob && !job ? w.href : jobLink(t, job)} title={t.line}
        className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-sm hover:border-indigo-300 hover:text-indigo-800 dark:border-white/10 dark:bg-zinc-900 dark:hover:text-indigo-200", focusRing)}>
        <TIcon className="h-3.5 w-3.5 text-zinc-500" aria-hidden />{t.name}{t.ai && <span className="sr-only"> (uses AI)</span>}
      </Link></li>;
    })}</ul>
    <Link to={href} className={cx("mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>
      {w.perJob && job ? `Open ${job.company}` : w.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  </section>;
}
