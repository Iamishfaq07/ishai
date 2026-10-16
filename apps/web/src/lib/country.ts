import { useEffect, useSyncExternalStore } from "react";
import { detectCountry, isIndia } from "@orbit/ui";
import { useAuth } from "./auth";
import { pickCountry, visitorCountry } from "./visitorCountry";

/**
 * The country the user is applying in: the account's saved one; else (signed out, or not saved yet) the country the
 * web app's edge saw the visit come from (GET /v1/region, the one prices follow); else the browser's guess.
 */
export function useCountry(): string {
  const { user, loading } = useAuth();
  const saved = user?.country || null;
  const visitor = useSyncExternalStore(visitorCountry.subscribe, visitorCountry.get, visitorCountry.get);
  useEffect(() => {
    if (!loading && !saved) void visitorCountry.load();
  }, [loading, saved]);
  return pickCountry(saved, visitor, detectCountry());
}

/** Whether the India-first conventions apply (₹, LPA, campus rounds, Naukri). */
export function useIndia(): boolean {
  return isIndia(useCountry());
}
