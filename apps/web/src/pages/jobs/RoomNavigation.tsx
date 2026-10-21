import type { MissionTool } from "./mission";
import { MISSION_TOOLS, ROOM_SECTIONS, roomSection } from "./mission";
import { cx, focusRing } from "@orbit/ui";

const labels: Record<MissionTool, string> = {
  fit: "Requirements & fit", company: "Company & contacts", resume: "Resume & materials",
  timeline: "Application history", practice: "Practice with Saba", plan: "Preparation plan",
  interview: "Rounds & interview day", offer: "Offer & decision",
};

/** Existing query routes, progressively grouped; no second expert mode or independent panel state. */
export function RoomNavigation({ tab, onSelect }: { tab: MissionTool; onSelect: (tool: MissionTool) => void }) {
  const current = roomSection(tab);
  const tools = MISSION_TOOLS.filter((tool) => roomSection(tool.id) === current);
  return <div className="workspace-panel p-2 sm:p-3">
    <nav aria-label="Opportunity room" className="grid grid-cols-2 gap-1 sm:grid-cols-5">
      {ROOM_SECTIONS.map((section) => <button key={section.id} type="button" aria-controls="mission-tool-panel" aria-current={current === section.id ? "page" : undefined} onClick={() => onSelect(current === section.id ? tab : section.first)} className={cx("min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-quick", current === section.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-600 hover:bg-zinc-500/5 dark:text-zinc-400", focusRing)}>{section.label}</button>)}
    </nav>
    {tools.length > 1 && <nav aria-label={`${ROOM_SECTIONS.find((section) => section.id === current)?.label} sections`} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-200 px-2 pt-2 dark:border-white/10">
      {tools.map((tool) => <button key={tool.id} type="button" aria-controls="mission-tool-panel" aria-current={tab === tool.id ? "page" : undefined} onClick={() => onSelect(tool.id)} className={cx("min-h-11 rounded px-1 text-sm underline-offset-8", tab === tool.id ? "font-semibold text-zinc-900 underline dark:text-zinc-100" : "text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>{labels[tool.id]}</button>)}
    </nav>}
  </div>;
}
