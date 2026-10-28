import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx, focusRing, useInView } from "@orbit/ui";
import { barPath, columnHeight, columnLayout, growDelay, niceCeiling, peakIndex } from "../lib/chart";

export type Column = { key: string; label: string; value: number };

/** Room above the plot, so the busiest column's number always fits over it, even at the top of the axis. */
const HEAD = 16;

/** The element's width in CSS pixels, kept current (the chart draws in real pixels: exact 2 px gaps and 4 px ends). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/**
 * One series over time as columns (one hue: the title says what's plotted, so there's no legend). The busiest column
 * carries its number; hover, a tap or the arrow keys show any other, value first; "Show the numbers" is the same as a
 * table. The first time it's in view the columns grow up from the baseline, one after another (Full motion; a fade at
 * Gentle; base.css `.chart`). `columns` undefined: still loading, so the frame holds, faded, instead of jumping.
 */
export function ColumnChart({
  title,
  columns,
  unit,
  total,
  axis,
  header,
  empty,
  format = (n) => n.toLocaleString(),
  height = 96,
  className,
}: {
  title: string;
  columns: Column[] | undefined;
  /** A value in words, for the tooltip and screen readers: "3 sign-ups". */
  unit: (n: number) => string;
  /** The line beside the title: "41 in 30 days". */
  total?: string;
  /** Under the first and the last column: ["2 Oct", "Today"]. */
  axis: [string, string];
  /** The table's two headings: ["Day", "Sign-ups"]. */
  header: [string, string];
  /** Said across the plot when every value is zero. */
  empty: string;
  format?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const [figure, seen] = useInView<HTMLElement>();
  const [box, width] = useWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<number | null>(null);
  const cols = columns ?? [];
  const max = Math.max(0, ...cols.map((c) => c.value));
  const ceiling = niceCeiling(max);
  const { slot, bar, x } = columnLayout(width, cols.length);
  const peak = peakIndex(cols.map((c) => c.value));
  const sum = cols.reduce((a, c) => a + c.value, 0);
  const shown = active !== null ? cols[active] : undefined;
  // The tooltip sits over its column, or against the chart's edge for the outer quarters, so it never runs off.
  const tip = active === null ? "mid" : active < cols.length / 4 ? "start" : active >= (cols.length * 3) / 4 ? "end" : "mid";
  const onKey = (e: KeyboardEvent) => {
    if (!cols.length) return;
    const last = cols.length - 1;
    const from = active ?? last;
    const to = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, to)));
  };
  return (
    // min-w-0: a grid cell takes the column's width, so the chart measures that (not its own first drawing).
    <figure ref={figure} data-shown={seen ? "" : undefined} className={cx("chart min-w-0", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium">{title}</span>
        {total !== undefined && <span className="text-xs text-zinc-500 dark:text-zinc-400">{columns ? total : "…"}</span>}
      </figcaption>
      <div
        ref={box}
        tabIndex={cols.length ? 0 : -1}
        role="group"
        aria-label={`${title}. Use the arrow keys to read each one.`}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? (cols.length ? cols.length - 1 : null))}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className={cx("relative mt-2 rounded-md transition-opacity duration-quick", focusRing, !columns && "opacity-50")}
      >
        <span className="absolute left-0 text-xs leading-none text-zinc-500 tabular-nums dark:text-zinc-400" style={{ top: HEAD - 5 }} aria-hidden>
          {format(ceiling)}
        </span>
        <svg width={width} height={HEAD + height} className="block overflow-visible" aria-hidden>
          {/* The axis top and its half (none across an empty chart, where the words sit). */}
          {(sum > 0 ? [0, 0.5] : [0]).map((f) => (
            <line key={f} x1={24} x2={width} y1={HEAD + height * f + 0.5} y2={HEAD + height * f + 0.5} className="stroke-zinc-200 dark:stroke-white/10" strokeWidth={1} />
          ))}
          <line x1={0} x2={width} y1={HEAD + height - 0.5} y2={HEAD + height - 0.5} className="stroke-zinc-300 dark:stroke-white/20" strokeWidth={1} />
          <g className="chart-marks">
            {cols.map((c, i) => {
              const h = columnHeight(c.value, ceiling, height);
              return h > 0 ? (
                <path
                  key={c.key}
                  d={barPath(x(i), bar, h, HEAD + height)}
                  style={{ animationDelay: `${growDelay(i, cols.length)}ms` }}
                  className={cx(
                    "chart-bar transition-colors duration-quick",
                    active === i ? "fill-indigo-400 dark:fill-indigo-300" : "fill-indigo-600 dark:fill-indigo-500",
                  )}
                />
              ) : null;
            })}
          </g>
          {/* The whole slot is the hit target, not just the painted bar. */}
          {cols.map((c, i) => (
            <rect key={c.key} x={i * slot} y={0} width={slot} height={HEAD + height} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
          ))}
        </svg>
        {/* Hidden, not unmounted, while another column is read: its entrance plays only once. */}
        {peak >= 0 && (
          <span
            className={cx(
              "chart-marks chart-label pointer-events-none absolute -translate-x-1/2 text-xs font-medium text-zinc-700 dark:text-zinc-200",
              active !== null && "invisible",
            )}
            style={{ left: (peak + 0.5) * slot, top: HEAD + height - columnHeight(max, ceiling, height) - 15 }}
            aria-hidden
          >
            {format(max)}
          </span>
        )}
        {columns && sum === 0 && (
          <span className="pointer-events-none absolute inset-x-0 text-center text-xs text-zinc-500 dark:text-zinc-400" style={{ top: HEAD + height / 2 - 8 }}>
            {empty}
          </span>
        )}
        {shown && active !== null && (
          <div
            className={cx(
              "pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-popover dark:border-white/10 dark:bg-zinc-900",
              tip === "mid" && "-translate-x-1/2",
            )}
            style={tip === "start" ? { left: 0 } : tip === "end" ? { right: 0 } : { left: (active + 0.5) * slot }}
            aria-hidden
          >
            <strong className="font-semibold">{unit(shown.value)}</strong>
            <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{shown.label}</span>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {shown ? `${shown.label}: ${unit(shown.value)}` : ""}
        </span>
      </div>
      <div className="mt-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400" aria-hidden>
        <span>{cols.length ? axis[0] : ""}</span>
        <span>{axis[1]}</span>
      </div>
      <details className="mt-1 text-xs">
        <summary className={cx("w-fit cursor-pointer select-none rounded py-1 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100", focusRing)}>
          Show the numbers
        </summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-0.5 font-medium">{header[0]}</th>
              <th scope="col" className="py-0.5 text-right font-medium">{header[1]}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...cols].reverse().map((c) => (
              <tr key={c.key}>
                <td className="py-0.5">{c.label}</td>
                <td className="py-0.5 text-right">{format(c.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
