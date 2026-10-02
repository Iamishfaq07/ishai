import { useEffect, useState } from "react";
import type { AccessChange, AdminActivityItem, AdminTotals, AdminUser } from "@orbit/types";
import { Check, ChevronDown, Clock, FileText, IndianRupee, Mic, Plus, Search, Users, confirmDialog, cx } from "@orbit/ui";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const DURATIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hour" },
  { hours: 2, label: "2 hours" },
  { hours: 24, label: "1 day" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];

/** "30 Sep, 18:30", in the viewer's own time zone. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Admin: who signed up, who's waiting, and what each account may use (grant a plan for a while, or for good). */
export function AdminUsersPage() {
  const [only, setOnly] = useState<"pending" | "all">("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const list = useAsync(() => api.adminUsers(only, q), [only, q], `admin-users-${only}-${q}`);
  const replace = (row: AdminUser) =>
    list.setData((prev) => prev && { ...prev, users: prev.users.map((u) => (u.id === row.id ? row : u)) });

  if (list.error) return <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>;
  const data = list.data;
  return (
    <>
      <PageHeader title="Users & access" subtitle="Who signed up, what each account has used, and what it may use." icon={Users} />
      {data?.totals && <Totals totals={data.totals} />}
      {data && !data.approval_required && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
          Sign-up approval is off on this server, so new accounts start on the Free plan. Set <code>ORBIT_SIGNUP_APPROVAL=true</code> to hold them
          here until you give them access.
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label="Which accounts" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
        {(["pending", "all"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={only === id}
            onClick={() => setOnly(id)}
            className={cx("rounded-lg px-3 py-1 text-sm", only === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500")}
          >
            {id === "pending" ? "Waiting" : "Everyone"}
          </button>
        ))}
      </div>
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Find an account</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find by email or name" className="pl-9" maxLength={120} />
        </label>
      </div>
      {!data ? (
        <Spinner label="Loading accounts" />
      ) : !data.users.length ? (
        <EmptyState
          icon={Check}
          title={only === "pending" ? "Nobody is waiting" : q ? "No account matches" : "No accounts yet"}
          body={only === "pending" ? "You'll get an email when someone new signs up." : "Accounts appear here as people sign up."}
        />
      ) : (
        <ul className="space-y-3">
          {data.users.map((u) => (
            <li key={u.id}>
              <UserRow user={u} onChange={replace} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const mins = (n: number) => `${Math.round(n).toLocaleString("en-IN")} min`;

/** The server at a glance: accounts, what was used this month, and money in. */
function Totals({ totals: t }: { totals: AdminTotals }) {
  const tiles: Array<{ label: string; value: string; note?: string; to?: string }> = [
    { label: "Accounts", value: t.users.toLocaleString("en-IN"), note: `${t.signups_7d} new this week` },
    { label: "Interview minutes this month", value: mins(t.interview_minutes_this_month), note: "live + mock, all accounts" },
    { label: "Resume AI credits used this month", value: t.resume_credits_used_this_month.toLocaleString("en-IN") },
    { label: "Paid this month", value: inr(t.paid_inr_this_month), note: `${inr(t.paid_inr_total)} all time` },
    {
      label: "Payments to check",
      value: String(t.payments_waiting),
      note: t.payments_waiting ? "waiting for you" : "none waiting",
      to: "/admin/payments",
    },
  ];
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const body = (
          <>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{tile.value}</p>
            {tile.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.note}</p>}
          </>
        );
        return tile.to ? (
          <Link key={tile.label} to={tile.to} className="rounded-2xl border border-zinc-200 bg-white/70 p-3 hover:border-indigo-400/50 dark:border-white/10 dark:bg-white/[0.03]">
            {body}
          </Link>
        ) : (
          <div key={tile.label} className="rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** What this account has had and used: interview minutes, resume credits, sessions, money. */
function UsageGrid({ user }: { user: AdminUser }) {
  const u = user.usage;
  if (!u) return null;
  const admin = user.access === "admin";
  const usedMinutes = u.live_minutes_used + u.mock_minutes_used;
  const cells: Array<{ icon: typeof Mic; label: string; main: string; sub: string }> = [
    {
      icon: Mic,
      label: "Interview minutes",
      main: `${mins(usedMinutes)} used`,
      sub: admin
        ? `live ${mins(u.live_minutes_used)} · mock ${mins(u.mock_minutes_used)} · unlimited`
        : `of ${mins(u.interview_minutes_given)} given · ${mins(user.interview_minutes_left)} left · mock ${mins(u.mock_minutes_used)}`,
    },
    {
      icon: FileText,
      label: "Resume AI credits",
      main: `${u.resume_used} used`,
      sub: admin ? "unlimited" : `of ${u.resume_given} given · ${user.resume_credits} left`,
    },
    {
      icon: Clock,
      label: "Sessions",
      main: `${u.sessions} session${u.sessions === 1 ? "" : "s"}`,
      sub: u.last_active ? `last active ${when(u.last_active)}` : "never active",
    },
    {
      icon: IndianRupee,
      label: "Paid",
      main: inr(u.paid_inr),
      sub: u.packs ? `${u.packs} pack${u.packs === 1 ? "" : "s"} bought` : "no packs bought",
    },
  ];
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {cells.map(({ icon: Icon, label, main, sub }) => (
        <div key={label} className="rounded-xl bg-zinc-500/5 p-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">{main}</dd>
          <dd className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every credit in and out, each session with its minutes, every payment: loaded when opened. */
function History({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = () => {
    setOpen((v) => !v);
    if (items || open) return;
    api
      .adminUserActivity(user.id)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? "Hide history" : "Show history"}
      </button>
      {open &&
        (error ? (
          <p className="mt-2 text-sm text-rose-600">{error}</p>
        ) : !items ? (
          <Spinner label="Loading history" />
        ) : !items.length ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">What</th>
                <th className="py-1 text-right font-medium">Credits / minutes / ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-zinc-500 tabular-nums dark:text-zinc-400">{when(it.at)}</td>
                  <td className="py-1.5 pr-3">{it.text}</td>
                  <td className={cx("whitespace-nowrap py-1.5 text-right tabular-nums", it.amount?.startsWith("-") ? "text-rose-600 dark:text-rose-400" : it.amount?.startsWith("+") ? "text-emerald-700 dark:text-emerald-400" : "")}>
                    {it.amount ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}

function AccessBadge({ user }: { user: AdminUser }) {
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
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", tone)}>{text}</span>;
}

type GrantPlan = "unlimited" | "pro";
const GRANT_LABEL: Record<GrantPlan, string> = { unlimited: "Unlimited", pro: "Pro" };

function UserRow({ user, onChange }: { user: AdminUser; onChange: (row: AdminUser) => void }) {
  const [plan, setPlan] = useState<GrantPlan>("unlimited");
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (change: AccessChange) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.setUserAccess(user.id, change));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const extends_ = user.access === "granted" && user.plan_label === GRANT_LABEL[plan];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name ? `${user.name} · ${user.email}` : user.email}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Joined {formatDate(user.created_at)} · {user.email_verified ? "email verified" : "email not verified"} · {user.live_minutes_this_month} live
            min this month
          </p>
        </div>
        <AccessBadge user={user} />
      </div>
      <UsageGrid user={user} />
      {user.access !== "admin" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select aria-label={`Plan for ${user.email}`} value={plan} onChange={(e) => setPlan(e.target.value as GrantPlan)} className="!w-auto">
            {(Object.keys(GRANT_LABEL) as GrantPlan[]).map((p) => (
              <option key={p} value={p}>
                {GRANT_LABEL[p]}
              </option>
            ))}
          </Select>
          <Select aria-label={`How long for ${user.email}`} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="!w-auto">
            {DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {extends_ ? `${d.label} more` : `for ${d.label}`}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={busy} onClick={() => void run({ action: "grant", plan, hours })}>
            <Clock className="h-3.5 w-3.5" /> {extends_ ? "Add time" : "Give access"}
          </Button>
          {user.access !== "approved" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "approve" })} title="Free plan, with no end date">
              Approve for good
            </Button>
          )}
          {user.access !== "pending" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Take away ${user.email}'s access?`,
                  body: "They go back to waiting for approval, and any time left on a grant is cancelled.",
                  confirmLabel: "Take away access",
                  danger: true,
                });
                if (ok) await run({ action: "revoke" });
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      )}
      {user.access !== "admin" && <GiveCredits user={user} onChange={onChange} />}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <History user={user} />
    </Card>
  );
}

/** Add resume credits and interview minutes by hand: a goodwill top-up, or a payment made some other way. */
function GiveCredits({ user, onChange }: { user: AdminUser; onChange: (row: AdminUser) => void }) {
  const [resume, setResume] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = Math.max(0, Math.floor(Number(resume) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        api
          .giveCredits(user.id, { resume: r, interview_minutes: m })
          .then((row) => {
            onChange(row);
            setResume("");
            setMinutes("");
          })
          .catch((err: unknown) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <span className="text-xs text-zinc-500">Give credits:</span>
      <Input aria-label={`Resume credits for ${user.email}`} inputMode="numeric" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="resume" className="!w-24" />
      <Input aria-label={`Interview minutes for ${user.email}`} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="minutes" className="!w-24" />
      <Button size="sm" variant="secondary" type="submit" disabled={busy || !(r || m)}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
      {error && <span className="text-rose-600">{error}</span>}
    </form>
  );
}
