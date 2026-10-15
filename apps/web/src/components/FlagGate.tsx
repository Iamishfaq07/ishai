import { useEffect, useRef, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { flagAllows, type UserFlag } from "./flags";

/**
 * A page behind a per-account feature flag. Off for this account: back to `fallback` with a short note, never the
 * page's own "Not found" (a bookmark or a shared link reaches it even though the nav hides it).
 */
export function FlagGate({ flag, fallback, children }: { flag: UserFlag; fallback: string; children: ReactNode }) {
  const { user } = useAuth();
  const allowed = flagAllows(user, flag);
  const said = useRef(false);
  useEffect(() => {
    if (allowed === false && !said.current) {
      said.current = true;
      toast("That feature isn't available on your account yet.");
    }
  }, [allowed]);
  if (allowed === null) return null; // still signing in
  return allowed ? <>{children}</> : <Navigate to={fallback} replace />;
}
