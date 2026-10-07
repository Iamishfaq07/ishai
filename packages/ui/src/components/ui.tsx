import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx, focusRing } from "./cx";
import { Orb, type OrbState } from "./Orb";
import { SPARK, SpotIllustration } from "./Illustrations";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "btn-sheen bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500 hover:shadow-glow",
  secondary:
    "border border-zinc-200 bg-white/90 text-zinc-900 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
  ghost: "text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5",
  danger: "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10",
};

/**
 * The Button look as a class string, for things that act like a button but aren't a <button>: router links,
 * `<a href>`, a file input's <label>. One source, so a link-button never drifts from the real thing.
 */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(
    // Pressed feedback on touch and click, at Full motion only (buttons get theirs from base.css).
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-quick ease-standard motion-ok:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" && "px-2.5 py-1.5 text-xs",
    size === "md" && "px-4 py-2 text-sm",
    size === "lg" && "px-6 py-3 text-base",
    VARIANT[variant],
    focusRing,
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: keeps its label (no "Starting…" swap), shows a small orb before it and ignores presses. Unlike
   *  `disabled` it keeps keyboard focus where it was. */
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest["aria-disabled"] || undefined}
      // preventDefault also stops a busy submit button from sending its form again.
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={buttonClass(variant, size, cx(loading && "cursor-progress", className))}
    >
      {loading && <Orb size={20} theme={variant === "primary" ? "dark" : "auto"} className={size === "sm" ? "-my-1" : undefined} />}
      {children}
    </button>
  );
}

/** Frosted-glass surface. `interactive` adds a hover lift for cards that are links or buttons. */
export function Card({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <div
      className={cx(
        "glass-panel rounded-2xl p-5",
        interactive && "lift hover:border-indigo-400/40 dark:hover:border-indigo-400/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-aurora-400/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-300">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    // min-w-0: a select sizes to its longest option; without this it stretches a grid column past a phone's width.
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

const control =
  "block w-full rounded-xl border border-zinc-200 bg-white/90 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors hover:border-zinc-300 focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-950/60 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/20 dark:focus:border-indigo-400";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, focusRing, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, focusRing, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, focusRing, props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("flex w-full items-start justify-between gap-4 rounded-lg text-left disabled:opacity-50", focusRing)}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-glow-sm" : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-press ease-standard",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}

/** Loading: a dotted orb whose animation says what is going on (`state`), with the words beside it. `big` stacks a
 *  larger orb over the words, for a page or panel that is loading. */
export function Spinner({ label = "Loading", state = "working", big = false }: { label?: string; state?: OrbState; big?: boolean }) {
  return (
    <span
      role="status"
      className={cx(
        "inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400",
        big && "flex w-full flex-col justify-center gap-3 py-12 text-center",
      )}
    >
      <Orb state={state} size={big ? 64 : 20} />
      {label.replace(/[.…]+$/, "")}…
    </span>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"
    >
      <span className="flex-1">{children}</span>
      {onRetry && (
        // Padded to a 24 px target (WCAG 2.5.8) without moving the text.
        <button type="button" onClick={onRetry} className={cx("-my-1 rounded px-1 py-1 font-medium underline", focusRing)}>
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * What a screen says when it has nothing to show: a headline, one line and one imperative action, in four kinds.
 * - `first-use` (default): nothing yet. `preview` (a GhostPreview) shows, faded, what will fill the screen.
 * - `no-results`: a search or filter matched nothing. Say what was searched; offer to clear or widen it.
 * - `cleared`: everything done ("No follow-ups due. Nice."). A small, still celebration unless `art` says otherwise.
 * - `offline`: couldn't load. Say what happened; `onRetry` adds Try again. Announced like an error.
 * Never show one while loading: that's a Skeleton. (Kept in this module: it's on most pages.)
 */
export type EmptyKind = "first-use" | "no-results" | "cleared" | "offline";

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** The one thing to do next: a Button, or a link styled with buttonClass(). */
  action?: ReactNode;
  kind?: EmptyKind;
  /** A lucide icon, shown in Orbit's spot illustration. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Larger art (one of the Orbit scenes); replaces `icon`. Decorative. */
  art?: ReactNode;
  /** First use: a faded picture of the filled screen above the words. Decorative and inert. */
  preview?: ReactNode;
  /** Offline: what Try again does. */
  onRetry?: () => void;
  className?: string;
}

export function EmptyState({ title, body, action, kind = "first-use", icon, art, preview, onRetry, className }: EmptyStateProps) {
  const picture = art ?? (icon ? <SpotIllustration icon={icon} size={96} /> : kind === "cleared" && <ClearedMark />);
  const ghost = preview != null && preview !== false;
  return (
    <div
      role={kind === "offline" ? "alert" : undefined}
      className={cx(
        "relative flex flex-col items-center overflow-hidden rounded-2xl px-6 text-center",
        kind === "no-results" ? "py-8" : "border border-dashed py-10",
        kind === "cleared" ? "border-emerald-500/30 dark:border-emerald-400/20" : "border-zinc-300 dark:border-white/10",
        ghost && "pt-6",
        className,
      )}
    >
      {ghost && (
        <div
          aria-hidden="true"
          inert
          className="pointer-events-none mb-2 w-full max-w-2xl select-none opacity-80 [mask-image:linear-gradient(to_bottom,black_35%,transparent_95%)]"
        >
          {preview}
        </div>
      )}
      {picture && <div className={cx("mb-4", ghost && "-mt-12")}>{picture}</div>}
      <p className={cx("text-balance font-display text-lg font-medium", ghost && !picture && "-mt-6")}>{title}</p>
      {body && <div className="mx-auto mt-1 max-w-md text-pretty text-sm text-zinc-500 dark:text-zinc-400">{body}</div>}
      {(action || onRetry) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/** "All done": a ticked ring with two of Orbit's sparks, still. */
function ClearedMark() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20 overflow-visible" aria-hidden="true" focusable="false">
      <circle cx="48" cy="48" r="40" className="fill-none stroke-emerald-500/25" strokeDasharray="2 6" />
      <circle cx="48" cy="48" r="26" className="fill-emerald-500/10 stroke-emerald-500 dark:stroke-emerald-400" strokeWidth="2" />
      <path d="M37 49 l7.5 7.5 L60 41" className="fill-none stroke-emerald-600 dark:stroke-emerald-300" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={SPARK(84, 20, 6)} className="fill-aurora-400" />
      <path d={SPARK(12, 70, 4)} className="fill-indigo-400" />
    </svg>
  );
}

export function Meter({ level, label }: { level: number; label: string }) {
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-aurora-400 transition-[width] duration-75 motion-reduce:transition-none"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}
