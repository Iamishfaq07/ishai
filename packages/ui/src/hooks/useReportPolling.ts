import { useEffect, useRef } from "react";

const POLL_MS = 3000;
const MAX_POLLS = 80; // ~4 min: the job retries a failed narrative with backoff before giving up

/**
 * Reports are written by a background job after a session ends. While a session's report is "pending",
 * quietly re-fetch it (no spinner) until it's ready.
 */
export function useReportPolling(status: string | null | undefined, refresh: () => Promise<unknown>): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (status !== "pending") return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) clearInterval(timer);
      else void refreshRef.current().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status]);
}
