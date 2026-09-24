import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx, focusRing } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-900/20",
  secondary:
    "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger: "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40",
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
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-3.5 py-2 text-sm",
        size === "lg" && "px-5 py-3 text-base",
        VARIANT[variant],
        focusRing,
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800/80 dark:bg-zinc-900/50",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
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
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

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
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <span className="h-4 w-4 rounded-full border-2 border-zinc-300 border-t-indigo-500 motion-safe:animate-spin" aria-hidden="true" />
      {label}…
    </span>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
      <span className="flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cx("font-medium underline", focusRing)}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-800">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
