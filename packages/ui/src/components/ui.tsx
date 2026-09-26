import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx, focusRing } from "./cx";
import { OrbitLogo } from "./OrbitLogo";
import { SpotIllustration } from "./Illustrations";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary:
    "btn-sheen bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500 hover:shadow-glow",
  secondary:
    "border border-zinc-200 bg-white/90 text-zinc-900 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
  ghost: "text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5",
  danger: "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        // Pressed feedback on touch and click; no transform when motion is reduced.
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        VARIANT[variant],
        focusRing,
        className,
      )}
    />
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
    <div className="space-y-1.5">
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
            "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}

/** Loading: the Orbit mark with its ring spinning. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <OrbitLogo size={20} busy />
      {label}…
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
        <button type="button" onClick={onRetry} className={cx("font-medium underline", focusRing)}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  /** Shown inside the spot illustration. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-white/10">
      {icon && <SpotIllustration icon={icon} size={96} className="mb-4" />}
      <p className="font-display text-lg font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
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
