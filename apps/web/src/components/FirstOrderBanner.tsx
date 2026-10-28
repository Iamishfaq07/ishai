import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

/** The server controls campaign availability; the cart rechecks every claim before payment. */
export function useFirstOrderPromotion() {
  return useAsync(() => api.call<{ enabled: boolean; code: string; percent: number }>("/v1/billing/promotion"), [], "first-order-promotion");
}

export function FirstOrderBanner() {
  const offer = useFirstOrderPromotion();
  if (!offer.data?.enabled) return null;
  return <aside aria-label="First purchase offer" className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
    <strong>10% off your first purchase.</strong>{" "}Use <strong className="font-mono">FIRST10</strong> in your cart.
    {/* Phones: the offer and the code in a line or two; the rules are in the cart. */}<span className="ml-1 hidden sm:inline">For accounts with no previous purchases. One use per account.</span>{" "}
    <Link to="/pricing" className="rounded underline underline-offset-2 focus-visible:outline focus-visible:outline-2">View plans</Link>
  </aside>;
}
