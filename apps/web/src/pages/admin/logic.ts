import type { AdminUserSort } from "@orbit/types";

/** The console's small decisions, kept free of React so they're unit-tested (logic.test.ts). */

/** A count typed into a box: a whole number from 0, anything else 0. */
export function wholeNumber(text: string): number {
  const n = Math.floor(Number(text.trim()));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * What removing `asked` from a balance of `left` will do, as the server decides it: never below zero, so asking for
 * more takes what is there (`clamped`). `all` is "set to zero".
 */
export function plannedRemoval(left: number, asked: number, all = false): { take: number; after: number; clamped: boolean } {
  const balance = Math.max(0, left);
  const take = all ? balance : Math.min(Math.max(0, asked), balance);
  return { take, after: Math.max(0, Math.round((balance - take) * 10) / 10), clamped: !all && asked > balance };
}

export interface SortState {
  sort: AdminUserSort;
  order: "asc" | "desc";
}

/** A column header's click: the same column flips the order, another starts at its natural one (A to Z for emails,
 * biggest or newest first for the rest). */
export function nextSort(current: SortState, column: AdminUserSort): SortState {
  if (current.sort === column) return { sort: column, order: current.order === "asc" ? "desc" : "asc" };
  return { sort: column, order: column === "email" ? "asc" : "desc" };
}

/** The top of a bar chart's axis: a round number (1, 2, 5 × 10ⁿ) at or above the biggest value; at least 1. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

/** "Today", "Yesterday", "3 days ago", "5 weeks ago", or the date, for when an account was last active. */
export function sinceText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Never";
  const then = new Date(iso);
  const day = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
  const days = day(now) - day(then);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const ACTION_LABEL: Record<string, string> = {
  "admin.access.grant": "Gave a plan for a while",
  "admin.access.approve": "Approved for good",
  "admin.access.revoke": "Took access away",
  "admin.credits": "Gave credits",
  "admin.credits.remove": "Removed credits",
  "admin.user.suspend": "Suspended the account",
  "admin.user.unsuspend": "Unsuspended the account",
  "admin.user.sign_out": "Signed it out everywhere",
  "admin.user.password_reset": "Sent a password reset",
  "admin.user.update": "Edited the account",
  "admin.user.delete": "Deleted the account",
  "admin.users.export": "Exported accounts (CSV)",
  "admin.payment.approve": "Approved a payment",
  "admin.payment.reject": "Rejected a payment",
  "admin.config": "Changed settings",
  "admin.contact.update": "Updated a message",
  "admin.contact.reply": "Replied to a message",
  "admin.contact.delete": "Deleted a message",
  "auth.register": "Signed up",
  "auth.login": "Signed in",
  "auth.login_suspended": "Tried to sign in while suspended",
  "auth.logout_all": "Signed out everywhere",
  "auth.verify_email": "Verified the email",
  "auth.password_reset_request": "Asked for a password reset",
  "auth.password_reset": "Reset the password",
  "auth.password_change": "Changed the password",
  "auth.email_change_request": "Asked to change the email",
  "auth.email_changed": "Changed the email",
  "auth.delete_account": "Deleted their own account",
  "session.delete_transcript": "Deleted a transcript",
};

/** An audit action in words ("admin.user.suspend" → "Suspended the account"); unknown ones as they are. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

const LEADING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*/i;

/** What an audit entry says beyond its account: its target without the leading id (the account's, or a payment's,
 * which says nothing to a person). */
export function auditDetail(target: string | null, subjectId: string | null): string {
  const text = (target ?? "").trim();
  if (subjectId && text.startsWith(subjectId)) return text.slice(subjectId.length).trim();
  return text.replace(LEADING_ID, "");
}

/** A dismissed announcement stays dismissed until its text (and so its id) changes. */
export function announcementVisible(id: string | null, text: string | null, dismissedId: string | null): boolean {
  return Boolean(id && text && id !== dismissedId);
}

/** The CSV's file name for today. */
export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `orbit-accounts-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
