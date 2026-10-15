import type { LinkedInCheck } from "@orbit/types";

export const LINKEDIN_HOME = "/linkedin";

export const SECTIONS: Array<{ id: LinkedInCheck["section"]; label: string }> = [
  { id: "headline", label: "Headline" },
  { id: "about", label: "About" },
  { id: "experience", label: "Experience" },
  { id: "skills", label: "Skills" },
  { id: "keywords", label: "Keywords" },
  { id: "extras", label: "Education, certifications and URL" },
];

/** Each section's points out of its maximum, in the audit's order, for the section bars. */
export function sectionScores(checks: LinkedInCheck[]): Array<{ id: LinkedInCheck["section"]; label: string; points: number; max: number; todo: number }> {
  return SECTIONS.map(({ id, label }) => {
    const mine = checks.filter((c) => c.section === id);
    return { id, label, points: mine.reduce((n, c) => n + c.points, 0), max: mine.reduce((n, c) => n + c.max, 0), todo: mine.filter((c) => !c.ok).length };
  }).filter((s) => s.max > 0);
}

/** The fixes worth most first: what each failing check would add if done. */
export function topFixes(checks: LinkedInCheck[], n = 3): LinkedInCheck[] {
  return checks.filter((c) => !c.ok).sort((a, b) => b.max - b.points - (a.max - a.points)).slice(0, n);
}

export function scoreWord(score: number): string {
  return score >= 85 ? "Strong" : score >= 65 ? "Good" : score >= 40 ? "Needs work" : "Thin";
}

/** What Resume AI's LinkedIn writer gets as the "job": the target role and the skills employers ask for. */
export function rewriteBrief(role: string, keywords: string[]): string {
  return [role, keywords.length ? `Skills employers ask for: ${keywords.join(", ")}` : ""].filter(Boolean).join("\n\n");
}
