import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BizHiringDesk, BizHiringDeskInterview } from "@orbit/types";
import { Button, Callout, buttonClass } from "@orbit/ui";
import { PageTitle, useCompany } from "./BusinessApp";
import { hiringApi } from "./hiringApi";
import { HiringLoopGraphic } from "./HiringGraphics";
import { roomPath } from "./hiringModel";
import { applicationPath, companyPath, dayTime } from "./model";
import { LoadError, Loading, Panel, Stat } from "./ui";

export function HiringDeskPage() {
  const { company } = useCompany();
  const [data, setData] = useState<BizHiringDesk | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    hiringApi.desk(company.id).then((d) => { if (live) setData(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { live = false; };
  }, [company.id, load]);
  if (error) return <LoadError error={error} onRetry={() => setLoad((n) => n + 1)} />;
  if (!data) return <Loading label="Loading the hiring desk" />;
  const interviews = (items: BizHiringDeskInterview[], due: boolean) => items.length ? <ul className="divide-y divide-zinc-200 dark:divide-white/10">{items.map((iv) => <li key={`${iv.application_id}-${iv.when}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
    <div className="min-w-0"><h3 className="font-medium">{iv.name}</h3><p className="text-sm text-zinc-500">{iv.job_title} · {dayTime(iv.when)}</p><p className="mt-1 break-words text-xs text-zinc-500">{iv.duration_min} min · {iv.location}</p></div>
    <Link to={roomPath(company.id, iv.application_id)} className={buttonClass("secondary", "sm")}>{due ? "Write feedback" : "Prepare interview"}</Link>
  </li>)}</ul> : <p className="py-6 text-sm text-zinc-500">{due ? "No outstanding feedback in the last seven days." : "No upcoming booked interviews."}</p>;
  return <div className="space-y-5">
    <PageTitle title="Hiring desk" subtitle="Your team's next actions, from candidate questions to interview debriefs." actions={<Button variant="secondary" onClick={() => setLoad((n) => n + 1)}>Refresh</Button>} />
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Candidate attention" value={data.attention.length} detail="Shown in this queue" /><Stat label="Upcoming interviews" value={data.upcoming.length} detail="Next booked conversations" /><Stat label="Feedback due" value={data.feedback_due.length} detail="Completed interviews · last 7 days" /></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5"><Panel title="Candidates waiting on your team" hint="Questions, deletion requests and applications beyond the job's response target.">
        {data.attention.length ? <ul className="divide-y divide-zinc-200 dark:divide-white/10">{data.attention.map((a) => <li key={a.application_id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{a.name}</h3><p className="text-xs text-zinc-500">{a.job_title} · {a.reference}</p></div><Link to={applicationPath(company.id, a.application_id)} className={buttonClass("secondary", "sm")}>Review application</Link></div>
          <p className={`mt-2 text-sm ${a.priority === "urgent" ? "text-rose-700 dark:text-rose-300" : "text-zinc-600 dark:text-zinc-400"}`}>{a.reason}</p>
        </li>)}</ul> : <div className="py-4"><p className="font-medium">No waiting items in this queue</p><p className="mt-1 text-sm text-zinc-500">Candidate questions and time-sensitive follow-ups will appear here.</p><HiringLoopGraphic /></div>}
      </Panel><Panel title="Feedback to finish">{interviews(data.feedback_due, true)}</Panel></div>
      <div className="space-y-5"><Panel title="Upcoming interviews" hint="Times shown in your local time zone. Availability checks cover shared panel members inside this company in Orbit.">{interviews(data.upcoming, false)}</Panel>
        <Panel title="Build a consistent hiring loop"><p className="text-sm text-zinc-600 dark:text-zinc-400">Set a role-specific interview plan, collect independent observations, and discuss gaps before recording a human decision. Practical challenges include a changed constraint to explore how someone adapts.</p><Link to={companyPath(company.id, "jobs")} className={`mt-4 ${buttonClass("secondary")}`}>Open your jobs</Link></Panel>
      </div>
    </div>
    {data.limited && <Callout tone="warning">This desk scanned the oldest 2,000 active applications. Open individual job pipelines for the rest.</Callout>}
    <p className="text-xs text-zinc-500">Updated {new Date(data.as_of).toLocaleString()} · Queues show up to 30 attention items and 20 interviews each.</p>
  </div>;
}
