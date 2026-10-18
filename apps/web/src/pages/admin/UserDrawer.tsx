import { useCallback, useEffect, useState } from "react";
import type { AccessChange, AdminUser, AdminUserDetail } from "@orbit/types";
import {
  Ban,
  Clock,
  FileText,
  IndianRupee,
  KeyRound,
  LogOut,
  Mic,
  Save,
  Sheet,
  Trash2,
  LoadGate,
  confirmDialog,
} from "@orbit/ui";
import { Button, Input, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { AccountHistory } from "./AccountHistory";
import { CreditsAdjust } from "./CreditsAdjust";
import { seenText, sinceText } from "./logic";
import { AccessBadge, Section, SuspendedBadge, Tag, inr, mins, when } from "./shared";

const DURATIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hour" },
  { hours: 2, label: "2 hours" },
  { hours: 24, label: "1 day" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];
type GrantPlan = "unlimited" | "pro";
const GRANT_LABEL: Record<GrantPlan, string> = { unlimited: "Unlimited", pro: "Pro" };

/**
 * One account in full, in a panel over the list: what it has and used, access, credits (add or remove), profile,
 * private notes, sign out everywhere, suspend and delete, and its whole history. `onChange` keeps the list's row in
 * step; `onDeleted` takes it off the list.
 */
export function UserDrawer({
  userId,
  onClose,
  onChange,
  onDeleted,
}: {
  userId: string;
  onClose: () => void;
  onChange: (row: AdminUser) => void;
  onDeleted: (id: string) => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .adminUser(userId)
      .then(setDetail)
      .catch((err: unknown) => setError(errorText(err)));
  }, [userId]);
  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  /** After an action: the list's row now, a line saying what happened, and the panel re-read. */
  const changed = (row: AdminUser | null, message: string) => {
    if (row) onChange(row);
    setFlash(message);
    load();
  };

  const u = detail?.user;
  return (
    <Sheet
      open
      placement="end"
      onClose={onClose}
      titleId="account-drawer-title"
      title={u ? u.name || u.email : "Account"}
      detail={
        u ? (
          <>
            {u.name && <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">{u.email}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <AccessBadge user={u} />
              {u.suspended_at && <SuspendedBadge />}
              {detail?.is_you && <Tag>You</Tag>}
              {u.has_note && <Tag title="You wrote private notes on this account">Note</Tag>}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Joined {formatDate(u.created_at)} · {u.email_verified ? "email verified" : "email not verified"} · last active{" "}
              {sinceText(u.usage?.last_active ?? null).toLowerCase()}
              {seenText(u.usage?.last_active ?? null, u.usage?.last_seen) ? ` (${seenText(u.usage?.last_active ?? null, u.usage?.last_seen)})` : ""}
            </p>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5">
          {error && (
            <p className="text-sm text-rose-600">
              {error}{" "}
              <button type="button" className="underline" onClick={load}>
                Try again
              </button>
            </p>
          )}
          {!detail ? (
            !error && <LoadGate loading variant="card" count={3} label="Loading the account">{null}</LoadGate>
          ) : (
            <>
              {flash && (
                <p role="status" className="rounded-xl bg-emerald-500/10 p-2.5 text-sm text-emerald-900 ring-1 ring-emerald-500/25 dark:text-emerald-200">
                  {flash}
                </p>
              )}
              {detail.user.suspended_at && <SuspendedNote detail={detail} onChange={changed} />}
              <UsageGrid user={detail.user} />
              {!detail.is_admin_account && (
                <>
                  <Section title="Access" hint="A plan for a while (it runs out on its own), approval for good, or back to waiting.">
                    <AccessControls user={detail.user} onChange={changed} />
                  </Section>
                  <Section title="Credits" hint="Resume AI credits and interview minutes. Every change is in their history with your note.">
                    <CreditsAdjust user={detail.user} onChange={changed} />
                  </Section>
                </>
              )}
              <Section title="Profile and notes">
                <ProfileAndNotes detail={detail} onChange={changed} />
              </Section>
              {!detail.is_admin_account && !detail.is_you && (
                <Section title="Account actions" hint="Each asks first, and is in the audit log." danger>
                  <DangerZone
                    detail={detail}
                    onChange={changed}
                    onDeleted={() => {
                      onDeleted(detail.user.id);
                      onClose();
                    }}
                  />
                </Section>
              )}
              <Section title="History">
                <AccountHistory detail={detail} />
              </Section>
            </>
          )}
        </div>
    </Sheet>
  );
}

type Changed = (row: AdminUser | null, message: string) => void;

/** What this account has had and used: interview minutes, resume credits, sessions, money. */
function UsageGrid({ user }: { user: AdminUser }) {
  const u = user.usage;
  if (!u) return null;
  const admin = user.access === "admin";
  const cells: Array<{ icon: typeof Mic; label: string; main: string; sub: string }> = [
    {
      icon: Mic,
      label: "Interview minutes",
      main: `${mins(u.live_minutes_used + u.mock_minutes_used)} used`,
      sub: admin
        ? `live ${mins(u.live_minutes_used)} · mock ${mins(u.mock_minutes_used)} · unlimited`
        : `${mins(user.interview_minutes_left)} left · ${mins(u.interview_minutes_given)} given${u.interview_minutes_removed ? ` · ${mins(u.interview_minutes_removed)} removed` : ""}`,
    },
    {
      icon: FileText,
      label: "Resume AI credits",
      main: `${u.resume_used} used`,
      sub: admin ? "unlimited" : `${user.resume_credits} left · ${u.resume_given} given${u.resume_removed ? ` · ${u.resume_removed} removed` : ""}`,
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
    <dl className="grid gap-2 sm:grid-cols-2">
      {cells.map(({ icon: Icon, label, main, sub }) => (
        <div key={label} className="rounded-xl bg-white/70 p-2.5 ring-1 ring-zinc-200 dark:bg-white/[0.03] dark:ring-white/10">
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

function AccessControls({ user, onChange }: { user: AdminUser; onChange: Changed }) {
  const [plan, setPlan] = useState<GrantPlan>("unlimited");
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (change: AccessChange, message: string) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.setUserAccess(user.id, change), message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const extends_ = user.access === "granted" && user.plan_label === GRANT_LABEL[plan];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as GrantPlan)} className="!w-auto">
        {(Object.keys(GRANT_LABEL) as GrantPlan[]).map((p) => (
          <option key={p} value={p}>
            {GRANT_LABEL[p]}
          </option>
        ))}
      </Select>
      <Select aria-label="How long" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="!w-auto">
        {DURATIONS.map((d) => (
          <option key={d.hours} value={d.hours}>
            {extends_ ? `${d.label} more` : `for ${d.label}`}
          </option>
        ))}
      </Select>
      <Button size="sm" disabled={busy} onClick={() => void run({ action: "grant", plan, hours }, `${GRANT_LABEL[plan]} ${extends_ ? "extended" : "given"}.`)}>
        <Clock className="h-3.5 w-3.5" /> {extends_ ? "Add time" : "Give access"}
      </Button>
      {user.access !== "approved" && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "approve" }, "Approved for good.")} title="Free plan, with no end date">
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
            if (ok) await run({ action: "revoke" }, "Access taken away.");
          }}
        >
          Revoke
        </Button>
      )}
      {error && <p className="basis-full text-sm text-rose-600">{error}</p>}
    </div>
  );
}

function ProfileAndNotes({ detail, onChange }: { detail: AdminUserDetail; onChange: Changed }) {
  const u = detail.user;
  const [name, setName] = useState(u.name ?? "");
  const [note, setNote] = useState(detail.admin_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(u.name ?? "");
    setNote(detail.admin_note ?? "");
  }, [u.name, detail.admin_note]);
  const act = async (call: () => Promise<{ row: AdminUser | null; message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { row, message } = await call();
      onChange(row, message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Parameters<typeof api.updateAdminUser>[1], message: string) =>
    act(async () => ({ row: (await api.updateAdminUser(u.id, body)).user, message }));
  return (
    <div className="space-y-3 text-sm">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ name: name.trim() }, "Name saved.");
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Name</span>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        <Button size="sm" variant="secondary" type="submit" disabled={busy || name.trim() === (u.name ?? "")}>
          <Save className="h-3.5 w-3.5" /> Save name
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {!detail.is_admin_account && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void patch({ email_verified: !u.email_verified }, u.email_verified ? "Marked not verified." : "Email marked verified.")}
          >
            {u.email_verified ? "Mark email not verified" : "Mark email verified"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Email ${u.email} a password reset link?`,
              body: "The same email as Forgot password: a link that works once, for an hour. Their password doesn't change until they use it.",
              confirmLabel: "Send the link",
            });
            if (ok) await act(async () => ({ row: null, message: (await api.sendPasswordReset(u.id)).message }));
          }}
        >
          <KeyRound className="h-3.5 w-3.5" /> Send password reset
        </Button>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ admin_note: note }, note.trim() ? "Notes saved." : "Notes cleared.");
        }}
      >
        <label className="block">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Private notes (only you see these, never them)</span>
          <Textarea value={note} maxLength={4000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="Paid in cash on 3 Oct; asked for an invoice." className="mt-1" />
        </label>
        <Button size="sm" variant="secondary" type="submit" disabled={busy || note.trim() === (detail.admin_note ?? "").trim()}>
          <Save className="h-3.5 w-3.5" /> Save notes
        </Button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

function SuspendedNote({ detail, onChange }: { detail: AdminUserDetail; onChange: Changed }) {
  const u = detail.user;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-900 ring-1 ring-rose-500/25 dark:text-rose-200">
      <p className="font-medium">Suspended {u.suspended_at ? `since ${when(u.suspended_at)}` : ""}</p>
      <p className="mt-0.5">They can't sign in or use Orbit. They're shown: "{u.suspended_reason}"</p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-2"
        disabled={busy}
        onClick={async () => {
          const ok = await confirmDialog({
            title: `Unsuspend ${u.email}?`,
            body: "They can sign in again with their password, and we email them that their account is active.",
            confirmLabel: "Unsuspend",
          });
          if (!ok) return;
          setBusy(true);
          setError(null);
          try {
            onChange(await api.unsuspendUser(u.id), "Unsuspended. They can sign in again.");
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Unsuspend
      </Button>
      {error && <p className="mt-1 text-rose-600">{error}</p>}
    </div>
  );
}

function DangerZone({ detail, onChange, onDeleted }: { detail: AdminUserDetail; onChange: Changed; onDeleted: () => void }) {
  const u = detail.user;
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(""); // how the admin made sure it's them (two-step sign-in off)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = detail.counts.sessions_open;
  const act = async (call: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Sign ${u.email} out everywhere?`,
              body: "Every device (web, desktop, a phone following a session) has to sign in again, and live sessions stop. Their password stays the same.",
              confirmLabel: "Sign out everywhere",
            });
            if (ok) await act(async () => onChange(await api.signOutUser(u.id), "Signed out everywhere."));
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out everywhere
        </Button>
      </div>
      {u.two_factor && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const how = checked.trim();
            if (how.length < 10) return;
            const ok = await confirmDialog({
              title: `Turn off two-step sign-in for ${u.email}?`,
              body: "Only for someone who lost their phone and their recovery codes, once you've made sure it's really them. Their password alone signs in again, every device is signed out, and they're emailed. What you wrote is kept in the audit log.",
              confirmLabel: "Turn it off",
              danger: true,
            });
            if (ok)
              await act(async () => {
                onChange(await api.turnOffTwoFactor(u.id, how), "Two-step sign-in is off. They're emailed.");
                setChecked("");
              });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">How you checked it's really them (kept in the audit log)</span>
            <Input value={checked} maxLength={300} onChange={(e) => setChecked(e.target.value)} placeholder="How you checked it's them (audit log)" />
          </label>
          <Button size="sm" variant="danger" type="submit" disabled={busy || checked.trim().length < 10}>
            <KeyRound className="h-3.5 w-3.5" /> Turn off two-step sign-in
          </Button>
        </form>
      )}
      {!u.suspended_at && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const why = reason.trim();
            if (why.length < 3) return;
            const ok = await confirmDialog({
              title: `Suspend ${u.email}?`,
              body: `They're signed out everywhere${live ? " and their live session stops" : ""}, and can't sign in or use Orbit until you unsuspend them. They're emailed, and shown: "${why}"`,
              confirmLabel: "Suspend",
              danger: true,
            });
            if (ok)
              await act(async () => {
                onChange(await api.suspendUser(u.id, why), "Suspended.");
                setReason("");
              });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Reason for suspending (they're shown it)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (they're shown it)" />
          </label>
          <Button size="sm" variant="danger" type="submit" disabled={busy || reason.trim().length < 3}>
            <Ban className="h-3.5 w-3.5" /> Suspend
          </Button>
        </form>
      )}
      <div>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete ${u.email}?`,
              body:
                "This deletes the account and everything in it: documents, sessions and transcripts, resumes, stories, Jobs AI data and usage. " +
                `${live ? "Its live session stops first. " : ""}Approved payments stay on the books without the account. This can't be undone.`,
              confirmLabel: "Delete account",
              danger: true,
              typeToConfirm: u.email,
            });
            if (!ok) return;
            // The dialog only confirms once the email is typed exactly, so that's what is sent (the API checks it too).
            await act(async () => {
              await api.deleteUser(u.id, u.email);
              onDeleted();
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete account
        </Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
