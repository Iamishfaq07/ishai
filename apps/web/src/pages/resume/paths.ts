/**
 * Where Orbit Resume AI lives in the web app: its home (your resumes, or the public product page when signed out) and
 * the editor for each resume. Also where the resume maker's old addresses go now. (`/resume-ai/jobs`, where Jobs
 * once was, goes to Jobs AI: pages/jobs/paths.ts.)
 */
export const RESUME_AI_HOME = "/resume-ai";

/** The editor for one resume. */
export function resumePath(id: string): string {
  return `${RESUME_AI_HOME}/${encodeURIComponent(id)}`;
}

/** True when the open resume has edits and the address is now a different resume. Those edits still have to be saved. */
export function shouldFlushResume(openId: string | null | undefined, nextId: string, dirty: boolean): boolean {
  return Boolean(dirty && openId && openId !== nextId);
}

/** The product home itself, where a signed-out visitor sees the public page instead of signing in. */
export function isResumeAiHome(pathname: string): boolean {
  return /^\/resume-ai\/?$/.test(pathname);
}

/**
 * Where an old resume maker address goes now: Documents → Resume maker (/documents/resumes), one resume there
 * (/documents/resumes/:id) and the old signed-out maker (/resume-maker). Null for any other address.
 */
export function movedResumePath(pathname: string): string | null {
  if (/^\/resume-maker\/?$/.test(pathname)) return RESUME_AI_HOME;
  const m = /^\/documents\/resumes(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ? `${RESUME_AI_HOME}/${m[1]}` : RESUME_AI_HOME; // the id stays as it was written in the address
}
