import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminAuditItem } from "@orbit/types";
import { ChevronDown, LoadGate, ScrollText, Search, X, cx, focusRing } from "@orbit/ui";
import { Button, EmptyState, ErrorNote, Input, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { actionLabel, auditDetail } from "./admin/logic";
import { AdminTabs, when } from "./admin/shared";

const PAGE = 50;

/**
 * Admin: who did what, newest first. Your own actions by default (every grant, credit change, suspension, deletion,
 * export and settings change), or every audited event (sign-ins, password changes, ...). Filter by action, by account
 * (`?user=`, from an account's panel) or by an email, a name or any text.
 */
export function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") === "all" ? "all" : "admin";
  const action = params.get("action") ?? "";
  const userId = params.get("user") ?? "";
  const q = params.get("q") ?? "";
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

  const key = `admin-audit-${scope}-${action}-${userId}-${q}`;
  const query = { scope, ...(action ? { action } : {}), ...(userId ? { user_id: userId } : {}), ...(q ? { q } : {}) } as const;
  const first = useAsync(() => api.adminAudit({ ...query, limit: PAGE }), [scope, action, userId, q], key);
  const [more, setMore] = useState<{ key: string; items: AdminAuditItem[]; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const extra = more?.key === key ? more : null;
  const items = useMemo(() => [...(first.data?.items ?? []), ...(extra?.items ?? [])], [first.data, extra]);
  const hasMore = extra ? extra.hasMore : Boolean(first.data?.has_more);
  // The account being filtered on, by email: from any entry by or about it.
  const who = userId ? items.find((i) => i.subject_id === userId)?.subject_email ?? items.find((i) => i.actor_id === userId)?.actor_email : null;

  if (first.error && !first.data) return <ErrorNote onRetry={first.reload}>{errorText(first.error)}</ErrorNote>;
  const data = first.data;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change made from the admin console, and the accounts' own security events." icon={ScrollText} />
      <AdminTabs />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Which entries" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
          {(["admin", "all"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={scope === id}
              onClick={() => update({ scope: id === "admin" ? null : id, action: null })}
              className={cx("whitespace-nowrap rounded-lg px-3 py-1 text-sm", scope === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
            >
              {id === "admin" ? "Admin actions" : "Everything"}
            </button>
          ))}
        </div>
        <Select aria-label="Action" value={action} onChange={(e) => update({ action: e.target.value || null })} className="!w-auto">
          <option value="">Every action</option>
          {(data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </Select>
        <label className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs">
          <span className="sr-only">Find by email, name or text</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email, name or text" className="pl-9" maxLength={120} />
        </label>
        {userId && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-indigo-800 ring-1 ring-indigo-500/25 dark:text-indigo-200">
            Account: {who ?? `${userId.slice(0, 8)}…`}
            <button type="button" aria-label="Show every account" onClick={() => update({ user: null })} className={cx("rounded-full p-0.5 hover:bg-indigo-500/15", focusRing)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      <LoadGate loading={!data} variant="session-row" count={6} label="Loading the audit log">
      {!items.length ? (
        <EmptyState icon={ScrollText} title="Nothing here" body={action || userId || q ? "No entries match these filters." : "Admin actions appear here as you take them."} />
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {(data?.total ?? 0).toLocaleString("en-IN")} entr{data?.total === 1 ? "y" : "ies"} · showing {items.length.toLocaleString("en-IN")}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pl-3 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="hidden py-2 pr-3 font-medium md:table-cell">Details</th>
                  <th className="hidden py-2 pr-3 font-medium sm:table-cell">By / IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {items.map((i) => (
                  <AuditRow key={i.id} item={i} />
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                api
                  .adminAudit({ ...query, offset: items.length, limit: PAGE })
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
    </>
  );
}

function AuditRow({ item: i }: { item: AdminAuditItem }) {
  const admin = i.action.startsWith("admin.");
  // An admin action names the account it was about; an account's own event is by that account.
  const accountId = admin ? i.subject_id : i.actor_id;
  const accountEmail = admin ? i.subject_email : i.actor_email;
  const detail = auditDetail(i.target, i.subject_id);
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap py-2 pl-3 pr-3 text-zinc-500 tabular-nums dark:text-zinc-400">{when(i.at)}</td>
      <td className="py-2 pr-3">
        {actionLabel(i.action)}
        {/* An Inbox action: its target starts with the message's id. */}
        {i.action.startsWith("admin.contact.") && i.action !== "admin.contact.delete" && i.target && (
          <Link
            to={`/admin/inbox?status=all&m=${encodeURIComponent(i.target.split(" ", 1)[0] ?? "")}`}
            className={cx("ml-1.5 text-xs text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}
          >
            Open
          </Link>
        )}
        {detail && <p className="text-xs text-zinc-500 md:hidden">{detail}</p>}
      </td>
      <td className="max-w-[16rem] py-2 pr-3">
        {accountId && accountEmail ? (
          <Link to={`/admin/users?user=${encodeURIComponent(accountId)}`} className={cx("break-all text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
            {accountEmail}
          </Link>
        ) : accountId ? (
          <span className="text-zinc-500">(deleted account)</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="hidden max-w-[22rem] break-words py-2 pr-3 text-xs text-zinc-600 md:table-cell dark:text-zinc-300">{detail || "—"}</td>
      <td className="hidden py-2 pr-3 text-xs sm:table-cell">
        {admin ? i.actor_email ?? "—" : i.ip ? <span className="font-mono">{i.ip}</span> : "—"}
      </td>
    </tr>
  );
}
