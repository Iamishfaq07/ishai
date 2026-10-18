import type { CSSProperties, ReactNode } from "react";
import { Check, Circle, cx, useCountUp } from "@orbit/ui";
import { at } from "./motion";

/**
 * The small pieces the product pages' renders are drawn with (DECISIONS D79): the workbench's own look (surfaces with
 * a hairline, ink, one accent, status colours for status), sized in rem so nothing depends on the screen, and every
 * part that moves in `.kp-*` (site.css) or driven by the render's clock (motion.ts). All decorative: the render's box
 * carries the words for screen readers (`role="img"` + `aria-label`, or an sr-only caption).
 */

/** A panel of the app inside a render: a surface with a hairline and, optionally, a title row. */
export function Panel({ title, meta, children, className, style }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div style={style} className={cx("rounded-xl border mk-line mk-surface", className)}>
      {(title || meta) && (
        <div className="flex items-center justify-between gap-3 border-b mk-line px-3 py-2">
          <span className="min-w-0 truncate text-[0.75rem] font-medium text-zinc-800 dark:text-zinc-100">{title}</span>
          {meta && <span className="shrink-0 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{meta}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** "Sample data": every render with made-up content says so. */
export function SampleTag({ children = "Sample", className }: { children?: ReactNode; className?: string }) {
  return <span className={cx("rounded-full bg-zinc-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-300", className)}>{children}</span>;
}

/** The colour of a score, as the app's rings draw it: green when it's strong, the accent when it's good, amber below. */
export function scoreStroke(value: number, max = 100): [string, string] {
  const r = value / max;
  return r >= 0.8 ? ["stroke-emerald-500", "stroke-emerald-500/15"] : r >= 0.6 ? ["stroke-indigo-500", "stroke-indigo-500/15"] : ["stroke-amber-500", "stroke-amber-500/20"];
}

/**
 * A score ring whose number counts (Full motion) from `from` to `value` once `start`: the fill says how it went, the
 * track is a pale step of the same colour. `suffix` "%" for a percentage. The number is aria-hidden: say it in words.
 */
export function Ring({ value, from = 0, start, size = 72, max = 100, suffix = "", sub, duration = 700 }: {
  value: number;
  from?: number;
  start: boolean;
  size?: number;
  max?: number;
  suffix?: string;
  sub?: ReactNode;
  duration?: number;
}) {
  const shown = useCountUp(value, start, { from, duration });
  const r = 34;
  const c = 2 * Math.PI * r;
  const [fill, track] = scoreStroke(shown, max);
  return (
    <span aria-hidden="true" className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className={track} />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(max, shown)) / max)} className={fill} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="stat-value font-semibold leading-none text-zinc-950 dark:text-white" style={{ fontSize: size * 0.3 }}>
          {Math.round(shown)}
          {suffix}
        </span>
        {sub && <span className="mt-0.5 text-[0.625rem] leading-none text-zinc-500 dark:text-zinc-400">{sub}</span>}
      </span>
    </span>
  );
}

/** Bars that fill from the left one after another (`.kp-fill`), each with its points. */
export function Bars({ rows, from = 200, every = 90, className }: {
  rows: Array<{ label: string; value: number; max: number }>;
  from?: number;
  every?: number;
  className?: string;
}) {
  return (
    <ul className={cx("space-y-2", className)}>
      {rows.map((row, i) => {
        const r = Math.max(0, Math.min(1, row.value / row.max));
        return (
          <li key={row.label} className="text-[0.75rem]">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-zinc-700 dark:text-zinc-200">{row.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {Number.isInteger(row.value) ? row.value : row.value.toFixed(1)}/{row.max}
              </span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-zinc-900/[0.06] dark:bg-white/10">
              <span
                className={cx("kp-fill block h-full rounded-full", r >= 0.999 ? "bg-emerald-500" : r >= 0.6 ? "bg-indigo-500" : "bg-amber-500")}
                style={{ width: `${r * 100}%`, ...at(from + i * every) }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Keywords: the ones covered light up one after another (a tick pops in), the missing ones stay dashed. */
export function Chips({ items, from = 300, every = 120, className }: { items: Array<{ label: string; on: boolean }>; from?: number; every?: number; className?: string }) {
  let n = 0;
  return (
    <ul className={cx("flex flex-wrap gap-1.5", className)}>
      {items.map(({ label, on }) => {
        const delay = on ? from + n++ * every : 0;
        return (
          <li
            key={label}
            style={on ? at(delay) : undefined}
            className={cx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
              on
                ? "kp-lit bg-emerald-500/10 text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-200"
                : "border border-dashed border-zinc-300 text-zinc-600 dark:border-white/20 dark:text-zinc-300",
            )}
          >
            {on && <Check className="kp-pop h-3 w-3" style={at(delay + 80)} strokeWidth={2.5} aria-hidden="true" />}
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/** Rows that tick off one by one (`times`: when each is done, from the render's clock; CSS pops the tick at the same
 *  moment), each with what it adds on the right. */
export function TickRows({ rows, times, className }: { rows: Array<{ label: ReactNode; meta?: ReactNode; note?: ReactNode }>; times: readonly number[]; className?: string }) {
  return (
    <ul className={cx("space-y-1.5", className)}>
      {rows.map((row, i) => (
        <li key={i} className="flex items-start gap-2 text-[0.75rem] leading-snug">
          <span className="relative mt-px grid h-4 w-4 shrink-0 place-items-center">
            <Circle className="absolute h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
            <span className="kp-pop absolute grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white" style={at(times[i] ?? 0)}>
              <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-zinc-800 dark:text-zinc-100">{row.label}</span>
            {row.note && <span className="block text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{row.note}</span>}
          </span>
          {row.meta && (
            <span className="kp-grow shrink-0 rounded-full bg-emerald-500/10 px-1.5 text-[0.6875rem] font-semibold tabular-nums text-emerald-800 dark:text-emerald-200" style={at((times[i] ?? 0) + 120)}>
              {row.meta}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Text as it's typed: the words so far, and the caret while it types. The box keeps the full text's room (an
 *  invisible copy under it), so nothing around it moves while the words come in; once it's all there (and in the
 *  built HTML) it's the text alone, in the same room. */
export function Typed({ text, shown, typing, className }: { text: string; shown: string; typing: boolean; className?: string }) {
  if (!typing && shown === text) return <span className={cx("block", className)}>{text}</span>;
  return (
    <span className={cx("relative block", className)}>
      <span aria-hidden="true" className="invisible block">
        {text}
      </span>
      <span className="absolute inset-0 block">
        {shown}
        {typing && <span className="mk-caret" />}
      </span>
    </span>
  );
}

/** A message in a chat: yours on the right in ink, the AI's on the left in the accent's tint. */
export function Bubble({ from, children, className, style }: { from: "you" | "ai"; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      style={style}
      className={cx(
        "max-w-[90%] rounded-2xl px-3 py-2 text-[0.75rem] leading-relaxed",
        from === "you"
          ? "ml-auto rounded-br-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
          : "rounded-bl-md bg-indigo-500/[0.07] text-zinc-800 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/10 dark:text-zinc-100 dark:ring-indigo-300/15",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A button drawn inside a render (not a control: the render is a picture). */
export function FakeButton({ children, primary = false, className, style }: { children: ReactNode; primary?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      style={style}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[0.6875rem] font-medium",
        primary ? "bg-indigo-600 text-white" : "border border-zinc-200 text-zinc-700 dark:border-white/15 dark:text-zinc-200",
        className,
      )}
    >
      {children}
    </span>
  );
}
