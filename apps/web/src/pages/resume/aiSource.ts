import type { Resume } from "@orbit/types";

/** Only inputs used by AI; renaming the file or editing a cover letter does not invalidate resume fixes. */
export function resumeAiSource(resume: Pick<Resume, "id" | "data" | "design" | "job_text">): string {
  return JSON.stringify([resume.id, resume.data, resume.design, resume.job_text]);
}
