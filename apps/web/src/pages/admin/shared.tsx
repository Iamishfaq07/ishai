import type { ReactNode } from "react";
import type { AdminUser } from "@orbit/types";
import { IndianRupee, ScrollText, Users, cx } from "@orbit/ui";
import { ProductTabs } from "../../components/products";

/** Pieces the admin pages share: their tabs, money and minutes in words, an account's badges. */

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
export const mins = (n: number) => `${Math.round(n).toLocaleString("en-IN")} min`;
export const count = (n: number) => n.toLocaleString("en-IN");

/** "30 Sep, 18:30", in the viewer's own time zone. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "30 Sep 2026". */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Users · Payments · Audit log, under each admin page's header. */
export function AdminTabs({ paymentsWaiting }: { paymentsWaiting?: number }) {
  return (
    <ProductTabs
      label="Admin"
      sections={[
        { to: "/admin/users", label: "Users", icon: Users },
        { to: "/admin/payments", label: "Payments", icon: IndianRupee, ...(paymentsWaiting ? { count: paymentsWaiting } : {}) },
        { to: "/admin/audit", label: "Audit log", icon: ScrollText },
      ]}
    />
  );
}

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1";

export function AccessBadge({ user }: { user: AdminUser }) {
  const tone =
    user.access === "pending"
      ? "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200"
      : user.access === "granted"
        ? "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25 dark:text-indigo-200"
        : "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300";
  const text =
    user.access === "pending"
      ? "Waiting for access"
      : user.access === "granted" && user.grant_until
        ? `${user.plan_label} until ${when(user.grant_until)}`
        : user.access === "admin"
          ? "Admin · Unlimited"
          : `Approved · ${user.plan_label}`;
  return <span className={cx(PILL, tone)}>{text}</span>;
}

export function SuspendedBadge() {
  return <span className={cx(PILL, "bg-rose-500/10 text-rose-800 ring-rose-500/25 dark:text-rose-300")}>Suspended</span>;
}

/** A small neutral tag ("You", "Note"). */
export function Tag({ children, title }: { children: string; title?: string }) {
  return (
    <span title={title} className={cx(PILL, "bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300")}>
      {children}
    </span>
  );
}

/** A section of the account drawer: a heading, an optional line under it, and its controls. */
export function Section({ title, hint, children, danger }: { title: string; hint?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section
      className={cx(
        "rounded-2xl border p-4",
        danger ? "border-rose-500/25 bg-rose-500/[0.03]" : "border-zinc-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.02]",
      )}
    >
      <h3 className={cx("text-sm font-semibold", danger && "text-rose-700 dark:text-rose-300")}>{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
