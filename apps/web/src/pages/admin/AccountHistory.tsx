import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminAuditItem, AdminUserDetail } from "@orbit/types";
import { ArrowUpRight, cx, focusRing } from "@orbit/ui";
import { actionLabel, auditDetail } from "./logic";
import { inr, when } from "./shared";

type Tab = "ledger" | "sessions" | "payments" | "actions" | "events" | "content";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "ledger", label: "Credits" },
  { id: "sessions", label: "Sessions" },
  { id: "payments", label: "Payments" },
  { id: "actions", label: "Admin actions" },
  { id: "events", label: "Sign-ins & security" },
  { id: "content", label: "Content" },
];

const TH = "py-1 pr-3 font-medium";
const TD = "py-1.5 pr-3 align-top";

function Empty({ children }: { children: string }) {
  return <p className="py-3 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}

/** Everything that happened on the account, by kind: the full credit ledger, sessions, payments, what an admin did,
 * its own sign-ins and security events, and what it has stored. */
export function AccountHistory({ detail }: { detail: AdminUserDetail }) {
  const [tab, setTab] = useState<Tab>("ledger");
  return (
    <div>
      <div role="tablist" aria-label="Account history" className="edge-fade-x -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`history-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`history-panel-${id}`}
            onClick={() => setTab(id)}
            className={cx(
              "whitespace-nowrap rounded-lg px-2.5 py-1 text-sm",
              tab === id ? "bg-zinc-900 font-medium text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-500/10",
              focusRing,
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`history-panel-${tab}`} aria-labelledby={`history-tab-${tab}`} className="mt-2 overflow-x-auto">
        {tab === "ledger" && <Ledger detail={detail} />}
        {tab === "sessions" && <Sessions detail={detail} />}
        {tab === "payments" && <Payments detail={detail} />}
        {tab === "actions" && <AuditRows rows={detail.admin_actions} subject={detail.user.id} who empty="No admin has changed this account." />}
        {tab === "events" && <AuditRows rows={detail.events} subject={null} ip empty="No sign-ins or security events yet." />}
        {tab === "content" && <Content detail={detail} />}
      </div>
      <Link
        to={`/admin/audit?user=${encodeURIComponent(detail.user.id)}`}
        className={cx("mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}
      >
        Everything about this account in the audit log <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

function Ledger({ detail }: { detail: AdminUserDetail }) {
  if (!detail.ledger.length) return <Empty>No credits yet.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500 dark:text-zinc-400">
        <tr>
          <th className={TH}>When</th>
          <th className={TH}>What</th>
          <th className={cx(TH, "text-right")}>Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
        {detail.ledger.map((e) => (
          <tr key={e.id}>
            <td className={cx(TD, "whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400")}>{when(e.at)}</td>
            <td className={TD}>{e.text}</td>
            <td
              className={cx(
                TD,
                "whitespace-nowrap pr-0 text-right tabular-nums",
                e.amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {e.amount_text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sessions({ detail }: { detail: AdminUserDetail }) {
  if (!detail.sessions.length) return <Empty>No sessions yet.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500 dark:text-zinc-400">
        <tr>
          <th className={TH}>When</th>
          <th className={TH}>Kind</th>
          <th className={TH}>Status</th>
          <th className={cx(TH, "text-right")}>Minutes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
        {detail.sessions.map((s) => (
          <tr key={s.id}>
            <td className={cx(TD, "whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400")}>{when(s.started_at ?? s.created_at)}</td>
            <td className={TD}>{s.type}</td>
            <td className={TD}>{s.status}</td>
            <td className={cx(TD, "pr-0 text-right tabular-nums")}>{s.minutes ? s.minutes.toLocaleString("en-IN") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Payments({ detail }: { detail: AdminUserDetail }) {
  if (!detail.payments.length) return <Empty>No payments.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500 dark:text-zinc-400">
        <tr>
          <th className={TH}>When</th>
          <th className={TH}>Pack</th>
          <th className={TH}>Status</th>
          <th className={TH}>UTR</th>
          <th className={cx(TH, "text-right")}>Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
        {detail.payments.map((p) => (
          <tr key={p.id}>
            <td className={cx(TD, "whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400")}>{when(p.decided_at ?? p.submitted_at ?? p.created_at)}</td>
            <td className={TD}>{p.pack}</td>
            <td className={TD}>{p.status.replace("_", " ")}</td>
            <td className={cx(TD, "font-mono text-xs")}>{p.utr ?? "—"}</td>
            <td className={cx(TD, "pr-0 text-right tabular-nums")}>{inr(p.amount_inr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditRows({ rows, subject, who, ip, empty }: { rows: AdminAuditItem[]; subject: string | null; who?: boolean; ip?: boolean; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500 dark:text-zinc-400">
        <tr>
          <th className={TH}>When</th>
          <th className={TH}>What</th>
          <th className={TH}>Details</th>
          {who && <th className={TH}>By</th>}
          {ip && <th className={TH}>IP</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
        {rows.map((a) => (
          <tr key={a.id}>
            <td className={cx(TD, "whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400")}>{when(a.at)}</td>
            <td className={TD}>{actionLabel(a.action)}</td>
            <td className={cx(TD, "break-words text-xs text-zinc-600 dark:text-zinc-300")}>{auditDetail(a.target, subject ?? a.subject_id) || "—"}</td>
            {who && <td className={cx(TD, "text-xs")}>{a.actor_email ?? "—"}</td>}
            {ip && <td className={cx(TD, "font-mono text-xs")}>{a.ip ?? "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Content({ detail }: { detail: AdminUserDetail }) {
  const c = detail.counts;
  const kinds = Object.entries(c.documents_by_kind)
    .map(([k, n]) => `${n} ${k.replace("_", " ")}`)
    .join(" · ");
  const jobs = Object.entries(c.jobs_by_status)
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");
  const rows: Array<[string, string, string?]> = [
    ["Documents", String(c.documents), kinds || undefined],
    ["Resumes (Resume AI)", String(c.resumes)],
    ["Story bank", String(c.stories)],
    ["Saved setups", String(c.workspaces)],
    ["Sessions", String(c.sessions), c.sessions_open ? `${c.sessions_open} not ended` : undefined],
    ["Jobs AI search profile", c.job_profile ? "Set up" : "Not yet"],
    ["Jobs AI tracker", String(c.jobs_tracked), jobs || undefined],
    ["Jobs AI fit checks", String(c.fit_checks), `${c.fit_checks_30d} in the last 30 days`],
  ];
  return (
    <dl className="grid gap-2 py-1 sm:grid-cols-2">
      {rows.map(([label, value, sub]) => (
        <div key={label} className="rounded-xl bg-zinc-500/5 p-2.5">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
          <dd className="text-sm font-medium tabular-nums">{value}</dd>
          {sub && <dd className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
