// Orbit for Business (D82): pieces the company app's screens share.
import type { ReactNode } from "react";
import type { BizJobStatus, BizPlan, BizRole } from "@orbit/types";
import { Badge, ErrorNote, Skeleton, cx, type BadgeTone } from "@orbit/ui";
import { ROLE_LABEL } from "./model";


export const JOB_STATUS: Record<BizJobStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  closed: { label: "Closed", tone: "neutral" },
};

export function JobStatusBadge({ status }: { status: BizJobStatus }) {
  const s = JOB_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const PLAN_LABEL: Record<BizPlan, string> = { free: "Free", starter: "Starter", growth: "Growth" };

export function RoleBadge({ role }: { role: BizRole }) {
  return <Badge tone={role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[role]}</Badge>;
}

/** A panel of the company app: a heading, an optional line, then its body. Dense, calm, bordered. */
export function Panel({ title, hint, actions, children, className, id }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-title` : undefined} className={cx("rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/60 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">
                {title}
              </h2>
            )}
            {hint && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton variant="line" count={2} className="max-w-sm" />
      <Skeleton variant="card" count={2} />
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return <ErrorNote {...(onRetry ? { onRetry } : {})}>{error.message || "Couldn't load this."}</ErrorNote>;
}

/** An error from the API, in words (ApiError's message is already the server's). */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

/** The API's code for a refusal, when it gave one (biz_limit, biz_unverified…). */
export function errorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>}
    </div>
  );
}

/** "Fields marked * are required" style hint under a form title. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-zinc-600 dark:text-zinc-400">{children}</p>;
}
