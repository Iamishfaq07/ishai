import { useState, type FormEvent } from "react";
import { Button, Input, Sheet, ShieldCheck, Skeleton, Sparkles, cx, focusRing } from "@orbit/ui";
import type { BillingQuote } from "@orbit/types";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { normalizeCode } from "../lib/referral";
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
export function Cart({ pack, onClose, onPay, busy, error, onCodeApplied }: {
  /** `checkout`: how the page will pay for it (what Pay does), so the button says the same. */
  pack: { id: string; label: string; checkout?: string | null; buyable?: boolean };
  onClose: () => void;
  onPay: () => void;
  busy: boolean;
  error: string | null;
  /** A coupon changed the account's discount: the page's prices should follow. */
  onCodeApplied: () => void;
}) {
  const quote = useAsync(() => api.billingQuote(pack.id), [pack.id], `quote-${pack.id}`);
  const q = quote.data;
  const listed = pack.buyable && pack.checkout && pack.checkout in PAY_LABEL ? (pack.checkout as keyof typeof PAY_LABEL) : null;
  const checkout = listed ?? q?.checkout ?? null;
  const footer = q ? (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <Button className="w-full" size="lg" loading={busy} disabled={!checkout} onClick={onPay}>
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
            <Coupon current={q} onApplied={() => { quote.reload(); onCodeApplied(); }} />
          )}
        </div>
      )}
      </div>
    </Sheet>
  );
}

function Coupon({ current, onApplied }: { current: BillingQuote; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const apply = async (e: FormEvent) => {
    e.preventDefault();
    const typed = normalizeCode(code);
    if (!typed) {
      setError("Codes are 3 to 32 letters or digits.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const got = await api.redeemCode(typed);
      // Discounts never add up: the bigger one applies, and the buyer is told which.
      setSaid(got.kind === "first"
        ? `Code ${typed} saved. Your first-purchase offer (${got.percent}% off) is more, so that one applies. Discounts don't add up.`
        : got.percent > current.discount_percent || current.discount_percent === 0
          ? `Code ${typed} applied: ${got.percent}% off.`
          : `Code ${typed} saved.`);
      setCode("");
      setOpen(false);
      onApplied();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {said && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{said}</p>}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
                className={cx("text-sm font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300", focusRing)}>
          Have a coupon code?
        </button>
      ) : (
        <form onSubmit={(e) => void apply(e)} className="space-y-2">
          <label htmlFor="cart-coupon" className="block text-sm font-medium">Coupon code</label>
          <div className="flex gap-2">
            <Input id="cart-coupon" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
                   autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="e.g. PRIYA10"
                   aria-invalid={error ? true : undefined} aria-describedby={error ? "cart-coupon-error" : undefined} />
            <Button type="submit" variant="secondary" loading={busy} disabled={!code.trim()}>Apply</Button>
          </div>
          {error && <p id="cart-coupon-error" role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">One discount per order: the bigger one applies. Codes work on a first purchase only.</p>
        </form>
      )}
    </div>
  );
}
