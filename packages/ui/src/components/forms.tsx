import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { useIndicator } from "../hooks/useIndicator";
import { Search } from "../icons";
import { cx, focusRing } from "./cx";
import { Input } from "./ui";

/**
 * The form controls beyond a text field (DESIGN.md, "Forms"). Native inputs underneath (a checkbox is an
 * <input type="checkbox">), so the keyboard, the screen reader and the browser's own behaviour come for free; base.css
 * draws checkboxes and radios in the accent so the tick can pop in. Every one has a visible label and a 24 px target
 * at least.
 */

/** A checkbox with its label (and an optional line under it). The whole row is the target. */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cx("flex min-h-6 cursor-pointer items-start gap-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50", className)}>
      <input
        type="checkbox"
        {...rest}
        className={cx("mt-0.5 h-4 w-4 shrink-0", focusRing)}
      />
      <span>
        <span className="block font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>}
      </span>
    </label>
  );
}

/**
 * One choice of several, as a group of radios with a visible legend. `options` in order; `value` the chosen one.
 */
export function RadioGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  className,
}: {
  legend: ReactNode;
  name: string;
  options: Array<{ value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }>;
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cx("min-w-0 space-y-2", className)}>
      <legend className="mb-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-6 cursor-pointer items-start gap-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className={cx("mt-0.5 h-4 w-4 shrink-0", focusRing)}
          />
          <span>
            <span className="block font-medium text-zinc-800 dark:text-zinc-200">{o.label}</span>
            {o.description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{o.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A range slider in the accent, with its label and the current value beside it. */
export function Slider({
  label,
  valueText,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; valueText?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx("min-w-0 space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={rest.id ?? id} className="font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </label>
        {valueText != null && <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{valueText}</span>}
      </div>
      <input id={id} type="range" {...rest} className={cx("h-6 w-full cursor-pointer accent-indigo-600 dark:accent-indigo-400", focusRing)} />
    </div>
  );
}

/** A search field: the search icon inside a regular field, `type="search"` so Escape clears it natively. */
export function SearchInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className={cx("relative min-w-0", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-400" />
      <Input type="search" {...rest} className="pl-9" />
    </div>
  );
}

/**
 * A few mutually exclusive views or settings side by side (Full / Gentle / Off, 7 days / 30 days), as a radio group
 * with a sliding indicator under the chosen one. Arrow keys move the choice, as in any radio group. For switching
 * between pages use tabs (ProductTabs) or links, not this.
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  describedBy,
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  /** Names the group for screen readers, unless `labelledBy` points at a visible label. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const mark = useIndicator(list, '[aria-checked="true"]', `${value}:${options.length}`);
  const enabled = options.filter((o) => !o.disabled);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.findIndex((o) => o.value === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = enabled[(i + step + enabled.length) % enabled.length]!;
    onChange(next.value);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKey}
      className={cx("relative inline-flex max-w-full rounded-xl bg-zinc-500/10 p-1", className)}
    >
      {mark && (
        <span
          aria-hidden="true"
          className="indicator absolute bottom-1 left-0 top-1 rounded-lg bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-white/10 dark:ring-white/10"
          style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              on ? "text-zinc-900 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              !mark && on && "bg-white shadow-sm dark:bg-white/10",
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
