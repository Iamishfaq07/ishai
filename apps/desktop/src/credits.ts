import { useEffect, useState } from "react";
import type { Entitlements } from "@orbit/types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "./api";

/** The billing page in the browser (packs are paid there by UPI), at one pack's checkout when given. */
export function openBilling(pack?: string): void {
  void openUrl(`${WEB_URL}/billing${pack ? `?pack=${encodeURIComponent(pack)}` : ""}`);
}

/**
 * The account's plan and what's left on it, refreshed whenever Orbit comes back into focus, so minutes bought in
 * the browser show up here without a restart. Null until loaded (or when offline).
 */
export function useEntitlements(): Entitlements | null {
  const [plan, setPlan] = useState<Entitlements | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .entitlements()
        .then((e) => alive && setPlan(e))
        .catch(() => undefined);
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  return plan;
}
