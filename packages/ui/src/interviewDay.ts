import type {
  InterviewOutcome,
  InterviewRoundType,
  InterviewSessionContext,
  JobStatus,
  JobTrackerEntry,
  MockInterviewType,
  MockPersona,
  OrbitDocument,
} from "@orbit/types";

/**
 * Interview day, shared by the web app and the desktop app (apps/api/orbit_api/job_portal/interview.py): the round
 * types, which tracked jobs have an interview coming up, the mock interviewer for a round, the documents a session
 * started from a job reads, and the wrap-up's suggestion. Nothing here moves a job: the user confirms every change.
 */

export const ROUND_TYPES: Array<{ value: InterviewRoundType; label: string; hint: string }> = [
  { value: "hr", label: "HR round", hint: "Your background, why this job, notice period and pay" },
  { value: "technical", label: "Technical round", hint: "The skills the job asks for, your projects, problem solving" },
  { value: "managerial", label: "Managerial round", hint: "How you work with people, ownership, decisions you made" },
  { value: "final", label: "Final round", hint: "Fit and motivation, often with a senior leader" },
];

const ROUND_NAME: Record<InterviewRoundType, string> = { hr: "HR round", technical: "Technical round", managerial: "Managerial round", final: "Final round" };

/** "Round 2 · Technical round", "HR round", "Round 3", or "" (the server's rounds.round_label). */
export function roundLabel(type: InterviewRoundType | null | undefined, number: number | null | undefined): string {
  return [number ? `Round ${number}` : "", type ? ROUND_NAME[type] ?? "" : ""].filter(Boolean).join(" · ");
}

/** Who asks in a practice round for this round type, and about what. */
export function mockForRound(type: InterviewRoundType | null | undefined): { persona: MockPersona; interview_type: MockInterviewType } {
  switch (type) {
    case "hr":
      return { persona: "recruiter", interview_type: "behavioral" };
    case "technical":
      return { persona: "engineer", interview_type: "technical" };
    case "managerial":
      return { persona: "hiring_manager", interview_type: "behavioral" };
    case "final":
      return { persona: "executive", interview_type: "mixed" };
    default:
      return { persona: "hiring_manager", interview_type: "mixed" };
  }
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole local days from today to the date: 0 today, 1 tomorrow, negative in the past. */
export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.round((startOfDay(new Date(iso).getTime()) - startOfDay(now)) / 86_400_000);
}

/**
 * Whether a tracker date has a time of day. The tracker's own date field saves local noon (no time), so noon on the
 * dot reads as "that day" and any other time as the interview's time.
 */
export function hasTime(iso: string): boolean {
  const d = new Date(iso);
  return !(d.getHours() === 12 && d.getMinutes() === 0 && d.getSeconds() === 0);
}

/** "Today, 3:00 pm", "Tomorrow", "Thu 24 Oct, 11:30 am"; "" without a date. */
export function interviewWhen(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = daysUntil(iso, now);
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return hasTime(iso) ? `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : day;
}

/** A date and time for <input type="datetime-local">, in local time ("" without one). */
export function dateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An <input type="datetime-local"> value back to an ISO time, or null when it isn't one. */
export function fromDateTimeInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi, 0).toISOString();
}

/**
 * Tracked jobs with an interview coming up, soonest first: interviewing, with a date from today to `withinDays` ahead;
 * then the ones interviewing with no date yet. (A date on a job that's only applied is a follow-up, as the tracker
 * names it.) The desktop's "Upcoming interviews".
 */
export function upcomingInterviews(entries: readonly JobTrackerEntry[], now: number = Date.now(), withinDays = 14, limit = 5): JobTrackerEntry[] {
  const dated = entries
    .filter((e) => e.status === "interviewing" && e.next_at && daysUntil(e.next_at, now) >= 0 && daysUntil(e.next_at, now) <= withinDays)
    .sort((a, b) => a.next_at!.localeCompare(b.next_at!));
  const undated = entries.filter((e) => e.status === "interviewing" && !e.next_at).sort((a, b) => b.status_at.localeCompare(a.status_at));
  return [...dated, ...undated].slice(0, limit);
}

/** Interviews today and tomorrow (Home's card): a job that's interviewing with its date on one of those days. */
export function interviewsSoon(entries: readonly JobTrackerEntry[], now: number = Date.now()): Array<{ entry: JobTrackerEntry; days: 0 | 1 }> {
  return entries
    .filter((e) => e.next_at && e.status === "interviewing")
    .map((e) => ({ entry: e, days: daysUntil(e.next_at!, now) }))
    .filter((x): x is { entry: JobTrackerEntry; days: 0 | 1 } => x.days === 0 || x.days === 1)
    .sort((a, b) => a.entry.next_at!.localeCompare(b.entry.next_at!));
}

/**
 * The documents a session started from a job reads: the job's (its post and the resume version), plus the resumes
 * setup would pick anyway when the job has none linked. Other job posts stay off: they'd blur which role it is.
 */
export function contextDocumentIds(ctx: Pick<InterviewSessionContext, "document_ids" | "resume_included">, docs: readonly OrbitDocument[]): string[] {
  const resumes = ctx.resume_included ? [] : docs.filter((d) => d.kind === "resume" && d.status === "ready").map((d) => d.id);
  return [...new Set([...ctx.document_ids, ...resumes])].slice(0, 20);
}

/** The session fields a job's context fills in (with `application_id`, so the round shows on the job). */
export function contextSessionFields(ctx: InterviewSessionContext) {
  return {
    application_id: ctx.application_id,
    role: ctx.role,
    company: ctx.company,
    interview_stage: ctx.interview_stage,
    key_requirements: ctx.key_requirements,
    tech_stack: ctx.tech_stack,
  };
}

/** "Job post, the resume you sent on 12 Oct and the Razorpay guide": what a session from a job starts with. */
export function contextSummary(ctx: Pick<InterviewSessionContext, "documents" | "version" | "guide">): string {
  const parts: string[] = [];
  if (ctx.documents.some((d) => d.kind === "job_description")) parts.push("the job post");
  if (ctx.version) {
    parts.push(
      ctx.version.kind === "snapshot"
        ? `the resume you sent on ${new Date(ctx.version.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
        : `your resume “${ctx.version.title}”`,
    );
  }
  if (ctx.guide) parts.push(`the ${ctx.guide} guide`);
  if (!parts.length) return "";
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const OUTCOMES: Array<{ value: InterviewOutcome; label: string }> = [
  { value: "next_round", label: "There's a next round" },
  { value: "waiting", label: "Waiting to hear" },
  { value: "offer", label: "I got an offer" },
  { value: "rejected", label: "Not this time" },
];

/**
 * What the wrap-up suggests after a real round, for the user to confirm: a next round (the default: most rounds lead
 * to another), unless the job already has an offer. Never applied on its own.
 */
export function suggestedOutcome(status: JobStatus): InterviewOutcome {
  return status === "offer" ? "offer" : status === "rejected" ? "rejected" : "next_round";
}

/** What confirming an outcome does to the job, in words ("Moves to Interviewing, round 2"). */
export function outcomeEffect(outcome: InterviewOutcome, status: JobStatus, round: number | null | undefined): string {
  const to = status === "saved" || status === "applied" || status === "rejected" ? "Moves it to Interviewing" : "Keeps it at Interviewing";
  if (outcome === "next_round") return `${to}, round ${(round ?? 1) + 1}.`;
  if (outcome === "waiting") return `${to}, with a date to follow up if you set one.`;
  if (outcome === "offer") return "Moves it to Offer.";
  return "Moves it to Not this time and clears its date.";
}

/** A week from now at 10 am local: a sensible "follow up on" default after a round. */
export function followUpDefault(now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, 10, 0, 0).toISOString();
}
