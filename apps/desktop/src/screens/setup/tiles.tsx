import type { ReactNode } from "react";
import { SelectCheck, cx } from "@orbit/ui";

/**
 * Setup's choice tiles: a real radio (or checkbox) inside a label, so arrows, Space and screen readers work as they
 * do for any radio group; the tile is its picture. The chosen one wears the accent's ring and a tick.
 */
export function ChoiceTile({
  name,
  value,
  checked,
  onChange,
  disabled,
  type = "radio",
  art,
  title,
  detail,
  aside,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  type?: "radio" | "checkbox";
  art?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** At the tile's end: a level meter, a badge. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cx(
        "group relative flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border bg-white py-2.5 pl-3 pr-9 text-left transition-colors duration-quick dark:bg-zinc-950",
        checked
          ? "border-indigo-500 ring-1 ring-inset ring-indigo-500 dark:border-indigo-400 dark:ring-indigo-400"
          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]",
        disabled && "cursor-not-allowed opacity-50 hover:border-zinc-200 hover:bg-white dark:hover:border-white/10 dark:hover:bg-zinc-950",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-500",
        className,
      )}
    >
      <input type={type} name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      {art}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{detail}</span>}
      </span>
      {aside}
      <SelectCheck on={checked} />
    </label>
  );
}

/** Five bars that rise with `level` (0..1): a source's sound right now. `label` names it for screen readers. */
export function LevelBars({ level, label, className }: { level: number; label: string; className?: string }) {
  const bars = [0.08, 0.25, 0.45, 0.65, 0.85];
  const on = level > 0.04;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className={cx("flex h-4 shrink-0 items-end gap-[2px]", className)}
    >
      {bars.map((b, i) => (
        <span
          key={b}
          aria-hidden="true"
          className={cx("w-[3px] rounded-full", on && level >= b ? "bg-emerald-500 dark:bg-emerald-400" : "bg-zinc-300 dark:bg-white/15")}
          style={{ height: `${5 + i * 2.5}px` }}
        />
      ))}
    </span>
  );
}

/** An app's own icon when Windows gives one, else its initial on a neutral tile. */
export function AppMark({ icon, name }: { icon: string | null | undefined; name: string }) {
  return icon ? (
    <img src={icon} alt="" aria-hidden="true" className="h-7 w-7 shrink-0 rounded-md" draggable={false} />
  ) : (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** A setup section: its number (or a tick when it's done), its question, a line, then its content. */
export function SetupSection({
  id,
  n,
  title,
  line,
  done,
  attention,
  actions,
  children,
}: {
  id: string;
  n: number;
  title: string;
  line?: ReactNode;
  done?: boolean;
  attention?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/[0.07] dark:bg-zinc-950">
      <div className="mb-4 flex items-start gap-3">
        <StepBadge n={n} done={done} attention={attention} />
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-tight">
            {title}
          </h2>
          {line && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{line}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A step's number, a tick when it's done, amber when it wants a look. */
export function StepBadge({ n, done, attention, size = "md" }: { n: number; done?: boolean; attention?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums ring-1 ring-inset transition-colors duration-quick",
        size === "sm" ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-xs",
        attention
          ? "bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-200"
          : done
            ? "bg-emerald-600 text-white ring-transparent dark:bg-emerald-500"
            : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
      )}
    >
      {attention ? "!" : done ? <Tick /> : n}
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
