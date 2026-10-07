import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AudioLines, Briefcase, FileText, Target, cx, focusRing, type LucideIcon } from "@orbit/ui";
import type { ProductId } from "../lib/onboarding";

/**
 * What Orbit's products share in the app: each one's name, mark and colour, the "AI" pill after their name
 * (Resume AI, Jobs AI) and the tabs between a product's own pages. Light on purpose: the main nav, Home and the
 * sign-in screens import it.
 */

export type { ProductId };

/**
 * Each product's one fixed colour, for its mark and tag only (the user's accent stays for UI state): the interview
 * copilot is the accent, Practice orange (a hue none of the seven accents uses), Resume AI emerald, Jobs AI sky. -700/-800 text on the light tints and -200/-300 on the dark
 * ones keep small labels at AA contrast.
 */
export const PRODUCTS: Record<ProductId, { name: string; short: string; icon: LucideIcon; tile: string; text: string; soft: string }> = {
  interview: {
    name: "Interview copilot",
    short: "Copilot",
    icon: AudioLines,
    tile: "bg-indigo-500/15 text-indigo-700 ring-indigo-500/25 dark:bg-indigo-400/15 dark:text-indigo-200 dark:ring-indigo-300/20",
    text: "text-indigo-700 dark:text-indigo-300",
    soft: "bg-indigo-500/[0.06] ring-indigo-500/20 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15",
  },
  practice: {
    name: "Practice",
    short: "Practice",
    icon: Target,
    tile: "bg-orange-500/15 text-orange-800 ring-orange-600/25 dark:bg-orange-400/15 dark:text-orange-200 dark:ring-orange-300/20",
    text: "text-orange-700 dark:text-orange-300",
    soft: "bg-orange-500/[0.06] ring-orange-600/20 dark:bg-orange-400/[0.06] dark:ring-orange-300/15",
  },
  resume: {
    name: "Resume AI",
    short: "Resume",
    icon: FileText,
    tile: "bg-emerald-500/15 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "bg-emerald-500/[0.06] ring-emerald-600/20 dark:bg-emerald-400/[0.06] dark:ring-emerald-300/15",
  },
  jobs: {
    name: "Jobs AI",
    short: "Jobs",
    icon: Briefcase,
    tile: "bg-sky-500/15 text-sky-800 ring-sky-600/25 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-300/20",
    text: "text-sky-700 dark:text-sky-300",
    soft: "bg-sky-500/[0.06] ring-sky-600/20 dark:bg-sky-400/[0.06] dark:ring-sky-300/15",
  },
};

/** A product's mark: its icon on its colour. Decorative; the name beside it says which product it is. */
export function ProductMark({ product, size = "md", className }: { product: ProductId; size?: "sm" | "md" | "lg"; className?: string }) {
  const { icon: Icon, tile } = PRODUCTS[product];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center ring-1",
        size === "sm" && "h-7 w-7 rounded-lg",
        size === "md" && "h-10 w-10 rounded-xl",
        size === "lg" && "h-12 w-12 rounded-2xl",
        tile,
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : size === "md" ? "h-5 w-5" : "h-6 w-6"} />
    </span>
  );
}

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

/**
 * The tabs between a product's own pages, under its header. Nothing while it has only the one page. `action` sits at
 * the row's end (the interview pages' "Start live").
 */
export function ProductTabs({ label, sections, action }: { label: string; sections: ProductSection[]; action?: ReactNode }) {
  const { pathname } = useLocation();
  if (sections.length < 2) return null;
  const tabs = (
    // Scrolls sideways rather than wrapping if a phone is ever too narrow for every tab.
    <nav aria-label={label} className={cx("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", action ? "min-w-0" : "mb-6")}>
      <div className="inline-flex gap-0.5 rounded-xl bg-zinc-500/10 p-1 sm:gap-1">
        {sections.map(({ to, label: name, icon: Icon, end, also, count }) => {
          const current = isCurrent(pathname, to, end) || Boolean(also?.test(pathname));
          // Phones: a size smaller and tighter, and no count under 380 px, so Jobs AI's five tabs fit a 360 px screen.
          return (
            <Link
              key={to}
              to={to}
              aria-current={current ? "page" : undefined}
              className={cx(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[0.8125rem] font-medium transition-colors sm:px-3 sm:text-sm",
                current
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                focusRing,
              )}
            >
              <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" /> {name}
              {count ? (
                <span className="hidden rounded-full bg-indigo-500/15 px-1.5 text-xs tabular-nums text-indigo-700 min-[380px]:inline dark:text-indigo-200">{count}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
  if (!action) return tabs;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      {tabs}
      {action}
    </div>
  );
}
