import type { OrbitDocument } from "@orbit/types";
import { MAX_SESSION_DOCUMENTS } from "@orbit/ui";

/**
 * Which documents a new live session reads (the checkboxes on /start). The same rules as the desktop app's Setup
 * (apps/desktop/src/sessionDocs.ts), as plain functions so they can be tested.
 *
 * A session takes at most MAX_SESSION_DOCUMENTS (the API refuses more), and saved documents pile up: Jobs AI saves a
 * job description for every job prepared, Resume AI a resume for every tailoring. Ticking every one by default
 * stopped Start altogether past the limit ("List should have at most 20 items after validation").
 */

/**
 * The ready resumes and job descriptions, newest first (the order the API lists them), up to the limit. The newest
 * resume and the newest job description always make it: a pile of newer job descriptions must not push the resume
 * out.
 */
export function defaultSessionDocuments(docs: readonly OrbitDocument[]): Set<string> {
  const usable = docs.filter((d) => d.status === "ready" && (d.kind === "resume" || d.kind === "job_description"));
  const newestResume = usable.find((d) => d.kind === "resume");
  const newestJob = usable.find((d) => d.kind === "job_description");
  const first = [newestResume, newestJob].filter((d): d is OrbitDocument => d !== undefined);
  const ids = [...first, ...usable.filter((d) => !first.includes(d))].map((d) => d.id);
  return new Set(ids.slice(0, MAX_SESSION_DOCUMENTS));
}

/** `selected` with `id` ticked or unticked; ticking one more than a session can take does nothing. */
export function toggleSessionDocument(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else if (next.size < MAX_SESSION_DOCUMENTS) next.add(id);
  return next;
}

/** A saved setup's documents: the ones that still exist, at most the limit (it may predate the limit). */
export function restoredSessionDocuments(ids: readonly string[], docs: readonly OrbitDocument[] | null): Set<string> {
  return new Set(sessionDocumentIds(new Set(ids), docs));
}

/** The ticked documents that still exist, at most the limit: what Start sends. */
export function sessionDocumentIds(selected: ReadonlySet<string>, docs: readonly OrbitDocument[] | null): string[] {
  const ids = docs ? [...selected].filter((id) => docs.some((d) => d.id === id)) : [...selected];
  return ids.slice(0, MAX_SESSION_DOCUMENTS);
}
