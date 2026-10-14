import type { RazorpayCheckout, RazorpayPaid } from "@orbit/types";

/**
 * Razorpay's Standard Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/): its
 * script opens a payment sheet for an order the server made (cards, UPI, netbanking, wallets). It's loaded only when
 * someone buys, from checkout.razorpay.com (allowed in the Content-Security-Policy from vite.config.ts).
 */
const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export class InternationalPaymentError extends Error {
  constructor(message: string) { super(message); this.name = "InternationalPaymentError"; }
}
export function internationalCardFailure(reason: string): boolean {
  return /international|foreign|non[ -]?indian|card.*country|country.*card/i.test(reason);
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { email: string; name?: string };
  theme: { color: string };
  handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", cb: (r: { error?: { description?: string; reason?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("The payment window couldn't load. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens the checkout for the order. Resolves with the payment's signed answer, or null when it's closed unpaid; if
 * an attempt failed and the buyer then closed it, rejects with Razorpay's reason (nothing was charged).
 */
export async function payWithRazorpay(order: RazorpayCheckout): Promise<RazorpayPaid | null> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("The payment window couldn't load. Try again.");
  // A failed attempt keeps Razorpay's window open (it says why, and the buyer can try another way), so only paying
  // or closing it settles this; closing after a failure says why on the page too.
  return new Promise<RazorpayPaid | null>((resolve, reject) => {
    let failed: string | null = null;
    let international = false;
    const rzp = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: "Orbit",
      description: order.label,
      prefill: { email: order.email, ...(order.name ? { name: order.name } : {}) },
      theme: { color: "#6366f1" },
      handler: (r) => resolve({ order_id: r.razorpay_order_id, payment_id: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: {
        ondismiss: () => {
          if (!failed) resolve(null);
          else reject(international ? new InternationalPaymentError(failed) : new Error(`The payment didn't go through: ${failed} Check your payment status before retrying.`));
        },
      },
    });
    rzp.on("payment.failed", (r) => {
      const why = (r.error?.description || "the bank declined it").trim();
      failed = /[.!?]$/.test(why) ? why : `${why}.`;
      international = internationalCardFailure(`${why} ${r.error?.reason ?? ""}`);
    });
    rzp.open();
  });
}
