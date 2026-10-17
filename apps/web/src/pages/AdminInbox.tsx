import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ContactTopic, InboxFilter, InboxItem, InboxMessage } from "@orbit/types";
import { Briefcase, ChevronDown, CosmicEmptyState, Inbox, LoadGate, Reply, Search, UserRound, cx, focusRing } from "@orbit/ui";
import { Button, ErrorNote, Input, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { CONTACT_TOPICS } from "../lib/contactForm";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { MessageDrawer, StatusBadge } from "./admin/MessageDrawer";
import { INBOX_FILTERS, badgeText, filterCount, readFilter } from "./admin/inbox";
import { AdminTabs, Tag, when } from "./admin/shared";

const PAGE = 50;
const EMPTY: Record<InboxFilter, { title: string; body: string }> = {
  todo: { title: "Nothing to answer", body: "You're all caught up. Messages from the Contact page land here." },
  new: { title: "No unread messages", body: "New messages from the Contact page show here first." },
  done: { title: "Nothing done yet", body: "Messages you reply to or mark done move here." },
  spam: { title: "No spam", body: "Mark a message as spam to move it out of the way." },
  all: { title: "No messages yet", body: "When someone writes from the Contact page, it appears here." },
};

/**
 * Admin: the Contact page's messages (pages/Contact.tsx), newest first. Tabs by status ("To answer" first) with
 * counts, a topic filter and a search (name, email, phone, the words, or the reference). A message opens in a panel
 * (`?m=`) to read, reply (from Orbit or your mail app), mark done, reopen, mark as spam or unread, note and delete.
 * Filters, search and the open message live in the address, so Back and a shared link find it as it was.
 */
export function AdminInboxPage() {
  const [params, setParams] = useSearchParams();
  const status = readFilter(params.get("status"));
  const topicParam = params.get("topic");
  const topic: ContactTopic | "" = CONTACT_TOPICS.some((t) => t.id === topicParam) ? (topicParam as ContactTopic) : "";
  const q = params.get("q") ?? "";
  const openId = params.get("m");
  const update = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace },
    );
  const [search, setSearch] = useState(q);
  useEffect(() => {
    if (search.trim() === q) return;
    const t = window.setTimeout(() => update({ q: search.trim() || null }, true), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const key = `admin-inbox-${status}-${topic}-${q}`;
  const query = { status, ...(topic ? { topic } : {}), ...(q ? { q } : {}) } as const;
  const first = useAsync(() => api.adminInbox({ ...query, limit: PAGE }), [status, topic, q], key);
  const [more, setMore] = useState<{ key: string; items: InboxItem[]; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const extra = more?.key === key ? more : null;
  const items = useMemo(() => [...(first.data?.items ?? []), ...(extra?.items ?? [])], [first.data, extra]);
  const hasMore = extra ? extra.hasMore : Boolean(first.data?.has_more);
  const counts = first.data?.counts;

  /** After the panel changed a message: its row at once, then the counts (and whether it still fits this tab). */
  const changed = (m: InboxMessage) => {
    const patch = (rows: InboxItem[]) => rows.map((r) => (r.id === m.id ? { ...r, status: m.status, replies: m.replies.length } : r));
    first.setData((prev) => prev && { ...prev, items: patch(prev.items) });
    setMore((prev) => prev && { ...prev, items: patch(prev.items) });
    first.reload();
  };
  const removed = (id: string) => {
    first.setData((prev) => prev && { ...prev, items: prev.items.filter((r) => r.id !== id), total: Math.max(0, prev.total - 1) });
    setMore((prev) => prev && { ...prev, items: prev.items.filter((r) => r.id !== id) });
    update({ m: null }, true);
    first.reload();
  };

  if (first.error && !first.data) return <ErrorNote onRetry={first.reload}>{errorText(first.error)}</ErrorNote>;
  const data = first.data;
  return (
    <>
      <PageHeader title="Inbox" subtitle="Messages people sent from the Contact page. Reply, then mark them done." icon={Inbox} />
      <AdminTabs inboxUnread={counts?.new} />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="edge-fade-x -mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">
          <div role="tablist" aria-label="Which messages" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
            {INBOX_FILTERS.map(({ id, label }) => {
              const n = filterCount(counts, id);
              return (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={status === id}
                  onClick={() => update({ status: id === "todo" ? null : id })}
                  className={cx(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-sm",
                    status === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500",
                    focusRing,
                  )}
                >
                  {label}
                  {n > 0 && (
                    <span
                      className={cx(
                        "rounded-full px-1.5 text-xs tabular-nums",
                        id === "new" ? "bg-indigo-600 text-white" : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
                      )}
                    >
                      {badgeText(n)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <Select aria-label="Topic" value={topic} onChange={(e) => update({ topic: e.target.value || null })} className="!w-auto">
          <option value="">Every topic</option>
          {CONTACT_TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <label className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs">
          <span className="sr-only">Find a message</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, words or C-reference" className="pl-9" maxLength={120} />
        </label>
      </div>

      <LoadGate loading={!data} variant="session-row" count={6} label="Loading the inbox">
      {!items.length ? (
        <CosmicEmptyState
          variant={q || topic ? "no-results" : "inbox"}
          kind={q || topic ? "no-results" : status === "todo" ? "cleared" : "first-use"}
          title={q || topic ? "No message matches" : EMPTY[status].title}
          body={q || topic ? "Try another topic or search, or the All tab." : EMPTY[status].body}
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {(data?.total ?? 0).toLocaleString("en-IN")} message{data?.total === 1 ? "" : "s"} · showing {items.length.toLocaleString("en-IN")}
          </p>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white/70 dark:divide-white/5 dark:border-white/10 dark:bg-white/[0.03]">
            {items.map((m) => (
              <li key={m.id}>
                <MessageRow item={m} current={openId === m.id} onOpen={() => update({ m: m.id })} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                api
                  .adminInbox({ ...query, offset: items.length, limit: PAGE })
                  .then((page) => setMore({ key, items: [...(extra?.items ?? []), ...page.items], hasMore: page.has_more }))
                  .catch(() => undefined)
                  .finally(() => setLoading(false));
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" /> {loading ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
      </LoadGate>
      {openId && <MessageDrawer messageId={openId} onClose={() => update({ m: null }, true)} onChange={changed} onDeleted={removed} />}
    </>
  );
}

function MessageRow({ item: m, current, onOpen }: { item: InboxItem; current: boolean; onOpen: () => void }) {
  const unread = m.status === "new";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx("flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-zinc-500/5 sm:px-4", current && "bg-indigo-500/5", focusRing)}
    >
      <span aria-hidden="true" className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", unread ? "bg-indigo-500" : "bg-transparent")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cx("min-w-0 truncate", unread ? "font-semibold" : "font-medium")}>
            {unread && <span className="sr-only">Unread: </span>}
            {m.name}
          </span>
          <span className="hidden min-w-0 truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400">{m.email}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{when(m.created_at)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Tag>{m.topic_label}</Tag>
          {!unread && <StatusBadge status={m.status} />}
          {m.listing_title && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-rose-700 dark:text-rose-300">
              <Briefcase className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{m.listing_title}</span>
            </span>
          )}
          {m.user_id && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400" title="Sent while signed in">
              <UserRound className="h-3 w-3" aria-hidden /> Account
            </span>
          )}
          {m.replies > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
              <Reply className="h-3 w-3" aria-hidden /> Replied
            </span>
          )}
        </span>
        <span className={cx("mt-1 line-clamp-2 break-words text-sm", unread ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-300")}>
          {m.snippet}
        </span>
      </span>
    </button>
  );
}
