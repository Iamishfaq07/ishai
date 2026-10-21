import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookmarkCheck, Gauge, Search, Send, Button, cx, focusRing } from "@orbit/ui";
import { ProductTabs } from "../../components/products";
import { currentJobTool, JOB_WORKSPACES, jobWorkspace, workspaceTools } from "./workspace";

const ToolFinder = lazy(() => import("./ToolFinder"));
const ICONS = [Gauge, Search, BookmarkCheck, Send];

export function JobsWorkspaceNav({ personalShell = true }: { personalShell?: boolean } = {}) {
  const { pathname } = useLocation();
  const group = jobWorkspace(pathname);
  const [finder, setFinder] = useState(false);
  // In the personal shell the sidebar's Discover covers the launchpad and its Applications covers People, so each
  // shows its sidebar area's tools.
  const area = group && personalShell ? (group.id === "people" ? "applications" : group.id === "today" ? "find" : group.id) : group?.id;
  const tools = area ? workspaceTools(area) : [];
  // The room owns its contextual navigation; do not stack another Jobs workspace menu above it.
  if (pathname.startsWith("/jobs/mission/")) return null;
  // The sidebar already names Discover and Applications, so the area tabs only remain where it can't (the Business
  // shell and the desktop app use this nav without that sidebar). One layer of navigation per screen, not three.
  const sidebarNamesArea = personalShell && Boolean(group);
  return <div className="mb-6 space-y-3">
    {!sidebarNamesArea && <ProductTabs label="Jobs" sections={JOB_WORKSPACES.map((area, index) => ({
      to: area.to, label: area.label, end: true, also: area.paths, icon: ICONS[index]!,
    }))} />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {tools.length > 1 && <nav aria-label={`${area === "find" ? "Discover" : area === "applications" ? "Applications" : group!.label} tools`} className="flex flex-wrap gap-x-4 gap-y-1">
        {tools.map((tool) => <Link key={tool.to} to={tool.to} aria-current={currentJobTool(pathname) === tool.to ? "page" : undefined}
          className={cx("rounded py-2 text-sm underline-offset-4 hover:underline", focusRing, currentJobTool(pathname) === tool.to
            ? "font-semibold text-indigo-700 underline dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400")}>{tool.label}</Link>)}
      </nav>}
      <Button size="sm" variant="ghost" aria-expanded={finder} aria-controls="jobs-tool-finder" onClick={() => setFinder(!finder)}>
        <Search className="h-4 w-4" aria-hidden />{finder ? "Close tool finder" : "Find a tool"}
      </Button>
    </div>
    {finder && <Suspense fallback={<p role="status">Opening tools…</p>}><ToolFinder onNavigate={() => setFinder(false)} /></Suspense>}
  </div>;
}
