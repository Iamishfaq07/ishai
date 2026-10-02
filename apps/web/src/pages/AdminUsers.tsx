import { useState } from "react";
import type { AccessChange, AdminUser } from "@orbit/types";
import { Check, Clock, Plus, Users, confirmDialog, cx } from "@orbit/ui";
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
            {user.access !== "admin" && ` · credits: ${user.resume_credits} resume, ${Math.round(user.interview_minutes_left)} interview min`}
          </p>
        </div>
        <AccessBadge user={user} />
      </div>
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
