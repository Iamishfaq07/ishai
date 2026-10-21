/**
 * Career-gap explainer: an honest resume line and a short spoken answer for a break, in the shape career coaches
 * recommend (name it briefly, say what you did, show you're ready now). The reason is the candidate's; nothing is
 * embellished and private details (a diagnosis, a family matter) are never asked for.
 */

export const REASONS = [
  { id: "study", label: "Study or upskilling", line: "Full-time study", answer: "I took time out to study full-time" },
  { id: "exam", label: "Competitive exam preparation", line: "Preparing for competitive exams", answer: "I spent that time preparing for a competitive exam" },
  { id: "health", label: "Health (yours)", line: "Career break for health reasons, now fully resolved", answer: "I took a break for a health matter, which is fully behind me now" },
  { id: "family", label: "Caring for family", line: "Career break to care for a family member", answer: "I took a planned break to care for a family member" },
  { id: "parent", label: "Parenting", line: "Parental career break", answer: "I took a break to look after my young child" },
  { id: "layoff", label: "Layoff, then job search", line: "Job search after a company-wide layoff", answer: "my role was part of a company-wide layoff, and I've been searching carefully for the right next role" },
  { id: "relocation", label: "Relocation", line: "Career break during an international or city move", answer: "I relocated, and took time to settle before job hunting" },
  { id: "venture", label: "Own business or freelancing", line: "Founder / freelance work", answer: "I ran my own venture" },
  { id: "personal", label: "Travel or personal time", line: "Planned career break", answer: "I took a planned break" },
] as const;
export type ReasonId = typeof REASONS[number]["id"];

export interface GapInput { reason: ReasonId; from: string; to: string; during: string; role: string }

const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");

export function gapLine(g: GapInput): string {
  const r = REASONS.find((x) => x.id === g.reason)!;
  const when = [clean(g.from), clean(g.to)].filter(Boolean).join(" – ");
  const during = clean(g.during);
  return [r.line, when, during].filter(Boolean).join(" · ");
}

export function gapAnswer(g: GapInput): string {
  const r = REASONS.find((x) => x.id === g.reason)!;
  const from = clean(g.from), to = clean(g.to), during = clean(g.during), role = clean(g.role);
  const when = from && to ? `Between ${from} and ${to}, ` : from ? `From ${from}, ` : "";
  const opener = `${when}${r.answer}.`;
  const middle = during ? ` During that time I ${during.charAt(0).toLowerCase()}${during.slice(1)}.` : "";
  const close = role
    ? ` I'm now ready to commit full-time to a ${role} role, and this one fits what I've been preparing for.`
    : " I'm now ready to commit full-time, and I've kept my skills current for it.";
  return (opener.charAt(0).toUpperCase() + opener.slice(1)) + middle + close;
}

export const GAP_TIPS = [
  "Say it in under 30 seconds, then move to why you fit the job. Interviewers mostly want to know you're ready now.",
  "You never have to share medical or family details. “A health matter, now resolved” is a complete answer.",
  "List anything real you did in the gap: a course, a certificate, a project, volunteering, freelance work.",
  "Use the same dates on your resume, LinkedIn and application forms.",
];
