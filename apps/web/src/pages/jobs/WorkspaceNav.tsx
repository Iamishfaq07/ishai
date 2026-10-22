import { Link, useLocation } from "react-router-dom";
import { BookmarkCheck, Gauge, Search, Send, Zap, cx, focusRing } from "@orbit/ui";
import { ProductTabs } from "../../components/products";
import { currentJobTool, JOB_WORKSPACES, jobsTabs, jobWorkspace, workspaceTools } from "./workspace";

const ICONS = [Gauge, Search, BookmarkCheck, Send];
/** Icons for the Jobs tab row (jobsTabs), by label. */
const TAB_ICONS: Record<string, typeof Search> = { Discover: Search, Tracker: BookmarkCheck, "Auto-apply": Zap };

export function JobsWorkspaceNav({ personalShell = true }: { personalShell?: boolean } = {}) {
  const { pathname } = useLocation();
  const group = jobWorkspace(pathname);
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
    {tools.length > 1 && <nav aria-label={personalShell && group ? "Jobs" : `${group!.label} tools`}
      className="-mx-4 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-white/10">
      <ul className="flex min-w-max gap-1">{tools.map((tool) => {
        const current = currentJobTool(pathname) === tool.to;
        const Icon = TAB_ICONS[tool.label];
        return <li key={tool.to}><Link to={tool.to} aria-current={current ? "page" : undefined}
          className={cx("relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-md px-3 text-sm font-medium", focusRing, current
            ? "text-zinc-900 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-indigo-600 dark:text-zinc-100 dark:after:bg-indigo-400"
            : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}>
          {Icon && <Icon className="h-4 w-4" aria-hidden />}{tool.label}</Link></li>;
      })}</ul>
    </nav>}
  </div>;
}
