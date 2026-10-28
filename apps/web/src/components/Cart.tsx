import { useState, type FormEvent } from "react";
import { Button, Input, Sheet, ShieldCheck, Skeleton, Sparkles, cx, focusRing } from "@orbit/ui";
import type { BillingQuote } from "@orbit/types";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const PAY_LABEL: Record<NonNullable<BillingQuote["checkout"]>, (total: string) => string> = {
  razorpay: (t) => `Pay ${t} securely`,
  upi: (t) => `Pay ${t} by UPI`,
  paypal: (t) => `Continue to PayPal · ${t}`,
};

const HOW: Record<NonNullable<BillingQuote["checkout"]>, string> = {
  razorpay: "Razorpay's secure window opens next: card, UPI or netbanking.",
  upi: "Next: pay the UPI amount, then enter the reference number (UTR) from your UPI app.",
  paypal: "You'll pay on PayPal's page, with your PayPal account or a card, and come back here.",
};

/** The cart: what's being bought, the first-purchase discount or a coupon's, the total, then the payment. The
 * numbers are the server's (GET /v1/billing/quote), and the order charges the same. */
export function Cart({ pack, onClose, onPay, busy, error }: {
  /** `checkout`: how the page will pay for it (what Pay does), so the button says the same. */
  pack: { id: string; label: string; checkout?: string | null; buyable?: boolean };
  onClose: () => void;
  onPay: (code: string | undefined, checkout: NonNullable<BillingQuote["checkout"]>) => void;
  busy: boolean;
  error: string | null;
}) {
  const quote = useAsync(() => api.billingQuote(pack.id), [pack.id], `quote-${pack.id}`);
  const [applied, setApplied] = useState("");
  const [priced, setPriced] = useState<BillingQuote | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState("");
  const q = priced ?? quote.data;
  const checkout = q?.checkout ?? null;
  const footer = q ? (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <Button className="w-full" size="lg" loading={busy} disabled={!checkout || codeBusy || quote.loading || !!quote.error} onClick={() => { if (checkout) onPay(applied || undefined, checkout); }}>
        {checkout ? PAY_LABEL[checkout](q.total_text) : "Can't be bought here right now"}
      </Button>
      {checkout && (
        <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {HOW[checkout]} Nothing renews automatically.
        </p>
      )}
    </div>
  ) : undefined;
  return (
    <Sheet open title="Your cart" onClose={onClose} size="md" footer={footer}>
      <div className="p-5">
      {quote.error ? (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{errorText(quote.error)}</p>
      ) : !q ? (
        <Skeleton variant="card" count={1} label="Loading your cart" />
      ) : (
        <div className="space-y-5">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="min-w-0">
                <span className="block font-semibold text-zinc-900 dark:text-white">{q.label}</span>
                <span className="mt-0.5 block text-zinc-600 dark:text-zinc-400">{q.includes.join(" · ")}</span>
              </dt>
              <dd className="shrink-0 tabular-nums">{q.price_text}</dd>
            </div>
            {q.discount_percent > 0 && (
              <div className="flex items-start justify-between gap-4 text-emerald-800 dark:text-emerald-300">
                <dt className="flex min-w-0 items-start gap-1.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{q.discount_reason} ({q.discount_percent}% off)</span>
                </dt>
                <dd className="shrink-0 tabular-nums">{q.discount_text}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 border-t border-zinc-200 pt-3 text-base font-semibold dark:border-white/10">
              <dt>Total</dt>
              <dd className="tabular-nums">{q.total_text}</dd>
            </div>
          </dl>
          {q.coupons && (
            <Coupon busy={busy || codeBusy} applied={applied} error={codeError} onApply={async (code) => {
              setCodeBusy(true); setCodeError("");
              try { const next = await api.billingQuote(pack.id, code); setPriced(next); setApplied(code.trim().toUpperCase()); }
              catch (err) { setCodeError(errorText(err)); }
              finally { setCodeBusy(false); }
            }} onRemove={() => { setPriced(null); setApplied(""); setCodeError(""); quote.reload(); }} />
          )}
        </div>
      )}
      </div>
    </Sheet>
  );
}

function Coupon({ busy, applied, error, onApply, onRemove }: {
  busy: boolean; applied: string; error: string;
  onApply: (code: string) => Promise<void>; onRemove: () => void;
}) {
  const [code, setCode] = useState("");
  const apply = (event: FormEvent) => { event.preventDefault(); void onApply(code); };
  return <div className="space-y-2">
    {applied && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{applied} applied.
      <button type="button" disabled={busy} onClick={onRemove} className={cx("ml-3 underline", focusRing)}>Remove code</button>
    </p>}
    <form onSubmit={apply} className="space-y-2">
      <label htmlFor="cart-coupon" className="block text-sm font-medium">Promotion code</label>
      <div className="flex gap-2">
        <Input id="cart-coupon" value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} autoComplete="off"
          autoCapitalize="characters" spellCheck={false} maxLength={32} placeholder="FIRST10"
          aria-invalid={error ? true : undefined} aria-describedby="cart-coupon-help" />
        <Button type="submit" variant="secondary" disabled={busy || !code.trim()}>Apply</Button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <p id="cart-coupon-help" className="text-xs text-zinc-500 dark:text-zinc-400">Use FIRST10 for 10% off your first purchase. One use per account. Other codes and combined discounts are unavailable.</p>
    </form>
  </div>;
}
