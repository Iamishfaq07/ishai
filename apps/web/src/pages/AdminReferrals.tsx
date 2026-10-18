import { useState, type FormEvent } from "react";
import type { AdminReferralCode } from "@orbit/types";
import { Download, LoadGate, Megaphone, cx } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { downloadText, errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { AdminTabs, Tag, count, day } from "./admin/shared";

/**
 * Admin: creator and campus codes (billing/referrals.py). Make one (a label, the buyer's discount, a commission for
 * this report, optionally an expiry and a cap on paying accounts), and see each one's sign-ups → paying accounts →
 * revenue (rupees and dollars apart) → commission owed. Every account's invite link adds up on one line. Commissions
 * are paid by hand: this only says what's owed. Below, the referrals to look at: invites refused as the inviter's
 * own, and first payments that were refunded.
 */

const REASON: Record<string, string> = {
  own_code: "Their own code",
  same_inbox: "Same inbox as the inviter (or an earlier account)",
  same_network: "Same network as the inviter",
  mutual: "The two invited each other",
  paid_before: "Had paid before",
};

export function AdminReferralsPage() {
  const report = useAsync(() => api.adminReferrals(), [], "admin-referrals");
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const data = report.data;

  const exportCsv = async () => {
    setExporting(true);
    setNote(null);
    try {
      downloadText(`orbit-referrals-${new Date().toISOString().slice(0, 10)}.csv`, await api.adminReferralsCsv(), "text/csv");
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setExporting(false);
    }
  };

  if (report.error) return <ErrorNote onRetry={report.reload}>{errorText(report.error)}</ErrorNote>;
  return (
    <>
      <PageHeader title="Referrals" icon={Megaphone}
                  subtitle="Creator and campus codes, and every account's invite link: who signed up with each, who paid, and what's owed." />
      <AdminTabs />
      <LoadGate loading={!data} variant="card" count={2} label="Loading referrals">
        {data && (
          <div className="space-y-6">
            <p className={cx("rounded-xl p-3 text-sm ring-1", data.enabled
              ? "bg-emerald-500/10 text-emerald-900 ring-emerald-500/25 dark:text-emerald-100"
              : "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200")}>
              {data.enabled ? "Referrals are on. " : <>Referrals are off (<code>ORBIT_REFERRALS</code>): nothing is attributed, discounted or rewarded until you switch them on. You can make codes now. </>}
              An invited friend gets {data.discount_percent}% off their first purchase; the inviter gets {data.reward_minutes} interview
              minutes when they pay, at most {data.monthly_cap} a month (<code>ORBIT_REFERRAL_DISCOUNT_PERCENT</code>,{" "}
              <code>ORBIT_REFERRAL_REWARD_MINUTES</code>, <code>ORBIT_REFERRAL_MONTHLY_CAP</code>).
            </p>
            <NewCode onMade={report.reload} />
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Codes</h2>
                <Button size="sm" variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
                </Button>
              </div>
              {note && <ErrorNote>{note}</ErrorNote>}
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Codes (scrolls sideways)">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Discount · commission</th>
                      <th className="py-2 pr-3 text-right">Sign-ups</th>
                      <th className="py-2 pr-3 text-right">Paying</th>
                      <th className="py-2 pr-3 text-right">Revenue</th>
                      <th className="py-2 pr-3 text-right">Commission owed</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
                    {data.codes.map((c) => (
                      <CodeRow key={c.id} code={c} onChange={report.reload} />
                    ))}
                    <CodeRow code={data.invites} onChange={report.reload} />
                  </tbody>
                </table>
              </div>
              {!data.codes.length && <p className="mt-3 text-sm text-zinc-500">No creator or campus codes yet. Make one above.</p>}
            </Card>
            <Card>
              <h2 className="font-semibold">To look at</h2>
              <p className="mb-3 text-sm text-zinc-500">Invites refused as the inviter&rsquo;s own (no discount, no reward), and first payments that were refunded.</p>
              {data.review.length ? (
                <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
                  {data.review.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="font-medium">{r.email}</span>
                      {r.inviter_email && <span className="text-zinc-500">invited by {r.inviter_email}</span>}
                      {r.code && <Tag>{r.code}</Tag>}
                      <span className="text-zinc-500">{day(r.created_at)}</span>
                      {r.status === "blocked" && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-800 dark:text-rose-300">Blocked: {REASON[r.reason ?? ""] ?? r.reason}</span>}
                      {r.flag && <span className="basis-full text-xs text-amber-800 dark:text-amber-200">{r.flag}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500">Nothing to look at.</p>
              )}
            </Card>
          </div>
        )}
      </LoadGate>
    </>
  );
}

function CodeRow({ code: c, onChange }: { code: AdminReferralCode; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    if (!c.id) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateReferralCode(c.id, { active: !c.active });
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const money = (inr: string, usd: string, i: number, u: number) =>
    i || u ? [i ? inr : null, u ? usd : null].filter(Boolean).join(" · ") : "—";
  return (
    <tr className="align-top">
      <td className="py-2.5 pr-3">
        <span className="font-mono font-medium">{c.code}</span>
        <span className="block text-xs text-zinc-500">
          {c.kind === "invite" ? c.label : `${c.kind === "campus" ? "Campus" : "Creator"} · ${c.label ?? ""}`}
          {c.expires_at ? ` · until ${day(c.expires_at)}` : ""}
          {c.max_uses ? ` · ${count(c.paying)} of ${count(c.max_uses)} uses` : ""}
        </span>
        {error && <span className="block text-xs text-rose-700 dark:text-rose-300">{error}</span>}
      </td>
      <td className="py-2.5 pr-3 tabular-nums">
        {c.discount_percent}% off{c.id ? ` · ${c.commission_percent}%` : ""}
        {c.kind === "invite" && c.minutes_rewarded ? <span className="block text-xs text-zinc-500">{count(c.minutes_rewarded)} reward min given</span> : null}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums">
        {count(c.signups)}
        {c.blocked ? <span className="block text-xs text-zinc-500">+{count(c.blocked)} blocked</span> : null}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{count(c.paying)}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{money(c.revenue_inr_text, c.revenue_usd_text, c.revenue_inr, c.revenue_usd)}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{c.id ? money(c.commission_inr_text, c.commission_usd_text, c.commission_inr, c.commission_usd) : "—"}</td>
      <td className="py-2.5 pr-3 text-xs">{c.problem ?? (c.id ? "Active" : "Every account's link")}</td>
      <td className="py-2.5 text-right">
        {c.id && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void toggle()}>
            {c.active ? "Switch off" : "Switch on"}
          </Button>
        )}
      </td>
    </tr>
  );
}

function NewCode({ onMade }: { onMade: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"creator" | "campus">("creator");
  const [discount, setDiscount] = useState("10");
  const [commission, setCommission] = useState("0");
  const [expires, setExpires] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const row = await api.createReferralCode({
        code: code.trim(),
        label: label.trim(),
        kind,
        discount_percent: Number(discount),
        commission_percent: Number(commission),
        // The end of the chosen day, where the admin is.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        max_uses: maxUses ? Number(maxUses) : null,
      });
      setMade(`${row.code} is ready. Its link: ${window.location.origin}/r/${row.code}`);
      setCode("");
      setLabel("");
      onMade();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h2 className="mb-3 font-semibold">New creator or campus code</h2>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code" htmlFor="rc-code" hint="Letters and digits; case doesn't matter.">
          <Input id="rc-code" required minLength={3} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRIYA10" />
        </Field>
        <Field label="Label" htmlFor="rc-label" hint="Who it's for (shown to buyers).">
          <Input id="rc-label" required maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Priya's channel" />
        </Field>
        <Field label="Type" htmlFor="rc-kind">
          <Select id="rc-kind" value={kind} onChange={(e) => setKind(e.target.value as "creator" | "campus")}>
            <option value="creator">Creator</option>
            <option value="campus">Campus</option>
          </Select>
        </Field>
        <Field label="Discount %" htmlFor="rc-discount" hint="Off a buyer's first purchase.">
          <Input id="rc-discount" type="number" min={0} max={50} required value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
        <Field label="Commission %" htmlFor="rc-commission" hint="For this report; you pay it yourself.">
          <Input id="rc-commission" type="number" min={0} max={100} required value={commission} onChange={(e) => setCommission(e.target.value)} />
        </Field>
        <Field label="Expires (optional)" htmlFor="rc-expires">
          <Input id="rc-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Max paying accounts (optional)" htmlFor="rc-max">
          <Input id="rc-max" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" loading={busy} className="w-full">Make the code</Button>
        </div>
      </form>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {made && <p role="status" className="mt-3 text-sm text-emerald-800 dark:text-emerald-200">{made}</p>}
    </Card>
  );
}

