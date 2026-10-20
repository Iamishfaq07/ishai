import type { ContactContext, ContactStatus, InboxCounts, InboxFilter, InboxMessage } from "@orbit/types";

/** The Inbox's small decisions, kept free of React so they're unit-tested (inbox.test.ts). */

/** The list's tabs, in order; "To answer" (new and open) first. */
export const INBOX_FILTERS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: "todo", label: "To answer" },
  { id: "new", label: "Unread" },
  { id: "done", label: "Done" },
  { id: "spam", label: "Spam" },
  { id: "all", label: "All" },
];

export function readFilter(value: string | null): InboxFilter {
  return INBOX_FILTERS.find((f) => f.id === value)?.id ?? "todo";
}

/** How many a tab holds, from the server's counts. */
export function filterCount(counts: InboxCounts | undefined, id: InboxFilter): number {
  return counts ? counts[id] : 0;
}

export const STATUS_LABEL: Record<ContactStatus, string> = { new: "Unread", open: "To answer", done: "Done", spam: "Spam" };

/** The unread badge's text: the number, capped so it never widens the tab. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** "3 unread messages", for the badge's accessible name. */
export function unreadLabel(n: number): string {
  return `${n} unread message${n === 1 ? "" : "s"}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** How a reply starts: "Hi Asha," and a blank line. */
export function greeting(name: string): string {
  const first = firstName(name);
  return `Hi${first ? ` ${first}` : ""},\n\n`;
}

/** A link the admin may follow: only http(s), never `javascript:` (the context came from a page, so it's checked). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\/[^\s/]/i.test(url) ? url : null;
}

const QUOTE_MAX = 1500;

/** The sender's message quoted, each line after "> ", cut short when long (mailto: links have a length limit). */
export function quoted(message: string, max = QUOTE_MAX): string {
  const text = message.length > max ? `${message.slice(0, max).trimEnd()}…` : message;
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** The reply's subject, as the in-app reply sends it: "Re: Payment or credits (C-1A2B3C4D)". */
export function replySubject(m: Pick<InboxMessage, "topic_label" | "reference">): string {
  return `Re: ${m.topic_label} (${m.reference})`;
}

/**
 * Reply from the admin's own mail app: a mailto: link to the sender with the subject "Re: <topic>", what's typed so
 * far (or a greeting), and their message quoted. Line breaks as CRLF, as mailto: bodies want them (RFC 6068).
 */
export function mailtoReply(m: Pick<InboxMessage, "email" | "name" | "topic_label" | "reference" | "message" | "created_at">, typed = ""): string {
  const sent = new Date(m.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const body = `${typed.trim() ? `${typed.trimEnd()}\n\n` : greeting(m.name)}\nOn ${sent} you wrote (${m.reference}):\n${quoted(m.message)}\n`;
  const to = encodeURIComponent(m.email).replace(/%40/gi, "@");
  return `mailto:${to}?subject=${encodeURIComponent(replySubject(m))}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
}

/** A phone number's digits for wa.me (Indian numbers without +91 get it). Null when it isn't one. */
export function whatsappNumber(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits.replace(/^0+/, "") : null;
}

export interface ContextRow {
  label: string;
  value: string;
  /** Outside link (the job post), http(s) only. */
  href?: string;
  /** In-app link (the job in Jobs). */
  to?: string;
}

/** The message's context as rows for the panel: the reported job, why, and the page it was sent from. */
export function contextRows(ctx: ContactContext | null): ContextRow[] {
  if (!ctx) return [];
  const rows: ContextRow[] = [];
  if (ctx.listing_id || ctx.listing_title) {
    const what = ctx.listing_title ? `${ctx.listing_title}${ctx.listing_company ? ` at ${ctx.listing_company}` : ""}` : "A job from Jobs";
    const href = safeHttpUrl(ctx.listing_url);
    rows.push({ label: "Job", value: what, ...(href ? { href } : {}) });
    if (ctx.listing_id && /^[A-Za-z0-9_-]+$/.test(ctx.listing_id)) {
      rows.push({ label: "In Jobs", value: ctx.listing_id, to: `/jobs/listing/${encodeURIComponent(ctx.listing_id)}` });
    }
  }
  if (ctx.reason) rows.push({ label: "What's wrong", value: ctx.reason });
  if (ctx.page) rows.push({ label: "Sent from", value: ctx.page });
  if (ctx.platform) rows.push({ label: "App", value: ctx.platform === "web" ? "Website" : ctx.platform.replace("desktop-", "Desktop v") });
  // The sender's own session: its id to look up in the logs (an admin can't open another account's session page).
  if (ctx.latest_session_id) rows.push({ label: "Latest session", value: ctx.latest_session_id });
  return rows;
}
