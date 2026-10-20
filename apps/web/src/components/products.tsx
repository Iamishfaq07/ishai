import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AudioLines, Briefcase, FileText, Target, cx, focusRing, type LucideIcon } from "@orbit/ui";
import type { ProductId } from "../lib/onboarding";

/**
 * What Orbit's products share in the app: each one's name, mark and colour,
 * and the tabs between a product's own pages. Light on purpose: the main nav, Home and the
 * sign-in screens import it.
 */

export type { ProductId };

/**
 * Each product's one fixed colour, for its mark and tag only (the user's accent stays for UI state): the interview
 * copilot is the accent, Practice orange (a hue none of the seven accents uses), Resume emerald, Jobs sky. -700/-800 text on the light tints and -200/-300 on the dark
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
    name: "Resume",
    short: "Resume",
    icon: FileText,
    tile: "bg-emerald-500/15 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "bg-emerald-500/[0.06] ring-emerald-600/20 dark:bg-emerald-400/[0.06] dark:ring-emerald-300/15",
  },
  jobs: {
    name: "Jobs",
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

/** Where each strip's pill last stood (by the strip's label), so the next page's strip can slide it from there. */
const lastPill = new Map<string, { left: number; width: number; at: number }>();
/** Only a move between a strip's own tabs slides: coming back to a product later starts the pill in place. */
const SLIDE_WITHIN_MS = 3000;

/**
 * The tabs between a product's own pages, under its header. Nothing while it has only the one page. `action` sits at
 * the row's end (the interview pages' "Start live"). The pill under the page you're on slides over from the tab you
 * came from (base.css .indicator: a glide at Full, a jump at Gentle and Off).
 */
export function ProductTabs({ label, sections, action }: { label: string; sections: ProductSection[]; action?: ReactNode }) {
  const { pathname } = useLocation();
  const strip = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(() => {
    const last = lastPill.get(label);
    return last && Date.now() - last.at < SLIDE_WITHIN_MS ? last : null;
  });
  useLayoutEffect(() => {
    const box = row.current;
    if (!box) return;
    const read = () => {
      const tab = box.querySelector<HTMLElement>('[aria-current="page"]');
      if (!tab) return setPill(null);
      const next = { left: tab.offsetLeft, width: tab.offsetWidth };
      lastPill.set(label, { ...next, at: Date.now() });
      setPill((p) => (p && p.left === next.left && p.width === next.width ? p : next));
    };
    // A frame later, so a pill that starts where the last page left it has drawn there once and can glide.
    const raf = requestAnimationFrame(read);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [pathname, label, sections.length]);
  // A phone too narrow for every tab scrolls the strip; the page you're on is always scrolled fully into view
  // (centred when it was cut off), so the fifth tab is never clipped on its own page.
  useLayoutEffect(() => {
    const nav = strip.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;
    const n = nav.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < n.left || t.right > n.right) nav.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }, [pathname, sections.length]);
  if (sections.length < 2) return null;
  const tabs = (
    // Scrolls sideways rather than wrapping if a phone is ever too narrow for every tab.
    <nav ref={strip} aria-label={label} className={cx("edge-fade-x -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", action ? "min-w-0" : "mb-6")}>
      <div ref={row} className="relative inline-flex gap-0.5 rounded-xl bg-zinc-500/10 p-1 sm:gap-1">
        {pill && (
          <span
            aria-hidden="true"
            className="indicator absolute bottom-1 left-0 top-1 rounded-lg bg-white shadow-sm dark:bg-white/10"
            style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
          />
        )}
        {sections.map(({ to, label: name, icon: Icon, end, also, count }) => {
          const current = isCurrent(pathname, to, end) || Boolean(also?.test(pathname));
          // Phones: a size smaller and tighter, and no count under 380 px, so Jobs's five tabs fit a 360 px screen.
          return (
            <Link
              key={to}
              to={to}
              aria-current={current ? "page" : undefined}
              className={cx(
                "tap-y relative z-[1] inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[0.8125rem] font-medium transition-colors duration-quick sm:px-3 sm:text-sm",
                current
                  ? cx("text-zinc-900 dark:text-white", !pill && "bg-white shadow-sm dark:bg-white/10")
                  : "text-zinc-500 hover:text-zinc-900 active:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
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
