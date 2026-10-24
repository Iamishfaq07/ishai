import { useEffect } from "react";
import { ErrorNote } from "../../components/ui";
import { Skeleton } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
interface Overview { applications_recorded: number; ever_interviewed: number; ever_offered: number; upcoming_interviews: number; gmail_sent: number; gmail_drafts: number; gmail_needs_review: number; note: string }
export function CareerOverview() {
  const view = useAsync(() => api.call<Overview>("/v1/career/overview"), [], "career-overview");
  const reload = view.reload;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  if (view.error) return <ErrorNote onRetry={view.reload}>Could not load your career overview.</ErrorNote>;
  if (!view.data) return <Skeleton variant="card" count={1} label="Loading career overview" />;
  const data = view.data;
  const metrics = [["Applications recorded", data.applications_recorded], ["Ever reached interview", data.ever_interviewed], ["Ever reached offer", data.ever_offered], ["Interviews in 7 days", data.upcoming_interviews], ["Gmail accepted emails", data.gmail_sent], ["Stored email drafts", data.gmail_drafts], ["Email results to check", data.gmail_needs_review]] as const;
  return <section aria-labelledby="career-overview" className="space-y-3"><h2 id="career-overview" className="font-semibold">Your career overview</h2>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs text-zinc-500 dark:text-zinc-400">{data.note}</p>
  </section>;
}
