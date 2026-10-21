import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookmarkCheck, Gauge, Search, Send, Users, Zap, Button, cx, focusRing } from "@orbit/ui";
import { ProductTabs } from "../../components/products";
import { currentJobTool, JOB_WORKSPACES, jobsTabs, jobWorkspace, workspaceTools } from "./workspace";

const ToolFinder = lazy(() => import("./ToolFinder"));
const ICONS = [Gauge, Search, BookmarkCheck, Send];
/** Icons for the Jobs tab row (jobsTabs), by label. */
const TAB_ICONS: Record<string, typeof Search> = { Discover: Search, Tracker: BookmarkCheck, Priority: Gauge, "Auto-apply": Zap, "Needs you": Send, People: Users };

export function JobsWorkspaceNav({ personalShell = true }: { personalShell?: boolean } = {}) {
  const { pathname } = useLocation();
  const group = jobWorkspace(pathname);
  const [finder, setFinder] = useState(false);
  // In the personal shell the sidebar's one Jobs item covers finding and applying, so every Jobs page shows the same
  // tab row (jobsTabs). Elsewhere each area keeps its own tools.
  const area = group?.id;
  const tools = personalShell && group ? jobsTabs() : area ? workspaceTools(area) : [];
  // The room owns its contextual navigation; do not stack another Jobs workspace menu above it.
  if (pathname.startsWith("/jobs/mission/")) return null;
  // The sidebar already names Jobs, so the area tabs only remain where it can't (the Business shell and the desktop
  // app use this nav without that sidebar). One layer of navigation per screen, not three.
  const sidebarNamesArea = personalShell && Boolean(group);
  return <div className="mb-6 space-y-3">
    {!sidebarNamesArea && <ProductTabs label="Jobs" sections={JOB_WORKSPACES.map((area, index) => ({
      to: area.to, label: area.label, end: true, also: area.paths, icon: ICONS[index]!,
    }))} />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {tools.length > 1 && <nav aria-label={personalShell && group ? "Jobs" : `${group!.label} tools`}
        className="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-white/5">
        {tools.map((tool) => {
          const current = currentJobTool(pathname) === tool.to;
          const Icon = TAB_ICONS[tool.label];
          return <Link key={tool.to} to={tool.to} aria-current={current ? "page" : undefined}
            className={cx("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium motion-safe:transition-[background-color,color,box-shadow] motion-safe:duration-200", focusRing, current
              ? "bg-white text-indigo-700 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-indigo-300 dark:ring-white/10"
              : "text-zinc-600 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100")}>
            {Icon && <Icon className="h-4 w-4" aria-hidden />}{tool.label}</Link>;
        })}
      </nav>}
      <Button size="sm" variant="ghost" aria-expanded={finder} aria-controls="jobs-tool-finder" onClick={() => setFinder(!finder)}>
        <Search className="h-4 w-4" aria-hidden />{finder ? "Close tool finder" : "Find a tool"}
      </Button>
    </div>
    {finder && <Suspense fallback={<p role="status">Opening tools…</p>}><ToolFinder onNavigate={() => setFinder(false)} /></Suspense>}
  </div>;
}
