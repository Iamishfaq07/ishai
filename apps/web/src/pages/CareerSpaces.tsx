import { Link, useLocation } from "react-router-dom";
import { ErrorNote, MOCK_INTERVIEW_ENABLED, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../lib/auth";
import { missionPath } from "./jobs/paths";
const link = cx("block min-h-14 rounded-xl border border-zinc-200 bg-white p-4 text-sm hover:border-indigo-400 motion-safe:transition-colors dark:border-white/10 dark:bg-zinc-900", focusRing);
/** Contextual destinations into existing tools; no extra candidate records or AI generation. */
export function CareerSpacesPage() {
  const prepare = useLocation().pathname.replace(/\/+$/, "") === "/prepare";
  const { user } = useAuth();
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const jobs = tracker.data?.filter((j) => !["hired", "withdrawn", "rejected"].includes(j.status));
  const groups = prepare ? [
    { title: "Rehearse", items: [...(MOCK_INTERVIEW_ENABLED ? [["/mock", "Practice with Saba", "Choose role, format and duration for a simulated interview."], ["/interview", "Video interview", "Rehearse a conversation with the video interviewer."]] : []), ["/warmup", "Quick warm-up", "Practise a question before your interview."]] },
    { title: "Bring an invitation", items: [["/jobs?work=updates&input=calendar", "Import interview invitation", "Review a calendar file, choose its job and confirm the time."]] },
    { title: "Build your answers", items: [["/documents/stories", "My stories", "Use your own projects and achievements."], ["/learn", "Learning", "Work on gaps without claiming an unfinished skill."], ["/code", "Coding practice", "Practise technical problems and explain your approach."]] },
    { title: "Permitted live assistance", items: [["/start", "Live interview copilot", "Use only where AI assistance is permitted. This is separate from rehearsal."]] },
  ] : [
    { title: "My experience", items: [["/jobs?work=resume", "Resume", "Build, import or edit one section at a time."], ["/documents", "Source documents", "Manage the documents you choose to use."], ...(user?.evidence_vault ? [["/documents/evidence", "Evidence", "Review the sources behind your claims."]] : []), ["/documents/stories", "My stories", "Save truthful examples from your experience."], ["/linkedin", "Professional profiles", "Review suggestions before changing a public profile."]] },
    { title: "My search", items: [["/jobs/profile", "Search preferences", "Resume, roles, locations and work mode."], ["/jobs/outreach?network=1", "Contacts & outreach", "Keep your contacts and reviewed drafts together."], ["/offers", "Offers & decisions", "Compare the offer details you record."], ["/jobs/weekly", "Weekly progress", "Review your recorded activity and choose targets."]] },
    { title: "Privacy & account", items: [["/settings", "Settings & privacy", "Sessions, permissions, export and account deletion."], ["/billing", "Credits & usage", "Review your plan, costs and purchase history."], ["/tools", "All tools", "Search the full catalogue when you need a specialist tool."]] },
  ];
  return <div className="min-w-0 space-y-6 break-words"><header><p className="text-xs font-semibold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">Personal Orbit</p><h1 className="mt-2 font-display text-3xl font-semibold">{prepare ? "Prepare" : "My Career"}</h1><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{prepare ? "Prepare for one saved opportunity, or choose a general practice mode." : "Your resume, experience and search preferences in one place. Choose what to add or edit."}</p></header>
    {prepare && <section aria-labelledby="prepare-job"><h2 id="prepare-job" className="font-semibold">Prepare for a saved job</h2>
      {tracker.error ? <ErrorNote onRetry={tracker.reload}>Your saved jobs could not load. Retry or choose general practice below.</ErrorNote> : !jobs ? <p role="status" className="mt-3">Loading your opportunities…</p> : jobs.length ? <ul className="mt-3 grid gap-3 sm:grid-cols-2">{jobs.map((j) => <li key={j.id}><Link className={link} to={`${missionPath(j.id)}?tab=plan&guide=1`}><span className="font-semibold">{j.title} · {j.company}</span><span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">Open this job’s preparation and recorded dates</span></Link></li>)}</ul> : <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No active saved jobs. <Link to="/jobs/tracker?add=1" className="font-semibold underline">Add a job or interview</Link>, or practise for a general role below.</p>}
    </section>}
    {groups.map((g) => <section key={g.title} aria-label={g.title}><h2 className="font-semibold">{g.title}</h2><ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{g.items.map(([to,title,detail]) => <li key={to}><Link to={to!} className={link}><span className="font-semibold">{title}</span><span className="mt-2 block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{detail}</span></Link></li>)}</ul></section>)}
  </div>;
}
