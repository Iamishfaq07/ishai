import { ArrowRight, cx, focusRing } from "@orbit/ui";
import { Tool } from "../prepare/parts";
import { toolIcon, toolsFor, type Home } from "./homes";

/**
 * The rest of a tab's tools, from the catalogue: everything that belongs to this tab and isn't already on the page.
 * Renders nothing when the page already shows them all.
 */
export function MoreTools({ home, shown = [], title = "More tools here" }: { home: Home; shown?: readonly string[]; title?: string }) {
  const tools = toolsFor(home, shown);
  if (!tools.length) return null;
  // Folded by default: the page's own sections come first, the rest of the catalogue is one click away (and in search).
  return <details className="group rounded-2xl ring-1 ring-zinc-200 dark:ring-white/10">
    <summary className={cx("flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 font-medium", focusRing)}>
      <span>{title} <span className="font-normal text-zinc-600 dark:text-zinc-400">({tools.length})</span></span>
      <ArrowRight className="h-4 w-4 text-zinc-500 motion-safe:transition-transform group-open:rotate-90" aria-hidden />
    </summary>
    <ul className="grid gap-x-4 gap-y-1 px-2 pb-3 sm:grid-cols-2">{tools.map((t) =>
      <li key={t.id}><Tool t={{ title: t.name, detail: t.line, icon: toolIcon(t), to: t.href, ai: t.ai }} /></li>)}</ul>
  </details>;
}
