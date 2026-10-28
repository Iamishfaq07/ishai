import type { JobStatus, JobTrackerEntry } from "@orbit/types";
import { missionPath } from "../jobs/paths";

/**
 * Today in the Route map direction: one next stop, this week's stops across every job, and each job's route. Built
 * only from saved records (the action queue and the tracker); nothing is estimated or scored.
 */

export interface QueueItem {
  id: string; kind: "interview" | "follow_up" | "contact" | "application" | "preparation";
  title: string; detail: string; due_at: string | null; overdue: boolean; path: string;
  action_label?: string; priority_reason?: string;
  /** Set on undated suggestions from workflow rules (job_portal/playbooks.py). */
  rule?: string;
}
export interface Queue { items: QueueItem[]; focus_id?: string | null }

export interface NextStop { title: string; when: string | null; detail: string; reason: string | null; action: string; to: string; first?: boolean }

const KIND: Record<QueueItem["kind"], string> = { interview: "Interview", follow_up: "Follow-up", contact: "Contact", application: "Application", preparation: "Preparation" };
const ACTIVE: JobStatus[] = ["saved", "applied", "interviewing", "offer"];
const RANK: Partial<Record<JobStatus, number>> = { offer: 0, interviewing: 1, applied: 2, saved: 3 };
const DAY = 86_400_000;

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function activeJobs(entries: JobTrackerEntry[]): JobTrackerEntry[] {
  const at = (e: JobTrackerEntry) => (e.next_at ? Date.parse(e.next_at) : Number.POSITIVE_INFINITY);
  return entries.filter((e) => ACTIVE.includes(e.status))
    .sort((a, b) => (at(a) - at(b)) || ((RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)) || a.id.localeCompare(b.id));
}

/** The one thing to do next: the action queue's own focus when it loaded, else the nearest dated job, else a saved
 *  job to apply to, else the first step of a search. */
export function pickNextStop(queue: Queue | null, entries: JobTrackerEntry[] | null, now = Date.now()): NextStop | null {
  const focus = queue?.items.find((i) => i.id === queue.focus_id) ?? queue?.items[0];
  // An undated rule suggestion (find contacts, decide on a saved job) never outranks an offer waiting for a decision
  // or an interview still to prepare for.
  const pressing = focus && !focus.due_at && focus.rule && entries ? activeJobs(entries).find((j) => j.status === "offer" || j.status === "interviewing") : undefined;
  if (pressing) return pressing.status === "offer"
    ? { title: `${pressing.title} · ${pressing.company}`, when: null, detail: "You have an offer here. See what it pays each month, how it compares and what to ask for, then decide.",
        reason: "An offer waiting for your decision comes before suggestions.", action: "Review the offer", to: `${missionPath(pressing.id)}?tab=offer` }
    : { title: `${pressing.title} · ${pressing.company}`, when: null, detail: "You're interviewing here. Add the date if you have it, then work through the preparation plan.",
        reason: "An interview in progress comes before suggestions.", action: "Prepare for interview", to: `${missionPath(pressing.id)}?tab=plan` };
  if (focus) return { title: focus.title, when: focus.due_at ? `${KIND[focus.kind]} · ${whenLabel(focus.due_at, now)}` : null, detail: focus.detail, reason: focus.priority_reason ?? null, action: focus.action_label ?? "Open", to: focus.path };
  if (!entries) return null;
  const jobs = activeJobs(entries);
  const dated = jobs.find((j) => j.next_at && Date.parse(j.next_at) >= startOfDay(now));
  if (dated) {
    const interview = dated.status === "interviewing";
    return { title: `${dated.title} · ${dated.company}`, when: `${interview ? "Interview" : "Next date"} · ${whenLabel(dated.next_at!, now)}`, detail: interview ? "Your interview is coming up. Open its preparation plan." : "Your saved next date is coming up.",
      reason: `Saved for ${dayLabel(dated.next_at!, now).toLowerCase()}.`, action: interview ? "Prepare for interview" : "Open this job",
      to: `${missionPath(dated.id)}${interview ? "?tab=plan" : ""}` };
  }
  // No date anywhere: the furthest job, with the step its stage needs.
  const furthest = jobs.find((j) => j.status === "offer") ?? jobs.find((j) => j.status === "interviewing");
  if (furthest?.status === "offer") return { title: `${furthest.title} · ${furthest.company}`, when: null, detail: "You have an offer here. See what it pays each month, how it compares and what to ask for, then decide.",
    reason: null, action: "Review the offer", to: `${missionPath(furthest.id)}?tab=offer` };
  if (furthest) return { title: `${furthest.title} · ${furthest.company}`, when: null, detail: "You're interviewing here. Add the interview date so your prep plan counts down to it, then practise for the round.",
    reason: null, action: "Add the date and prepare", to: `${missionPath(furthest.id)}?tab=interview` };
  const saved = jobs.find((j) => j.status === "saved");
  if (saved) return { title: `${saved.title} · ${saved.company}`, when: null, detail: "Saved and not applied to yet. Check the fit, tailor your resume, then apply on the employer's site.",
    reason: null, action: "Get ready to apply", to: missionPath(saved.id) };
  if (jobs.length) return { title: `${jobs[0]!.title} · ${jobs[0]!.company}`, when: null, detail: "Nothing is due. Keep this one moving.", reason: null, action: "Open this job", to: missionPath(jobs[0]!.id) };
  // Hired, and nothing else open: the step after the offer, not a search from scratch.
  const hired = entries.find((e) => e.status === "hired");
  if (hired) return { title: `You're starting at ${hired.company}`, when: null, detail: `Congratulations. Plan your first 90 days as ${hired.title}: what to learn first, who to meet and what to ask your manager.`,
    reason: null, action: "Plan my first 90 days", to: `${missionPath(hired.id)}?tab=offer` };
  // Every route closed (a rejection, a withdrawal): the next search, not a first one.
  if (entries.length) return { title: "Find your next one", when: null, detail: "Your closed routes keep what you learned. Save the next job you'd like and start its route.",
    reason: null, action: "Find jobs", to: "/jobs/matches", first: true };
  return { title: "Save the first job you'd like", when: null, detail: "Every job you save gets its own route: resume, practice, interviews and offer, kept together.",
    reason: null, action: "Find jobs", to: "/jobs/matches", first: true };
}

/** "Saturday 24 October, 10:30 am": the day as dayLabel says it, plus the date and the time when one was saved. */
export function whenLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const day = dayLabel(iso, now);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  const time = d.getHours() || d.getMinutes() ? `, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
  return `${day === "Today" || day === "Tomorrow" || day === "Past due" ? day : d.toLocaleDateString(undefined, { weekday: "long" })} ${date}${time}`;
}

/** "Today", "Tomorrow", "Thu", or a short date further out. */
export function dayLabel(iso: string, now = Date.now()): string {
  const days = Math.round((startOfDay(Date.parse(iso)) - startOfDay(now)) / DAY);
  if (days < 0) return "Past due";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const d = new Date(iso);
  return days < 7 ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export interface WeekStop { id: string; label: string; title: string; kind: QueueItem["kind"]; to: string }
export interface WeekDay { key: string; label: string; date: string | null; stops: WeekStop[] }


/** This week as stops by day: past-due first (only when there is any), then today and the next six days. Items with
 *  no date stay in the full list, not on the strip. */
export function weekStops(queue: Queue | null, entries: JobTrackerEntry[] | null, now = Date.now()): WeekDay[] {
  const today = startOfDay(now);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const t = today + i * DAY;
    return { key: `d${i}`, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(t).toLocaleDateString(undefined, { weekday: "short" }),
      date: new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }), stops: [] };
  });
  const past: WeekDay = { key: "past", label: "Past due", date: null, stops: [] };
  const place = (iso: string, stop: WeekStop) => {
    const i = Math.round((startOfDay(Date.parse(iso)) - today) / DAY);
    if (i < 0) past.stops.push(stop); else if (i < 7) days[i]!.stops.push(stop);
  };
  if (queue) {
    for (const it of queue.items) if (it.due_at) place(it.due_at, { id: it.id, label: KIND[it.kind], title: it.title, kind: it.kind, to: it.path });
  } else {
    for (const e of activeJobs(entries ?? [])) if (e.next_at) place(e.next_at, { id: e.id, label: e.status === "interviewing" ? "Interview" : "Follow-up",
      title: `${e.title} · ${e.company}`, kind: e.status === "interviewing" ? "interview" : "follow_up", to: missionPath(e.id) });
  }
  return past.stops.length ? [past, ...days] : days;
}
