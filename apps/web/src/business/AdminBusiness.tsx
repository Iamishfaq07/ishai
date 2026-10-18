// Orbit for Business (D82), the Orbit admin's side: every company (verify by hand, suspend, grant a plan), its jobs
// (take one down), and the "Report this job" queue. Job-scam protection lives here.
import { useEffect, useId, useState } from "react";
import type { BizAdminCompany, BizAdminCompanyDetail, BizAuditEntry, BizJobReport, BizPlan } from "@orbit/types";
import { Badge, Building2, Button, Callout, Dialog, ExternalLink, Field, Input, PageHeader, SearchInput, Select, Table, THead, Td, Th, Tr, cx, focusRing, toast } from "@orbit/ui";
import { AdminTabs } from "../pages/admin/shared";
import { biz } from "./api";
import { relTime } from "./model";
import { JobStatusBadge, Loading, LoadError, PLAN_LABEL, Panel, errorText } from "./ui";

function Detail({ cid, onClose, onChanged }: { cid: string | null; onClose: () => void; onChanged: () => void }) {
  const id = useId();
  const [d, setD] = useState<BizAdminCompanyDetail | null>(null);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<BizPlan>("starter");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    if (cid) biz.adminCompany(cid).then(setD).catch((e: unknown) => toast({ message: errorText(e), tone: "error" }));
  }, [cid]);
  const run = async (what: string, fn: () => Promise<BizAdminCompanyDetail | void>, done: string) => {
    setBusy(what);
    try {
      const next = await fn();
      if (next) setD(next);
      else if (cid) setD(await biz.adminCompany(cid));
      toast({ message: done, tone: "success" });
      onChanged();
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={!!cid} onClose={onClose} title={d?.name ?? "Company"} size="xl" placement="end" detail={d ? `${d.domain} · ${d.country} · ${d.size} · owner ${d.owner_email ?? "?"}` : undefined}>
      {!d ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {d.status === "suspended" ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}
            {d.verified ? <Badge tone="success">Verified ({d.verification_method})</Badge> : <Badge tone="warning">Not verified</Badge>}
            <Badge tone="accent">
              {PLAN_LABEL[d.plan]}
              {d.plan_until ? ` until ${new Date(d.plan_until).toLocaleDateString()}` : ""}
            </Badge>
            {d.pending_plan_request && <Badge tone="info">Asked for {PLAN_LABEL[d.pending_plan_request]}</Badge>}
          </div>
          {d.suspended_reason && <Callout tone="error">Suspended: {d.suspended_reason}</Callout>}
          <p className="text-sm">
            <a href={/^https?:/.test(d.website) ? d.website : `https://${d.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
              {d.website} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </p>
          {d.about && <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{d.about}</p>}

          <Panel title="Trust">
            <div className="space-y-3">
              {!d.verified && (
                <Button size="sm" variant="secondary" loading={busy === "verify"} onClick={() => void run("verify", () => biz.adminVerify(d.id), "Verified")}>
                  Mark as verified
                </Button>
              )}
              {d.status === "active" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[16rem] flex-1">
                    <Field label="Reason (shown to the company)" htmlFor={`${id}-r`}>
                      <Input id={`${id}-r`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  </div>
                  <Button size="sm" variant="danger" disabled={!reason.trim()} loading={busy === "suspend"} onClick={() => void run("suspend", () => biz.adminSuspend(d.id, reason.trim()), "Suspended; its jobs are hidden")}>
                    Suspend company
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" loading={busy === "unsuspend"} onClick={() => void run("unsuspend", () => biz.adminUnsuspend(d.id), "Unsuspended")}>
                  Unsuspend
                </Button>
              )}
            </div>
          </Panel>

          <Panel title="Grant a plan" hint="Company plans aren't sold in the app yet: grant them here once paid or agreed.">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Plan" htmlFor={`${id}-p`}>
                <Select id={`${id}-p`} value={plan} onChange={(e) => setPlan(e.target.value as BizPlan)}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                </Select>
              </Field>
              <div className="w-28">
                <Field label="Days" htmlFor={`${id}-d`}>
                  <Input id={`${id}-d`} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
                </Field>
              </div>
              <Button size="sm" loading={busy === "plan"} onClick={() => void run("plan", () => biz.adminGrantPlan(d.id, plan, days), `${PLAN_LABEL[plan]} granted`)} className="mb-5">
                Grant
              </Button>
            </div>
          </Panel>

          <Panel title={`Jobs (${d.jobs.length})`}>
            {d.jobs.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No jobs.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
                {d.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <a href={j.public_url} target="_blank" rel="noopener" className="font-medium underline">
                        {j.title}
                      </a>{" "}
                      <JobStatusBadge status={j.status} /> · {j.applicants} applicants
                      {j.taken_down_reason && <span className="block text-xs text-rose-700 dark:text-rose-300">Taken down: {j.taken_down_reason}</span>}
                    </span>
                    {j.taken_down_reason ? (
                      <Button size="sm" variant="ghost" onClick={() => void run(`r-${j.id}`, () => biz.adminRestore(j.id), "Restored")}>
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const why = window.prompt("Why is this job being taken down? (shown to the company)");
                          if (why?.trim()) void run(`t-${j.id}`, () => biz.adminTakeDown(j.id, why.trim()), "Taken down");
                        }}
                      >
                        Take down
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {d.reports.length > 0 && (
            <Panel title="Reports">
              <Reports items={d.reports} onChanged={() => cid && biz.adminCompany(cid).then(setD)} />
            </Panel>
          )}
          {cid && <CompanyAudit cid={cid} />}
        </div>
      )}
    </Dialog>
  );
}

/** The company's own audit log, for the Orbit team: moves and rejections, and each ranking's model version (which
 *  the company's members don't see anywhere else). */
function CompanyAudit({ cid }: { cid: string }) {
  const [rows, setRows] = useState<BizAuditEntry[] | null>(null);
  useEffect(() => {
    biz.adminAudit(cid).then(setRows).catch(() => setRows([]));
  }, [cid]);
  return (
    <Panel title="Audit log">
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing yet.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-auto text-xs">
          {rows.slice(0, 100).map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <span className="text-zinc-500 dark:text-zinc-400">{relTime(r.created_at)}</span>
              <span className="font-medium">{r.action}</span>
              {r.target && <span>{r.target}</span>}
              {typeof r.detail.model_version === "string" && <span className="font-mono">{r.detail.model_version}</span>}
              <span className="text-zinc-500 dark:text-zinc-400">{r.actor ?? "Orbit"}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const REASON: Record<BizJobReport["reason"], string> = {
  scam: "Scam",
  fake_company: "Fake company",
  discriminatory: "Discriminatory",
  misleading: "Misleading",
  other: "Other",
};

function Reports({ items, onChanged }: { items: BizJobReport[]; onChanged: () => void }) {
  const set = async (r: BizJobReport, status: BizJobReport["status"]) => {
    try {
      await biz.adminReport(r.id, status);
      toast({ message: status === "dismissed" ? "Dismissed" : "Marked as handled", tone: "success" });
      onChanged();
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };
  return (
    <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
      {items.map((r) => (
        <li key={r.id} className="py-2.5">
          <p>
            <Badge tone={r.status === "open" ? "warning" : "neutral"}>{REASON[r.reason]}</Badge> <strong>{r.job_title}</strong> at {r.company_name} · {relTime(r.created_at)} · {r.status}
          </p>
          {r.details && <p className="mt-1 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{r.details}</p>}
          {r.status === "open" && (
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void set(r, "actioned")}>
                Handled
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void set(r, "dismissed")}>
                Dismiss
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AdminBusinessPage() {
  const id = useId();
  const [items, setItems] = useState<BizAdminCompany[] | null>(null);
  const [reports, setReports] = useState<BizJobReport[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      biz
        .adminCompanies({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}) })
        .then(setItems)
        .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, status, n]);
  useEffect(() => {
    biz.adminReports("open").then(setReports).catch(() => setReports([]));
  }, [n]);
  return (
    <div>
      <PageHeader title="Business" icon={Building2} subtitle="Companies on Orbit for Business, their jobs, and reported jobs." />
      <AdminTabs />
      <div className="mt-5 space-y-5">
        {reports && reports.length > 0 && (
          <Panel title={`Reported jobs waiting (${reports.length})`}>
            <Reports items={reports} onChanged={() => setN((x) => x + 1)} />
          </Panel>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64">
            <SearchInput aria-label="Search companies" placeholder="Name, domain or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label htmlFor={`${id}-s`} className="sr-only">
            Status
          </label>
          <Select id={`${id}-s`} className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All companies</option>
            <option value="unverified">Not verified</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="requests">Asked for a plan</option>
          </Select>
        </div>
        {error ? (
          <LoadError error={error} onRetry={() => setN((x) => x + 1)} />
        ) : !items ? (
          <Loading />
        ) : (
          <Table label="Companies" dense stack>
            <THead>
              <tr>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>Plan</Th>
                <Th align="right">Open jobs</Th>
                <Th align="right">Applicants</Th>
                <Th align="right">Reports</Th>
                <Th>Created</Th>
              </tr>
            </THead>
            <tbody>
              {items.map((c) => (
                <Tr key={c.id}>
                  <Td primary>
                    <button type="button" onClick={() => setOpen(c.id)} className={cx("rounded text-left font-medium hover:underline", focusRing)}>
                      {c.name}
                    </button>
                    <span className="block text-xs font-normal text-zinc-500">
                      {c.domain} · {c.owner_email ?? ""}
                    </span>
                  </Td>
                  <Td label="Status">
                    <span className="flex flex-wrap gap-1">
                      {c.status === "suspended" ? <Badge tone="danger">Suspended</Badge> : c.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
                    </span>
                  </Td>
                  <Td label="Plan">
                    {PLAN_LABEL[c.plan]}
                    {c.pending_plan_request && <span className="block text-xs text-indigo-700 dark:text-indigo-300">wants {PLAN_LABEL[c.pending_plan_request]}</span>}
                  </Td>
                  <Td label="Open jobs" align="right">
                    {c.open_jobs}
                  </Td>
                  <Td label="Applicants" align="right">
                    {c.applicants}
                  </Td>
                  <Td label="Reports" align="right">
                    {c.open_reports || ""}
                  </Td>
                  <Td label="Created">{relTime(c.created_at)}</Td>
                </Tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500">
                    No companies match.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        )}
      </div>
      <Detail cid={open} onClose={() => setOpen(null)} onChanged={() => setN((x) => x + 1)} />
    </div>
  );
}
