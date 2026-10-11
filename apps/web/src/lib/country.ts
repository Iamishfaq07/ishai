import { detectCountry, isIndia } from "@orbit/ui";
import { useAuth } from "./auth";

/** The country the user is applying in: the account's, or (signed out, or not saved yet) the browser's guess. */
export function useCountry(): string {
  const { user } = useAuth();
  return user?.country || detectCountry();
}

/** Whether the India-first conventions apply (₹, LPA, campus rounds, Naukri). */
export function useIndia(): boolean {
  return isIndia(useCountry());
}

