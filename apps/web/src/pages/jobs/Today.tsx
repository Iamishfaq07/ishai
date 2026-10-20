import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { CareerHub } from "./CareerHub";
const Daily = lazy(() => import("./ActionDesk").then((m) => ({ default: m.JobActionDeskPage })));

export function JobsTodayPage() {
  const { pathname } = useLocation();
  if (pathname.replace(/\/$/, "") !== "/jobs/actions") return <CareerHub />;
  return <div className="space-y-6">
    <header><p className="text-sm font-medium text-sky-700 dark:text-sky-300">Career launchpad</p>
      <h1 className="mt-1 font-display text-2xl font-semibold">Daily actions</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Your next action, interviews and follow-ups from saved activity.</p></header>
    <Suspense fallback={<p role="status">Opening daily actions…</p>}><Daily /></Suspense>
  </div>;
}
