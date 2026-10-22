import { useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { ArrowRight, LayoutGrid, MOCK_INTERVIEW_ENABLED, Search, cx, focusRing } from "@orbit/ui";
import { Input, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { missionPath } from "../jobs/paths";
import { STAGES, TOOLS, type Tool } from "./catalog";
import { toolIcon } from "./homes";

/** Tools that work on one job, and the tab of that job's page they live on. They open on your most recent active job
 *  instead of the tracker, so they're one click away instead of three. */
const JOB_TAB: Record<string, string> = {
  "first-look": "resume", "scam-check": "company", pitch: "practice", references: "interview", promises: "interview",
  "red-flags": "interview", "interview-checklist": "interview", debrief: "interview", "first-90": "offer",
};
const CLOSED = new Set(["hired", "rejected", "withdrawn"]);

/**
 * Every personal tool in one place, by stage of the search, with a search box: many of them live inside a job's
 * tabs or a hub's folded catalogue, so this is where a candidate sees all of them. The list is the same catalogue the
 * public tools page reads (catalog.ts), so the two never disagree.
 */
export function ToolkitPage() {
  const [query, setQuery] = useState("");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const job = (tracker.data ?? []).filter((e) => !CLOSED.has(e.status)).sort((a, b) => b.status_at.localeCompare(a.status_at))[0];
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tools = TOOLS.filter((t) => t.audience === "personal" && (MOCK_INTERVIEW_ENABLED || !["saba", "video"].includes(t.id))
    && words.every((w) => `${t.name} ${t.line} ${t.detail} ${(t.keywords ?? []).join(" ")}`.toLowerCase().includes(w)));
  const count = TOOLS.filter((t) => t.audience === "personal").length;
  return <div className="workspace-page">
    <PageHeader icon={LayoutGrid} title="All tools" subtitle={`Everything Orbit can do for your search, ${count} tools in all, from your first resume to your first 90 days.`} />
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <Input type="search" aria-label="Search tools" placeholder="Search tools: salary, GitHub, scam, aptitude…" value={query} onChange={(e) => setQuery(e.target.value)} className="!pl-9" />
    </div>
    {tools.length === 0 && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">No tool matches “{query}”. Try a shorter word.</p>}
    {STAGES.map((stage) => {
      const list = tools.filter((t) => t.stage === stage.id);
      if (!list.length) return null;
      return <section key={stage.id} aria-labelledby={`stage-${stage.id}`} className="space-y-3">
        <div><h2 id={`stage-${stage.id}`} className="font-title text-xl font-semibold">{stage.label === "Next chapter" ? "Offers & next chapter" : stage.label}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{stage.personal}</p></div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((t, i) => <li key={t.id} className="route-rise" style={{ ["--i" as string]: Math.min(i, 8) + 1 }}>
          <ToolTile tool={t} job={job} />
        </li>)}</ul>
      </section>;
    })}
  </div>;
}

function ToolTile({ tool, job }: { tool: Tool; job: JobTrackerEntry | undefined }) {
  const Icon = toolIcon(tool);
  const tab = JOB_TAB[tool.id];
  const to = tab && job ? `${missionPath(job.id)}?tab=${tab}` : tool.href;
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
