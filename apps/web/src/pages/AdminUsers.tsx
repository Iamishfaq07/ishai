import { useState } from "react";
import type { AccessChange, AdminUser } from "@orbit/types";
import { Check, Clock, Users, confirmDialog, cx } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner } from "../components/ui";
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
  const [only, setOnly] = useState<"pending" | "all">("pending");
  const list = useAsync(() => api.adminUsers(only), [only], `admin-users-${only}`);
  const replace = (row: AdminUser) =>
    list.setData((prev) => prev && { ...prev, users: prev.users.map((u) => (u.id === row.id ? row : u)) });

  if (list.error) return <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>;
  const data = list.data;
  return (
    <>
      <PageHeader title="Users & access" subtitle="New sign-ups wait here until you give them access." icon={Users} />
      {data && !data.approval_required && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
          Sign-up approval is off on this server, so new accounts start on the Free plan. Set <code>ORBIT_SIGNUP_APPROVAL=true</code> to hold them
          here until you give them access.
        </p>
      )}
      <div role="tablist" aria-label="Which accounts" className="mb-4 inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
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
      {!data ? (
        <Spinner label="Loading accounts" />
      ) : !data.users.length ? (
        <EmptyState
          icon={Check}
          title={only === "pending" ? "Nobody is waiting" : "No accounts yet"}
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

function UserRow({ user, onChange }: { user: AdminUser; onChange: (row: AdminUser) => void }) {
  const [plan, setPlan] = useState<"unlimited" | "pro">("unlimited");
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
  const extends_ = user.access === "granted" && user.plan_label.toLowerCase() === plan;
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
      {user.access !== "admin" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select aria-label={`Plan for ${user.email}`} value={plan} onChange={(e) => setPlan(e.target.value as "unlimited" | "pro")} className="!w-auto">
            <option value="unlimited">Unlimited</option>
            <option value="pro">Pro</option>
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
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
