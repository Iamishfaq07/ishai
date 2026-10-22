import type { ReactNode } from "react";
import { ChevronRight, cx, focusRing } from "@orbit/ui";

/** A quiet section that opens on demand: the page's main work stays open above it, the extras wait here with a
 *  one-line hint of what's inside. */
export function Fold({ title, hint, children, defaultOpen = false }: { title: string; hint: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details open={defaultOpen || undefined} className="group rounded-2xl ring-1 ring-zinc-200 dark:ring-white/10">
    <summary className={cx("flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3", focusRing)}>
      <span className="min-w-0"><span className="block font-medium">{title}</span><span className="block text-[13px] text-zinc-600 dark:text-zinc-400">{hint}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500 motion-safe:transition-transform group-open:rotate-90" aria-hidden />
    </summary>
    <div className="px-2 pb-2 sm:px-3 sm:pb-3">{children}</div>
  </details>;
}
