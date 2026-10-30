import type { JobTrackerEntry } from "@orbit/types";

/** The message asking for feedback: short, polite, asks for one thing to improve and to be kept in mind. Free, no AI. */
export function feedbackRequest(entry: Pick<JobTrackerEntry, "company" | "title">, name: string): string {
  const role = entry.title.trim() ? `the ${entry.title.trim()} role` : "the role";
  const company = entry.company.trim() || "your team";
  return [
    "Hi,",
    "",
    `Thank you for letting me know about ${role}, and for the time ${company} spent on my application.`,
    "If you have a minute, I'd value one or two points on what would have made my application or interviews stronger. "
      + "It would help me a lot.",
    "",
    entry.company.trim() ? `I'd also be glad to be considered for future roles at ${company}.` : "I'd also be glad to be considered for future roles.",
    "",
    "Best regards,",
    name.trim() || "",
  ].join("\n").trimEnd();
}

/** Where to go next after a no: the same title elsewhere (Matches reads `?q=`) and a practice round for this role. */
export function bounceLinks(entry: Pick<JobTrackerEntry, "company" | "title">): { similar: string; practice: string } {
  const title = entry.title.trim();
  const company = entry.company.trim();
  const at = (path: string, q: Record<string, string>) => (Object.keys(q).length ? `${path}?${new URLSearchParams(q)}` : path);
  return {
    similar: at("/jobs/matches", title ? { q: title } : {}),
    practice: at("/mock", { ...(title ? { role: title } : {}), ...(company ? { company } : {}) }),
  };
}
