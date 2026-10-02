import { useState } from "react";
import type { UpiOrder } from "@orbit/types";
import { Check, CircleCheck, Copy, IndianRupee, QrCode, Smartphone, X, cx, focusRing } from "@orbit/ui";
import { Button, Card, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";

/** On a phone the upi:// link opens GPay / PhonePe / Paytm straight away; on a computer it does nothing, so scan instead. */
const onPhone = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => undefined)
          }
          className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </span>
    </div>
  );
}

/**
 * Paying for a plan over UPI: scan the QR (or tap through to a UPI app on a phone, or pay the UPI ID by hand), then
 * give the UTR. Nothing turns on until the admin has matched the payment in the bank account.
 */
export function UpiCheckout({ order: initial, onClose, onChanged }: { order: UpiOrder; onClose: () => void; onChanged: (o: UpiOrder) => void }) {
  const [order, setOrder] = useState(initial);
  const [utr, setUtr] = useState(initial.status === "rejected" ? "" : (initial.utr ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = utr.replace(/\D/g, "");
  const submitted = order.status === "submitted";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.submitUtr(order.id, utr);
      setOrder(next);
      onChanged(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="animate-fade-up">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <IndianRupee className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold">
            {order.plan_label} · ₹{order.amount_inr} for {order.days} days
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Pay with any UPI app: Google Pay, PhonePe, Paytm, BHIM or your bank's app.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {submitted ? (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-900 ring-1 ring-emerald-500/25 dark:text-emerald-200">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Thanks! We've got your UTR ({order.utr}).</p>
            <p>
              We check it against our bank account and turn on {order.plan_label}, usually within a few hours. You'll get an
              email, and this page will show it. Paid the wrong amount or typed the UTR wrong? Fix it below until it's checked.
            </p>
          </div>
        </div>
      ) : (
        <>
          {order.status === "rejected" && (
            <p role="status" className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-900 ring-1 ring-rose-500/25 dark:text-rose-200">
              We couldn't match UTR {order.utr} to a payment{order.note ? `: ${order.note}` : "."} If you did pay, check the
              number in your UPI app and send it again.
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="mx-auto flex flex-col items-center gap-2">
              {order.upi_uri && (
                <span className="rounded-xl ring-1 ring-zinc-200 dark:ring-white/10">
                  <QrCode value={order.upi_uri} size={192} label={`UPI QR code: pay ₹${order.amount_inr} to ${order.upi_id ?? "Orbit"}`} />
                </span>
              )}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Scan with any UPI app</span>
            </div>
            <div className="min-w-0 space-y-3">
              {order.upi_uri && onPhone() && (
                <a
                  href={order.upi_uri}
                  className={cx("flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700", focusRing)}
                >
                  <Smartphone className="h-4 w-4" /> Pay ₹{order.amount_inr} with a UPI app
                </a>
              )}
              <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 px-3 dark:divide-white/10 dark:border-white/10">
                {order.upi_id && <CopyValue label="UPI ID" value={order.upi_id} />}
                {order.payee_name && <CopyValue label="Name" value={order.payee_name} />}
                <CopyValue label="Amount" value={`₹${order.amount_inr}`} />
                <CopyValue label="Note / reference" value={order.reference} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The QR and the button fill in the amount and the reference. Paying the UPI ID by hand? Pay exactly ₹{order.amount_inr} and
                put {order.reference} in the note. If an app won't open the link, scanning the QR always works.
              </p>
            </div>
          </div>
        </>
      )}

      <form
        className="mt-5 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label={submitted ? "UTR you sent" : "After paying: the UTR"}
          htmlFor="utr"
          hint="The 12-digit number your UPI app shows for the payment. Google Pay: UPI transaction ID. PhonePe: UTR. Paytm: UPI Ref. No."
        >
          <Input
            id="utr"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
            placeholder="e.g. 427813659021"
          />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button type="submit" disabled={busy || digits.length !== 12 || (submitted && digits === order.utr)}>
          <Check className="h-4 w-4" /> {busy ? "Sending…" : submitted ? "Correct the UTR" : "I've paid: send the UTR"}
        </Button>
      </form>
    </Card>
  );
}
