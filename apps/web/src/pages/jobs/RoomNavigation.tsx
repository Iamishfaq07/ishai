import { useEffect, useRef } from "react";
import type { MissionTool } from "./mission";
import { cx, focusRing } from "@orbit/ui";

/** The job page's sections in route order: the job and its materials first, then preparation, the interviews, the
 *  history and the offer. Every `?tab=` deep link still lands on its own section. */
const ORDER: { id: MissionTool; label: string }[] = [
  { id: "fit", label: "Requirements" }, { id: "resume", label: "Resume" }, { id: "company", label: "Company" },
  { id: "practice", label: "Practice" }, { id: "plan", label: "Prep plan" }, { id: "interview", label: "Interviews" },
  { id: "timeline", label: "History" }, { id: "offer", label: "Offer" },
];

/** One row of sections (it scrolls sideways on a phone), pinned under the header so every section stays one tap away
 *  on a long page. The section this job's stage suggests carries a dot. */
export function RoomNavigation({ tab, suggested, onSelect }: { tab: MissionTool; suggested: MissionTool; onSelect: (tool: MissionTool) => void }) {
  const nav = useRef<HTMLElement>(null);
  // On a phone the row scrolls sideways: keep the open section in sight (sideways only, never moving the page).
  useEffect(() => {
    const row = nav.current, current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !current) return;
    const box = row.getBoundingClientRect(), item = current.getBoundingClientRect();
    if (item.left < box.left || item.right > box.right) row.scrollLeft += item.left - box.left - 16;
  }, [tab]);
  return <nav ref={nav} aria-label="Sections of this job" className="sticky top-16 z-10 -mx-4 overflow-x-auto md:top-[60px] border-b border-zinc-200 bg-[rgb(var(--canvas))] px-4 sm:mx-0 sm:px-0 dark:border-white/10">
    <ul className="flex min-w-max gap-1">
      {ORDER.map((item) => <li key={item.id}>
        <button type="button" aria-controls="mission-tool-panel" aria-current={tab === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}
          className={cx("route-tab relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-sm font-medium",
            tab === item.id ? "text-zinc-900 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-indigo-600 dark:text-zinc-100 dark:after:bg-indigo-400"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100", focusRing)}>
          {item.label}
          {suggested === item.id && <><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" /><span className="sr-only">(suggested for this stage)</span></>}
        </button>
      </li>)}
    </ul>
  </nav>;
}
