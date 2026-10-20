import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookmarkCheck, Gauge, Search, Send, Button, cx, focusRing } from "@orbit/ui";
import { ProductTabs } from "../../components/products";
import { currentJobTool, JOB_WORKSPACES, jobWorkspace, workspaceTools } from "./workspace";

const ToolFinder = lazy(() => import("./ToolFinder"));
const ICONS = [Gauge, Search, BookmarkCheck, Send];

export function JobsWorkspaceNav() {
  const { pathname } = useLocation();
  const group = jobWorkspace(pathname);
  const [finder, setFinder] = useState(false);
  const tools = group ? workspaceTools(group.id) : [];
  return <div className="mb-6 space-y-3">
    <ProductTabs label="Jobs AI" sections={JOB_WORKSPACES.map((area, index) => ({
      to: area.to, label: area.label, end: true, also: area.paths, icon: ICONS[index]!,
    }))} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      {tools.length > 1 && <nav aria-label={`${group!.label} tools`} className="flex flex-wrap gap-x-4 gap-y-1">
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
