import type { OrbitDocument } from "@orbit/types";

/** The most documents one session can use (the API rejects more: `document_ids` max_length in sessions/routes.py). */
export const MAX_SESSION_DOCUMENTS = 20;

/**
 * The documents a practice session reads: the ready resumes plus at most one job description (the role being
 * practised for). Sending every saved job description both blurs which role it is and, for someone with many, goes
 * past the API's limit so the mock can't start at all. The job description goes first so the cap never drops it.
 */
export function practiceDocumentIds(docs: readonly OrbitDocument[], jobDescriptionId: string | null): string[] {
  const jd = jobDescriptionId
    ? docs.find((d) => d.id === jobDescriptionId && d.kind === "job_description" && d.status === "ready")
    : undefined;
  const resumes = docs.filter((d) => d.kind === "resume" && d.status === "ready").map((d) => d.id);
  return [...(jd ? [jd.id] : []), ...resumes].slice(0, MAX_SESSION_DOCUMENTS);
}
