import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ChevronsUpDown } from "../icons";
import { cx, focusRing } from "./cx";

/**
 * Data display (DESIGN.md, "Data"): tables, stat tiles, avatars, progress, steps, pagination, breadcrumbs and tabs.
 * Presentational and router-free (links come in as children), so the web app and the desktop app share them.
 */

// ---- Tables -----------------------------------------------------------------------------------------------------

/**
 * A table on a card: hairline rows, a quiet sentence-case header, tabular figures, row hover. `stack` turns each row
 * into a card on phones (cells show their column's name: pass `label` to each Td); otherwise a wide table scrolls
 * sideways inside its card, never the page. `stickyHeader` keeps the header in view in a tall table.
 */
export function Table({
  children,
  label,
  stack = false,
  stickyHeader = false,
  dense = false,
  className,
}: {
  children: ReactNode;
  /** Names the table for screen readers (or give it a visible <caption>). */
  label?: string;
  stack?: boolean;
  stickyHeader?: boolean;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("glass-panel overflow-hidden rounded-2xl", className)}>
      <div className={cx("overflow-x-auto", stickyHeader && "max-h-[70vh] overflow-y-auto")}>
        <table
          aria-label={label}
          data-dense={dense || undefined}
          className={cx(
            "group/table w-full border-collapse text-left text-sm",
            stack && "table-stack",
            stickyHeader && "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1]",
          )}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-zinc-200 bg-zinc-50/80 dark:border-white/10 dark:bg-white/[0.02]">{children}</thead>;
}

export type SortDirection = "asc" | "desc" | null;

/**
 * A header cell. With `onSort` it's a sortable column: a button that says which way it's sorted (aria-sort on the
 * cell, an arrow beside the name; the two-way arrow while it isn't). `align="right"` for figures.
 */
export function Th({
  children,
  sort,
  onSort,
  align = "left",
  className,
  ...rest
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & { sort?: SortDirection; onSort?: () => void; align?: "left" | "right" }) {
  const Icon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={onSort ? (sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none") : undefined}
      {...rest}
      className={cx(
        "whitespace-nowrap bg-zinc-50 px-4 py-2.5 text-xs font-medium text-zinc-500 group-data-[dense]/table:py-2 dark:bg-zinc-900 dark:text-zinc-400",
        align === "right" && "text-right",
        className,
      )}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cx(
            "-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-zinc-900 dark:hover:text-white",
            sort && "text-zinc-900 dark:text-white",
            align === "right" && "flex-row-reverse",
            focusRing,
          )}
        >
          {children}
          <Icon className={cx("h-3.5 w-3.5", !sort && "opacity-50")} aria-hidden />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

/** A body row: hover tint, and `selected` (a checked row) in the accent's palest step. */
export function Tr({ children, selected, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      {...rest}
      aria-selected={selected || undefined}
      className={cx(
        "border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]",
        selected && "bg-indigo-500/[0.06] hover:bg-indigo-500/[0.09] dark:bg-indigo-400/[0.08]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** A body cell. `label` is the column's name, shown before the value when a `stack` table becomes cards on a phone;
 *  `primary` is the row's title cell (it leads the card). */
export function Td({
  children,
  label,
  primary,
  align = "left",
  className,
  ...rest
}: Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & { label?: string; primary?: boolean; align?: "left" | "right" }) {
  return (
    <td
      data-label={primary ? undefined : label}
      data-primary={primary || undefined}
      {...rest}
      className={cx(
        "px-4 py-3 align-middle text-zinc-700 group-data-[dense]/table:py-2 dark:text-zinc-300",
        align === "right" && "text-right tabular-nums",
        primary && "font-medium text-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** One full-width row saying the table is empty (or a search matched nothing), with an optional action. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {children}
      </td>
    </tr>
  );
}

/** Placeholder rows while a table loads, shaped like its columns. */
export function TableLoading({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" className="border-b border-zinc-100 last:border-0 dark:border-white/[0.06]">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-4 py-3.5">
              <div className={cx("skeleton-line h-3 motion-ok:animate-shimmer", c === 0 ? "w-2/3" : "w-1/2")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---- Stats, people, progress -------------------------------------------------------------------------------------

/** A number that matters, with its name above and a line of context under it. */
export function StatTile({ label, value, detail, className }: { label: ReactNode; value: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-xl bg-zinc-500/[0.06] p-3.5 dark:bg-white/[0.03]", className)}>
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="stat-value mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>}
    </div>
  );
}

/** A person's initials in a neutral circle (no photos: the app never shows people it doesn't have). Decorative
 *  unless `label` is given. */
export function Avatar({ name, size = "md", label, className }: { name: string; size?: "sm" | "md" | "lg"; label?: string; className?: string }) {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-200",
        size === "sm" && "h-7 w-7 text-[11px]",
        size === "md" && "h-9 w-9 text-xs",
        size === "lg" && "h-12 w-12 text-sm",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** How far along something is, 0 to `max`, as a bar with its name and value. Colour by meaning: the accent for
 *  progress, emerald for done, amber near a limit. */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = "accent",
  className,
}: {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  tone?: "accent" | "success" | "warning";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cx("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {valueText && <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{valueText}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"
      >
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-page ease-standard",
            tone === "accent" && "bg-indigo-600 dark:bg-indigo-400",
            tone === "success" && "bg-emerald-600 dark:bg-emerald-400",
            tone === "warning" && "bg-amber-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Steps in order: done ones ticked, the current one in the accent, the rest quiet. */
export function Stepper({ steps, current, label = "Progress", className }: { steps: string[]; current: number; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cx("flex flex-wrap items-center gap-x-2 gap-y-2 text-sm", className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} aria-current={now ? "step" : undefined} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                done && "bg-emerald-600 text-white",
                now && "bg-indigo-600 text-white",
                !done && !now && "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cx(now ? "font-medium text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-400")}>
              {s}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-zinc-300 dark:bg-white/15" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Previous / next through pages of a list, with where you are ("21–40 of 132"). */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = cx(
    "inline-flex h-[30px] items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]",
    focusRing,
  );
  return (
    <nav aria-label="Pages" className={cx("flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400", className)}>
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
        </button>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    </nav>
  );
}

/** Where a page sits ("Jobs AI / Tracker / Stripe"): pass the earlier levels as links and the last as text. */
export function Breadcrumbs({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx("text-sm text-zinc-600 dark:text-zinc-400", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {children.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5" aria-current={i === children.length - 1 ? "page" : undefined}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden />}
            <span className={i === children.length - 1 ? "font-medium text-zinc-900 dark:text-zinc-100" : undefined}>{c}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---- Tabs -------------------------------------------------------------------------------------------------------

/** The underline tab look, for tab lists that manage their own panels (a session's Review / Summary / Transcript). */
export const tabListClass = "relative flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10";
export function tabClass(active: boolean): string {
  return cx(
    "relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "border-indigo-600 text-zinc-900 dark:border-indigo-400 dark:text-white"
      : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-white",
    focusRing,
  );
}

/**
 * Tabs that switch a panel in place: an underline that slides to the chosen tab, arrow keys between tabs (Home and
 * End too), and the tab/tabpanel roles. `panel` renders the chosen tab's content.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
  className,
}: {
  label: string;
  tabs: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  /** Prefix for the tab and panel ids, so the panel can point back (aria-labelledby). */
  idBase: string;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setMark({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, tabs.length]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.value === value);
    const to =
      e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length]!;
    onChange(next.value);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className={cx(tabListClass, className)}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.value}`}
            aria-selected={on}
            // Only the chosen tab's panel is in the page, so only it points at one.
            aria-controls={on ? `${idBase}-panel-${t.value}` : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cx(tabClass(on), mark && "border-transparent dark:border-transparent")}
          >
            {t.label}
          </button>
        );
      })}
      {mark && (
        <span
          aria-hidden="true"
          className="indicator pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
          style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
        />
      )}
    </div>
  );
}

/** The panel a Tabs tab shows. */
export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} tabIndex={0} className={cx("focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}
