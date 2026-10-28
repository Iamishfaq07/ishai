import type { ReactNode } from "react";
import type { AdminUser } from "@orbit/types";
import { Badge, ChartColumn, Building2, Headphones, Inbox, IndianRupee, Megaphone, ScrollText, Users, cx, rupees, wholeMinutes } from "@orbit/ui";
import { ProductTabs } from "../../components/products";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

/** Pieces the admin pages share: their tabs, money and minutes in words, an account's badges. */

export const inr = rupees;
export const mins = (n: number) => `${wholeMinutes(n).toLocaleString("en-IN")} min`;
export const count = (n: number) => n.toLocaleString("en-IN");

/** "30 Sep, 18:30", in the viewer's own time zone. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** "30 Sep 2026". */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * How many Contact messages are unread, for the Inbox tab: `known` when the page has the number already (the Inbox
 * itself), else fetched (one cheap request, cached across the admin pages).
 */
export function useInboxUnread(known?: number): number | undefined {
  const fetched = useAsync(
    () => (known !== undefined ? Promise.resolve(known) : api.adminInbox({ status: "new", limit: 1 }).then((r) => r.counts.new)),
    [known === undefined],
    known === undefined ? "admin-inbox-unread" : undefined,
  );
  return known ?? fetched.data ?? undefined;
}

/** Users · Payments · Inbox · Support · Referrals · Business · Audit log, under each admin page's header. The Inbox tab counts unread
 *  messages. */
export function AdminTabs({ paymentsWaiting, inboxUnread }: { paymentsWaiting?: number; inboxUnread?: number }) {
  const unread = useInboxUnread(inboxUnread);
  return (
    <ProductTabs
      label="Admin"
      sections={[
        { to: "/admin/users", label: "Users", icon: Users },
        { to: "/admin/insights", label: "Insights", icon: ChartColumn },
        { to: "/admin/payments", label: "Payments", icon: IndianRupee, ...(paymentsWaiting ? { count: paymentsWaiting } : {}) },
        { to: "/admin/inbox", label: "Inbox", icon: Inbox, ...(unread ? { count: unread } : {}) },
        { to: "/admin/support", label: "Support", icon: Headphones },
        { to: "/admin/referrals", label: "Referrals", icon: Megaphone },
        { to: "/admin/business", label: "Business", icon: Building2 },
        { to: "/admin/audit", label: "Audit log", icon: ScrollText },
      ]}
    />
  );
}

// The admin's status pills are the shared Badge: amber waiting, accent on a grant, emerald approved, rose suspended.
export function AccessBadge({ user }: { user: AdminUser }) {
  const tone = user.access === "pending" ? "warning" : user.access === "granted" ? "accent" : "success";
  const text =
    user.access === "pending"
      ? "Waiting for access"
      : user.access === "granted" && user.grant_until
        ? `${user.plan_label} until ${when(user.grant_until)}`
        : user.access === "admin"
          ? "Admin · Unlimited"
          : `Approved · ${user.plan_label}`;
  return <Badge tone={tone}>{text}</Badge>;
}

export function SuspendedBadge() {
  return <Badge tone="danger">Suspended</Badge>;
}

/** A small neutral tag ("You", "Note"). */
export function Tag({ children, title }: { children: string; title?: string }) {
  return (
    <span title={title}>
      <Badge>{children}</Badge>
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
