/**
 * Where Orbit Jobs AI lives in the web app: its home (an overview, or the public product page when signed out), the
 * ranked matches, one job's page, the tracker, Outreach and the search profile. Also where Jobs' old addresses inside
 * Resume AI (`/resume-ai/jobs`, `?view=tracker`) go now.
 */
export const JOBS_AI_HOME = "/jobs";
export const JOBS_MATCHES = "/jobs/matches";
export const JOBS_TRACKER = "/jobs/tracker";
export const JOBS_OUTREACH = "/jobs/outreach";
export const JOBS_PROFILE = "/jobs/profile";
/** Orbit Apply (D84): its setup, and the Applications it prepared and sent. `?packet=<id>` opens one. */
export const JOBS_AUTO_APPLY = "/jobs/auto-apply";
export const JOBS_APPLICATIONS = "/jobs/applications";

/** One Orbit Apply application, opened (the "Finish in one click" email links here). */
export function applicationPath(packetId: string): string {
  return `${JOBS_APPLICATIONS}?packet=${encodeURIComponent(packetId)}`;
}

/** One job's own page. */
export function jobPath(id: string): string {
  return `${JOBS_AI_HOME}/listing/${encodeURIComponent(id)}`;
}

/** The matches for one resume: Jobs AI matches its feed to that resume first (Resume AI's "Find jobs" link). */
export function jobsForResume(resumeId: string): string {
  return `${JOBS_MATCHES}?resume=${encodeURIComponent(resumeId)}`;
}

/**
 * Outreach (the messages and the Naukri and LinkedIn profiles, once Resume AI's "Profiles & outreach" tab), written
 * from one resume (`resume`, else the one edited last) and for one job in Jobs AI (`job`, its listing id): a job's
 * page and the tracker open it for their job, Resume AI's editor for its resume.
 */
export function outreachPath({ resume, job }: { resume?: string | null; job?: string | null } = {}): string {
  const query = new URLSearchParams();
  if (job) query.set("job", job);
  if (resume) query.set("resume", resume);
  const q = query.toString();
  return q ? `${JOBS_OUTREACH}?${q}` : JOBS_OUTREACH;
}

/** Outreach's own page, where `?resume=` is the resume it writes from, not the one the feed should match. */
export function isOutreach(pathname: string): boolean {
  return /^\/jobs\/outreach\/?$/.test(pathname);
}

/** The product home itself, where a signed-out visitor sees the public page instead of signing in. */
export function isJobsAiHome(pathname: string): boolean {
  return /^\/jobs\/?$/.test(pathname);
}

/**
 * Where an address from when Jobs was a tab of Resume AI goes now: `/resume-ai/jobs` (the feed) to the matches, with
 * `?view=tracker` to the tracker, and anything under it to the same place under `/jobs`. The rest of the query stays
 * (without `view`, which the new addresses don't use). Null for any other address, `/resume-ai/jobsearch` (a resume)
 * included.
 */
export function movedJobsPath(pathname: string, search = ""): { pathname: string; search: string } | null {
  const m = /^\/resume-ai\/jobs(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const params = new URLSearchParams(search);
  const view = params.get("view");
  params.delete("view");
  const rest = (m[1] ?? "").replace(/\/+$/, "");
  const query = params.toString();
  return {
    pathname: rest ? `${JOBS_AI_HOME}${rest}` : view === "tracker" ? JOBS_TRACKER : JOBS_MATCHES,
    search: query ? `?${query}` : "",
  };
}
