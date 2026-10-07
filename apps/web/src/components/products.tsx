import { Link, useLocation } from "react-router-dom";
import { cx, focusRing, type LucideIcon } from "@orbit/ui";

/**
 * What Orbit's AI products share in the app: the "AI" pill after their name (Resume AI, Jobs AI) and the tabs between
 * a product's own pages. Light on purpose: the main nav, Home and the sign-in screens import it.
 */

/** The small gradient "AI" tag after "Resume" and "Jobs" in the nav and on the products' cards and headings. */
export function AiPill({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[5px] bg-gradient-to-r from-indigo-600 to-aurora-600 px-1 py-px text-[0.625rem] font-bold leading-[0.875rem] tracking-wide text-white shadow-sm",
        className,
      )}
    >
      AI
    </span>
  );
}

export interface ProductSection {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Also current on these addresses (a job's own page sits under Matches). */
  also?: RegExp;
  /** A count after the label (the tracker's jobs). */
  count?: number;
}

/** Whether a tab's page is the one showing: exactly it (`end`), or it and anything under it. */
export function isCurrent(pathname: string, to: string, end = false): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === to || (!end && path.startsWith(`${to}/`));
}

/** The tabs between a product's own pages, under its header. Nothing while it has only the one page. */
export function ProductTabs({ label, sections }: { label: string; sections: ProductSection[] }) {
  const { pathname } = useLocation();
  if (sections.length < 2) return null;
  return (
    // Scrolls sideways rather than wrapping if a phone is ever too narrow for every tab.
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex gap-0.5 rounded-xl bg-zinc-500/10 p-1 sm:gap-1">
        {sections.map(({ to, label: name, icon: Icon, end, also, count }) => {
          const current = isCurrent(pathname, to, end) || Boolean(also?.test(pathname));
          return (
            <Link
              key={to}
              to={to}
              aria-current={current ? "page" : undefined}
              className={cx(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium transition-colors min-[380px]:px-2.5 sm:px-3",
                current
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                focusRing,
              )}
            >
              <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" /> {name}
              {count ? (
                <span className="rounded-full bg-indigo-500/15 px-1.5 text-xs tabular-nums text-indigo-700 dark:text-indigo-200">{count}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
