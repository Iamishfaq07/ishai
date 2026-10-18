import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, cx, focusRing } from "@orbit/ui";

/** The way back from a detail page to its list ("← All offers"): one look on every detail page (PageHeader's `back`). */
export function BackLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        "tap-y inline-flex items-center gap-1.5 rounded text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
        focusRing,
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> {children}
    </Link>
  );
}
