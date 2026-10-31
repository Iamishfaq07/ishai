import { useState, type FormEvent } from "react";
import { Button, Input, Sheet, ShieldCheck, Skeleton, Sparkles, TagIcon, X, cx, focusRing } from "@orbit/ui";
import type { BillingQuote } from "@orbit/types";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useFirstOrderPromotion } from "./FirstOrderBanner";

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

/** Razorpay outside India takes cards only (UPI and netbanking are Indian), charged in the order's US dollars. */
const RAZORPAY_ABROAD = "Razorpay's secure window opens next: a debit or credit card, charged in US dollars.";

type Checkout = NonNullable<BillingQuote["checkout"]>;
const asCheckout = (c: string | null | undefined): Checkout | null => (c === "razorpay" || c === "upi" || c === "paypal" ? c : null);

/** The cart: what's being bought, a coupon (FIRST10 for a first purchase), the total, then the payment. The numbers
 * are the server's (GET /v1/billing/quote), and the order checks the code and charges the same again. If the cart
 * can't be priced (the server didn't answer), it still shows the listed price, so paying never depends on it. */
export function Cart({ pack, onClose, onPay, busy, error }: {
  /** `checkout`: how the page will pay for it; `price_text`: the listed price, if the server can't price the cart. */
  pack: { id: string; label: string; checkout?: string | null; buyable?: boolean; price_text?: string };
  onClose: () => void;
  onPay: (code: string | undefined, checkout: Checkout) => void;
  busy: boolean;
  error: string | null;
}) {
  const quote = useAsync(() => api.billingQuote(pack.id), [pack.id], `quote-${pack.id}`);
  const promo = useFirstOrderPromotion();
  const [applied, setApplied] = useState("");
  const [priced, setPriced] = useState<BillingQuote | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState("");
  const listed: BillingQuote | null = pack.price_text ? {
    id: pack.id, label: pack.label, kind: "pack", includes: [], currency: "", price_text: pack.price_text, discount_percent: 0,
    discount_text: "", discount_reason: "", total: 0, total_text: pack.price_text,
    checkout: pack.buyable ? asCheckout(pack.checkout) : null, coupons: true,
  } : null;
  const q = priced ?? quote.data ?? (quote.error ? listed : null);
  const checkout = q?.checkout ?? (pack.buyable ? asCheckout(pack.checkout) : null);

  // Returns whether the code was applied, so the box keeps what was typed when it wasn't.
  const apply = async (raw: string): Promise<boolean> => {
    const code = raw.trim().toUpperCase();
    if (!code) return false;
    setCodeBusy(true);
    setCodeError("");
    try {
      const next = await api.billingQuote(pack.id, code);
      if (!next.discount_percent) throw new Error(`${code} doesn't take anything off this order.`);
      setPriced(next);
      setApplied(code);
      return true;
    } catch (err) {
      setCodeError(errorText(err));
      return false;
    } finally {
      setCodeBusy(false);
    }
  };
  const remove = () => {
    setPriced(null);
    setApplied("");
    setCodeError("");
  };

  const footer = q ? (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <Button className="w-full" size="lg" loading={busy} disabled={!checkout || codeBusy || quote.loading}
              onClick={() => { if (checkout) onPay(applied || undefined, checkout); }}>
        {checkout ? PAY_LABEL[checkout](q.total_text) : "Can't be bought here right now"}
      </Button>
      {checkout && (
        <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {checkout === "razorpay" && q.currency === "USD" ? RAZORPAY_ABROAD : HOW[checkout]} Nothing renews automatically.
        </p>
      )}
    </div>
  ) : undefined;

  const offer = promo.data?.enabled ? promo.data : null;
  return (
    <Sheet open title="Your cart" onClose={onClose} size="md" footer={footer}>
      <div className="space-y-5 p-5">
        {!q ? (
          quote.error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{errorText(quote.error)}</p>
            : <Skeleton variant="card" count={1} label="Loading your cart" />
        ) : (
          <>
            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="min-w-0">
                  <span className="block font-semibold text-zinc-900 dark:text-white">{q.label}</span>
                  {q.includes.length > 0 && <span className="mt-0.5 block text-zinc-600 dark:text-zinc-400">{q.includes.join(" · ")}</span>}
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
            {quote.error && !priced && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Couldn't load the cart's details just now. You can still pay the listed price; a code is checked again when you pay.
              </p>
            )}
            <Coupon applied={applied} busy={busy || codeBusy} error={codeError} onApply={apply} onRemove={remove}
                    suggestion={offer && !applied && !q.discount_percent ? offer.code : null}
                    percent={offer?.percent ?? 0} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function Coupon({ applied, busy, error, onApply, onRemove, suggestion, percent }: {
  applied: string;
  busy: boolean;
  error: string;
  onApply: (code: string) => Promise<boolean>;
  onRemove: () => void;
  /** A code this account can try now (FIRST10 while the offer runs), shown as a one-tap button. */
  suggestion: string | null;
  percent: number;
}) {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onApply(code).then((ok) => { if (ok) setCode(""); });
  };
  if (applied) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-500/25 dark:text-emerald-100">
        <TagIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1"><strong className="font-mono">{applied}</strong> applied</span>
        <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove ${applied}`}
                className={cx("grid h-9 w-9 place-items-center rounded-lg hover:bg-emerald-500/10", focusRing)}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {suggestion && (
        <button type="button" disabled={busy} onClick={() => void onApply(suggestion)}
                className={cx("flex w-full items-center gap-2 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/5 px-3 py-2.5 text-left text-sm text-emerald-900 hover:bg-emerald-500/10 dark:text-emerald-100", focusRing)}>
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">First purchase? Use <strong className="font-mono">{suggestion}</strong> for {percent}% off</span>
          <span className="font-semibold">Apply</span>
        </button>
      )}
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="cart-coupon" className="block text-sm font-medium">Coupon code</label>
        <div className="flex gap-2">
          <Input id="cart-coupon" value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} autoComplete="off"
                 autoCapitalize="characters" spellCheck={false} maxLength={32} placeholder="Enter a code"
                 aria-invalid={error ? true : undefined} aria-describedby={error ? "cart-coupon-error" : undefined} />
          <Button type="submit" variant="secondary" loading={busy} disabled={!code.trim()}>Apply</Button>
        </div>
        {error && <p id="cart-coupon-error" role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">One code per order. A first-purchase code works once per account.</p>
      </form>
    </div>
  );
}
