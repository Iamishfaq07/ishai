import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CountUp, cx, focusRing } from "@orbit/ui";

/** Shared pieces of the task hubs (Prepare, My Career): a tool card and a stat tile. */
export type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
export interface ToolCard { title: string; detail: string; icon: Icon; to: string; ai?: boolean; perJob?: boolean }


const card = cx("group relative flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-4 text-sm",
  "motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-200 hover:border-indigo-400 hover:shadow-md",
  "motion-safe:hover:-translate-y-0.5 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-indigo-400/60", focusRing);
const tag = "rounded-full px-2 py-0.5 text-[11px] font-medium";

export function Tool({ t }: { t: ToolCard }) {
  return <Link to={t.to} className={card}>
    <span className="flex items-start justify-between gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 motion-safe:transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-500/10 dark:text-indigo-300">
        <t.icon className="h-4 w-4" aria-hidden /></span>
      <span className="flex flex-wrap justify-end gap-1">
        {t.ai && <span className={cx(tag, "bg-violet-50 text-violet-800 dark:bg-violet-500/10 dark:text-violet-200")}>AI</span>}
        {t.perJob && <span className={cx(tag, "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300")}>Per job</span>}
      </span>
    </span>
    <span className="mt-3 font-semibold">{t.title}</span>
    <span className="mt-1 flex-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{t.detail}</span>
    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
      Open <ArrowRight className="h-3.5 w-3.5 motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
  </Link>;
}

export function Stat({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return <div className="workspace-panel p-4">
    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
    <p className="stat-value mt-1 font-display text-3xl font-semibold">{value === null ? <span className="text-zinc-300 dark:text-zinc-600">–</span> : <CountUp to={value} />}</p>
    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
  </div>;
}

