/**
 * Where Orbit Jobs AI lives in the web app: its home (an overview, or the public product page when signed out), the
 * ranked matches, one job's page, the tracker and the search profile. Also where Jobs' old addresses inside Resume AI
 * (`/resume-ai/jobs`, `?view=tracker`) go now.
 */
export const JOBS_AI_HOME = "/jobs";
export const JOBS_MATCHES = "/jobs/matches";
export const JOBS_TRACKER = "/jobs/tracker";
export const JOBS_PROFILE = "/jobs/profile";

/** One job's own page. */
export function jobPath(id: string): string {
  return `${JOBS_AI_HOME}/listing/${encodeURIComponent(id)}`;
}

/** The matches for one resume: Jobs AI matches its feed to that resume first (Resume AI's "Find jobs" link). */
export function jobsForResume(resumeId: string): string {
  return `${JOBS_MATCHES}?resume=${encodeURIComponent(resumeId)}`;
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
