import { useState } from "react";
import type { AdminPayment } from "@orbit/types";
import { Check, IndianRupee, X, confirmDialog, cx } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const TONE: Record<AdminPayment["status"], string> = {
  awaiting_payment: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
  submitted: "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200",
  approved: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-800 ring-rose-500/25 dark:text-rose-300",
};
const LABEL: Record<AdminPayment["status"], string> = {
  awaiting_payment: "Not paid",
  submitted: "Check this",
  approved: "Approved",
  rejected: "Rejected",
};

/** Admin: UPI payments to match against the bank statement. Approving turns the plan on for the payer. */
export function AdminPaymentsPage() {
  const [only, setOnly] = useState<"submitted" | "all">("submitted");
  const list = useAsync(() => api.adminPayments(only), [only], `admin-payments-${only}`);
  const replace = (row: AdminPayment) =>
    list.setData((prev) => prev && { ...prev, payments: prev.payments.map((p) => (p.id === row.id ? row : p)) });

  if (list.error) return <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>;
  const data = list.data;
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="UPI payments waiting for you. Find each one in your bank or UPI app by its UTR or the ORB reference in the note, then approve it."
        icon={IndianRupee}
      />
      {data && !data.upi_configured && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
          UPI isn't set up on this server, so nobody can pay. Set <code>ORBIT_UPI_ID</code> (and <code>ORBIT_UPI_NAME</code>) on the API.
        </p>
      )}
      <div role="tablist" aria-label="Which payments" className="mb-4 inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
        {(["submitted", "all"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={only === id}
            onClick={() => setOnly(id)}
            className={cx("rounded-lg px-3 py-1 text-sm", only === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500")}
          >
            {id === "submitted" ? "To check" : "All"}
          </button>
        ))}
      </div>
      {!data ? (
        <Spinner label="Loading payments" />
      ) : !data.payments.length ? (
        <EmptyState
          icon={Check}
          title={only === "submitted" ? "Nothing to check" : "No payments yet"}
          body={only === "submitted" ? "You'll get an email when someone sends a UTR." : "Payments appear here once someone pays and sends the UTR."}
        />
      ) : (
        <ul className="space-y-3">
          {data.payments.map((p) => (
            <li key={p.id}>
              <PaymentRow payment={p} onChange={replace} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PaymentRow({ payment: p, onChange }: { payment: AdminPayment; onChange: (row: AdminPayment) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (action: "approve" | "reject") => {
    if (action === "approve") {
      const replacing = p.current_plan && p.current_plan !== p.plan_label;
      const ok = await confirmDialog({
        title: `Approve ₹${p.amount_inr} from ${p.email}?`,
        body: `Only if ₹${p.amount_inr} with UTR ${p.utr} is in your account. ${p.plan_label} turns on for ${p.days} days${
          replacing ? `, replacing their ${p.current_plan}` : p.current_plan ? ", added on to the time they have" : ""
        }.`,
        confirmLabel: "Approve",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await api.decidePayment(p.id, action, note.trim() || undefined));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            ₹{p.amount_inr} · {p.plan_label} · {p.name ? `${p.name} · ${p.email}` : p.email}
          </p>
          <p className="mt-0.5 text-sm tabular-nums">
            UTR <strong>{p.utr}</strong> · reference <strong>{p.reference}</strong>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Sent {formatDate(p.submitted_at)}
            {p.current_plan && ` · has ${p.current_plan}${p.current_until ? ` until ${formatDate(p.current_until)}` : ""}`}
            {p.decided_at && ` · decided ${formatDate(p.decided_at)}`}
            {p.note && ` · note: ${p.note}`}
          </p>
        </div>
        <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", TONE[p.status])}>{LABEL[p.status]}</span>
      </div>
      {p.status === "submitted" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
            <Check className="h-3.5 w-3.5" /> Approve
          </Button>
          <Input
            aria-label={`Reason for ${p.email}, if you reject`}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason, if you reject (they see it)"
            className="!w-auto min-w-0 flex-1"
          />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide("reject")}>
            <X className="h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
