import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminUser, AdminUserFilter, AdminUserSort } from "@orbit/types";
import { ArrowUpDown, Check, ChevronDown, Download, Plus, Search, Users, X, cx, focusRing } from "@orbit/ui";
import { Button, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { downloadText, errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { AdminOverview } from "./admin/Overview";
import { UserDrawer } from "./admin/UserDrawer";
import { exportFileName, nextSort, sinceText, wholeNumber, type SortState } from "./admin/logic";
import { AccessBadge, AdminTabs, SuspendedBadge, Tag, day, inr, mins } from "./admin/shared";

const PAGE = 50;
const FILTERS: Array<{ id: AdminUserFilter; label: string }> = [
  { id: "all", label: "Everyone" },
  { id: "pending", label: "Waiting" },
  { id: "granted", label: "On a grant" },
  { id: "paid", label: "Paid" },
  { id: "active", label: "Active 7 days" },
  { id: "never_used", label: "Never used" },
  { id: "suspended", label: "Suspended" },
];
const SORTS: AdminUserSort[] = ["created", "email", "last_active", "paid", "minutes", "resume_credits"];
const EMPTY: Record<AdminUserFilter, { title: string; body: string }> = {
  all: { title: "No accounts yet", body: "Accounts appear here as people sign up." },
  pending: { title: "Nobody is waiting", body: "You'll get an email when someone new signs up." },
  granted: { title: "Nobody is on a grant", body: "Accounts you give a plan for a while show here until it runs out." },
  paid: { title: "No paying accounts yet", body: "Accounts with an approved UPI payment show here." },
  active: { title: "Nobody used Orbit this week", body: "Sessions, resume AI and Jobs AI all count." },
  never_used: { title: "Everyone has used Orbit", body: "Accounts that signed up and never started anything show here." },
  suspended: { title: "No suspended accounts", body: "Suspend an account from its panel." },
};

/**
 * Admin: every account, filtered, searched and sorted, a page at a time (with the server's numbers on top). An
 * account opens in a panel (`?user=`) with everything about it and every action. Filters, search and sort live in the
 * address, so Back and a shared link find the list as it was.
 */
export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const only = FILTERS.find((f) => f.id === params.get("only"))?.id ?? "all";
  const q = params.get("q") ?? "";
  const sortParam = params.get("sort") as AdminUserSort | null;
  const sort: SortState = {
    sort: sortParam && SORTS.includes(sortParam) ? sortParam : "created",
    order: params.get("order") === "asc" ? "asc" : "desc",
  };
  const openId = params.get("user");
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
  const onSort = (s: SortState) => update({ sort: s.sort, order: s.order });

  const [search, setSearch] = useState(q);
  useEffect(() => {
    if (search.trim() === q) return;
    const t = window.setTimeout(() => update({ q: search.trim() || null }, true), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const key = `admin-users-${only}-${q}-${sort.sort}-${sort.order}`;
  const list = useAsync(
    () => api.adminUsers(only, q, { sort: sort.sort, order: sort.order, limit: PAGE }),
    [only, q, sort.sort, sort.order],
    key,
  );
  const [more, setMore] = useState<{ key: string; users: AdminUser[]; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => setSelected(new Set()), [key]);

  const extra = more?.key === key ? more : null;
  const rows = useMemo(() => [...(list.data?.users ?? []), ...(extra?.users ?? [])], [list.data, extra]);
  const hasMore = extra ? extra.hasMore : Boolean(list.data?.has_more);
  const total = list.data?.total ?? rows.length;

  const replace = (row: AdminUser) => {
    list.setData((prev) => prev && { ...prev, users: prev.users.map((u) => (u.id === row.id ? row : u)) });
    setMore((prev) => prev && { ...prev, users: prev.users.map((u) => (u.id === row.id ? row : u)) });
  };
  const removeRow = (id: string) => {
    list.setData((prev) => prev && { ...prev, users: prev.users.filter((u) => u.id !== id), total: Math.max(0, (prev.total ?? 1) - 1) });
    setMore((prev) => prev && { ...prev, users: prev.users.filter((u) => u.id !== id) });
    setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
    setNote("Account deleted.");
    setVersion((v) => v + 1);
  };
  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.adminUsers(only, q, { sort: sort.sort, order: sort.order, offset: rows.length, limit: PAGE });
      setMore({ key, users: [...(extra?.users ?? []), ...page.users], hasMore: Boolean(page.has_more) });
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    setNote(null);
    try {
      downloadText(exportFileName(), await api.adminUsersCsv({ only, q, sort: sort.sort, order: sort.order }), "text/csv");
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setExporting(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectable = rows.filter((u) => u.access !== "admin");
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));

  if (list.error && !list.data) return <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>;
  const data = list.data;
  return (
    <>
      <PageHeader title="Users & access" subtitle="Who signed up, what each account has used, and what it may use." icon={Users} />
      <AdminTabs paymentsWaiting={data?.totals?.payments_waiting} />
      <AdminOverview version={version} />
      {data && !data.approval_required && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
          Sign-up approval is off on this server, so new accounts start on the Free plan. Set <code>ORBIT_SIGNUP_APPROVAL=true</code> to hold them
          here until you give them access.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="edge-fade-x -mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">
          <div role="tablist" aria-label="Which accounts" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
            {FILTERS.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={only === id}
                onClick={() => update({ only: id === "all" ? null : id })}
                className={cx("whitespace-nowrap rounded-lg px-3 py-1 text-sm", only === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs">
          <span className="sr-only">Find an account</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find by email or name" className="pl-9" maxLength={120} />
        </label>
        <Button size="sm" variant="secondary" disabled={exporting || !total} onClick={() => void exportCsv()} title="Every account in this list, as a spreadsheet">
          <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          onDone={(message) => {
            setSelected(new Set());
            setMore(null);
            setNote(message);
            setVersion((v) => v + 1);
            list.reload();
          }}
          onClear={() => setSelected(new Set())}
        />
      )}
      {note && (
        <p role="status" className="mb-2 flex items-center gap-2 rounded-xl bg-zinc-500/10 px-3 py-2 text-sm">
          <span className="flex-1">{note}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)} className={cx("rounded p-0.5 text-zinc-500", focusRing)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      )}

      {!data ? (
        <Spinner label="Loading accounts" />
      ) : !rows.length ? (
        <EmptyState icon={Check} title={q ? "No account matches" : EMPTY[only].title} body={q ? `Nothing for "${q}" here.` : EMPTY[only].body} />
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString("en-IN")} account{total === 1 ? "" : "s"}
            {only !== "all" || q ? (total === 1 ? " matches" : " match") : ""} · showing {rows.length.toLocaleString("en-IN")}
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                <tr>
                  <th className="w-10 py-2 pl-3">
                    <input
                      type="checkbox"
                      aria-label="Select every account shown"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)))}
                      className="h-4 w-4 rounded border-zinc-300 accent-indigo-600"
                    />
                  </th>
                  <SortHeader label="Account" column="email" sort={sort} onSort={onSort} />
                  <SortHeader label="Left" column="resume_credits" sort={sort} onSort={onSort} className="hidden w-28 md:table-cell" />
                  <SortHeader label="Used" column="minutes" sort={sort} onSort={onSort} className="hidden w-40 lg:table-cell" />
                  <SortHeader label="Paid" column="paid" sort={sort} onSort={onSort} className="hidden w-20 md:table-cell" right />
                  <SortHeader label="Last active" column="last_active" sort={sort} onSort={onSort} className="hidden w-28 sm:table-cell" />
                  <SortHeader label="Joined" column="created" sort={sort} onSort={onSort} className="hidden w-28 lg:table-cell" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {rows.map((u) => (
                  <UserRow key={u.id} user={u} selected={selected.has(u.id)} onToggle={() => toggle(u.id)} onOpen={() => update({ user: u.id })} />
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                <ChevronDown className="h-3.5 w-3.5" /> {loadingMore ? "Loading…" : `Load ${Math.min(PAGE, total - rows.length)} more`}
              </Button>
              {moreError && <span className="text-sm text-rose-600">{moreError}</span>}
            </div>
          )}
        </>
      )}
      {openId && <UserDrawer userId={openId} onClose={() => update({ user: null }, true)} onChange={replace} onDeleted={removeRow} />}
    </>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
  right,
}: {
  label: string;
  column: AdminUserSort;
  sort: SortState;
  onSort: (next: SortState) => void;
  className?: string;
  right?: boolean;
}) {
  const current = sort.sort === column;
  return (
    <th className={cx("py-2 pr-3 font-medium", right && "text-right", className)} aria-sort={current ? (sort.order === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cx("inline-flex items-center gap-1 rounded hover:text-zinc-900 dark:hover:text-white", current && "text-zinc-900 dark:text-white", focusRing)}
      >
        {label}
        <ArrowUpDown className={cx("h-3 w-3", current ? "opacity-100" : "opacity-40")} aria-hidden />
      </button>
    </th>
  );
}

function UserRow({ user: u, selected, onToggle, onOpen }: { user: AdminUser; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const used = (u.usage?.live_minutes_used ?? 0) + (u.usage?.mock_minutes_used ?? 0);
  const admin = u.access === "admin";
  return (
    <tr className={cx("cursor-pointer hover:bg-zinc-500/5", selected && "bg-indigo-500/5")} onClick={onOpen}>
      <td className="py-2.5 pl-3 align-top" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${u.email}`}
          checked={selected}
          disabled={admin}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-indigo-600 disabled:opacity-30"
        />
      </td>
      <td className="py-2.5 pr-3 align-top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className={cx("block max-w-full truncate rounded text-left font-medium hover:underline", focusRing)}
          title={`Open ${u.email}`}
        >
          {u.name ? `${u.name} · ${u.email}` : u.email}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <AccessBadge user={u} />
          {u.suspended_at && <SuspendedBadge />}
          {u.has_note && <Tag title="You wrote private notes on this account">Note</Tag>}
        </div>
        {/* Phones: the numbers the hidden columns hold. */}
        <p className="mt-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400 md:hidden">
          {admin ? "Unlimited" : `${u.resume_credits} credits · ${mins(u.interview_minutes_left)} left`}
          {u.usage?.paid_inr ? ` · ${inr(u.usage.paid_inr)}` : ""}
          <span className="sm:hidden"> · {sinceText(u.usage?.last_active ?? null).toLowerCase()}</span>
        </p>
      </td>
      <td className="hidden py-2.5 pr-3 align-top tabular-nums md:table-cell">
        {admin ? (
          <span className="text-zinc-500">Unlimited</span>
        ) : (
          <>
            {u.resume_credits} <span className="text-xs text-zinc-500">credits</span>
            <br />
            {mins(u.interview_minutes_left)}
          </>
        )}
      </td>
      <td className="hidden py-2.5 pr-3 align-top tabular-nums lg:table-cell">
        {mins(used)}
        <br />
        <span className="text-xs text-zinc-500">
          {u.usage?.resume_used ?? 0} resume AI · {u.usage?.sessions ?? 0} sessions
        </span>
      </td>
      <td className="hidden py-2.5 pr-3 text-right align-top tabular-nums md:table-cell">{u.usage?.paid_inr ? inr(u.usage.paid_inr) : "—"}</td>
      <td className="hidden whitespace-nowrap py-2.5 pr-3 align-top sm:table-cell">{sinceText(u.usage?.last_active ?? null)}</td>
      <td className="hidden whitespace-nowrap py-2.5 pr-3 align-top text-zinc-500 lg:table-cell dark:text-zinc-400">{day(u.created_at)}</td>
    </tr>
  );
}

/** Credits for every selected account at once (the admin account can't be selected; the server skips it anyway). */
function BulkBar({ ids, onDone, onClear }: { ids: string[]; onDone: (message: string) => void; onClear: () => void }) {
  const [resume, setResume] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = wholeNumber(resume);
  const m = wholeNumber(minutes);
  return (
    <form
      aria-label="Give credits to the selected accounts"
      className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-400/40 bg-white/95 p-2.5 text-sm shadow-lg dark:bg-zinc-900/95"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        api
          .bulkGiveCredits({ user_ids: ids, resume: r, interview_minutes: m, ...(note.trim() ? { note: note.trim() } : {}) })
          .then((res) =>
            onDone(`Credits given to ${res.given} account${res.given === 1 ? "" : "s"}${res.skipped.length ? ` (${res.skipped.length} skipped)` : ""}.`),
          )
          .catch((err: unknown) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <span className="font-medium">{ids.length} selected</span>
      <span className="text-xs text-zinc-500">Give each:</span>
      <Input aria-label="Resume credits for each" inputMode="numeric" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="resume" className="!w-24" />
      <Input aria-label="Interview minutes for each" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="minutes" className="!w-24" />
      <Input aria-label="Note for their history" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="!w-auto min-w-0 flex-1" />
      <Button size="sm" type="submit" disabled={busy || !(r || m) || ids.length > 100}>
        <Plus className="h-3.5 w-3.5" /> Give credits
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear the selection">
        <X className="h-3.5 w-3.5" />
      </Button>
      {ids.length > 100 && <span className="basis-full text-xs text-rose-600">At most 100 accounts at a time.</span>}
      {error && <span className="basis-full text-xs text-rose-600">{error}</span>}
    </form>
  );
}
