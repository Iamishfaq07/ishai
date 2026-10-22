import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CountUp, cx, focusRing } from "@orbit/ui";

/** Shared pieces of the task hubs (Prepare, My Career, Copilot): a tool card and a stat tile. */
export type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
/** `to` starting with https:// opens outside the app (a download, for instance) in a new tab. */
export interface ToolCard { title: string; detail: string; icon: Icon; to: string; ai?: boolean; perJob?: boolean; beta?: boolean }

// A tool is a quiet row (icon, name, one line, tags), not a raised card: the hubs list many, and the next step on the
// page should stay the loudest thing.
const card = cx("group flex h-full min-h-11 items-start gap-3 rounded-xl px-3 py-3 text-sm",
  "motion-safe:transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.05]", focusRing);
const tag = "rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300";

export function Tool({ t }: { t: ToolCard }) {
  const body = <ToolBody t={t} />;
  return t.to.startsWith("https://")
    ? <a href={t.to} target="_blank" rel="noopener noreferrer" className={card}>{body}<span className="sr-only">(opens in a new tab)</span></a>
    : <Link to={t.to} className={card}>{body}</Link>;
}

function ToolBody({ t }: { t: ToolCard }) {
  return <>
    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-700 motion-safe:transition-colors group-hover:text-indigo-700 dark:bg-white/[0.06] dark:text-zinc-300 dark:group-hover:text-indigo-300">
      <t.icon className="h-4 w-4" aria-hidden /></span>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold group-hover:underline group-hover:underline-offset-4">{t.title}</span>
        {t.ai && <span className={tag}>Uses AI</span>}
        {t.perJob && <span className={tag}>Per job</span>}
        {t.beta && <span className={cx(tag, "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200")}>Beta</span>}
      </span>
      <span className="mt-0.5 block leading-relaxed text-zinc-600 dark:text-zinc-400">{t.detail}</span>
    </span>
    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-zinc-400 motion-safe:transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-700 dark:group-hover:text-indigo-300" aria-hidden />
  </>;
}

export function Stat({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return <div className="workspace-panel p-4">
    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
    {/* Zero isn't a score: an empty count reads as a plain "None yet", not a big 0. */}
    {value === 0 ? <p className="mt-2 text-base font-medium text-zinc-600 dark:text-zinc-400">None yet</p>
      : <p className="stat-value mt-1 font-display text-3xl font-semibold">{value === null ? <span className="text-zinc-300 dark:text-zinc-600">–</span> : <CountUp to={value} />}</p>}
    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
  </div>;
}

