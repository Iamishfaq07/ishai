import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, buttonClass, Skeleton } from "@orbit/ui";
import { api } from "../lib/api";
import { EmptyState, ErrorNote } from "./ui";

type Status = "checking" | "admin" | "not-admin" | "unknown";

/**
 * The admin console's pages. Anyone else opening one (a bookmark, a shared link) is told it's the admin's and sent
 * home, instead of the page's own load failing with a 403 and a Retry that can never work. A check that couldn't
 * run (offline) can be retried.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const check = useCallback(() => {
    setStatus("checking");
    api
      .adminStatus()
      .then((s) => setStatus(s.is_admin ? "admin" : "not-admin"))
      .catch(() => setStatus("unknown"));
  }, []);
  useEffect(check, [check]);

  if (status === "admin") return <>{children}</>;
  if (status === "checking") {
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading</span>
        <Skeleton variant="line" count={2} className="max-w-sm" />
        <Skeleton variant="card" count={2} />
      </div>
    );
  }
  if (status === "unknown") return <ErrorNote onRetry={check}>Couldn't check access to the admin console. Check your connection and try again.</ErrorNote>;
  return (
    <EmptyState
      icon={LockKeyhole}
      title="This page is for Orbit's admin"
      body="The admin console is only open to the account that runs Orbit. Everything of yours is on Home."
      action={
        <Link to="/" className={buttonClass("primary", "md")}>
          Go to Home
        </Link>
      }
    />
  );
}
