import type { LinkedInCheck, LinkedInPart, LinkedInRead, LinkedInSectionScore, LinkedInState, LinkedInSuggestion, ResumeAiAllowance } from "@orbit/types";
import { KIT_SHOWN_FIRST, shownFirst } from "@orbit/ui";

export const LINKEDIN_HOME = "/linkedin";

/** What a recruiter's search shows of the headline, and the About before "see more" (the server's audit uses these). */
export const HEADLINE_SHOWN = KIT_SHOWN_FIRST.headline;
export const ABOUT_SHOWN = KIT_SHOWN_FIRST.about;

/** The parts the AI writes (a single resume fix each); the others are worked out without AI, free. */
export const AI_PARTS: ReadonlySet<LinkedInPart> = new Set<LinkedInPart>(["headline", "about", "experience", "featured", "recommendation"]);

export const PART_LABEL: Record<LinkedInPart, string> = {
  headline: "Headline",
  about: "About",
  experience: "Experience",
  skills: "Skills",
  url: "Custom URL",
  featured: "Featured",
  photo: "Photo and background",
  recommendation: "Recommendation request",
  open_to_work: "Open to work",
};

/** Which section of the score a suggestion's part lands in (to flash its bar when it's applied). */
export const PART_SECTION: Partial<Record<LinkedInPart, LinkedInSectionScore["id"]>> = {
  headline: "headline",
  about: "about",
  experience: "experience",
  skills: "skills",
  url: "url",
  featured: "featured",
  photo: "photo",
};

/** Each section's points, from the server; an older server sent only checks, so they're added up here. */
export function sections(state: LinkedInState): LinkedInSectionScore[] {
  const a = state.audit;
  if (!a) return [];
  if (a.sections?.length) return a.sections;
  const ids = [...new Set(a.checks.map((c) => c.section))];
  return ids.map((id) => {
    const mine = a.checks.filter((c) => c.section === id && c.known !== false);
    return { id, label: id[0]!.toUpperCase() + id.slice(1), points: mine.reduce((n, c) => n + c.points, 0), max: mine.reduce((n, c) => n + c.max, 0), known: mine.length > 0, roles: [] };
  });
}

/** The fixes worth most first: what each failing check would add if done. */
export function topFixes(checks: LinkedInCheck[], n = 3): LinkedInCheck[] {
  const worth = (c: LinkedInCheck) => c.gain ?? c.max - c.points;
  return checks.filter((c) => !c.ok && c.known !== false).sort((a, b) => worth(b) - worth(a)).slice(0, n);
}

export function scoreWord(score: number): string {
  return score >= 85 ? "Strong" : score >= 65 ? "Good" : score >= 40 ? "Needs work" : "Thin";
}

/** The profile's address when `text` is a LinkedIn profile link ("linkedin.com/in/asha-rao", with or without https). */
export function profileUrl(text: string): string | null {
  const m = text.trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/i);
  return m ? `https://www.linkedin.com/in/${m[1]}/` : null;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** How a recruiter's search result shows the profile: the headline cut where search cuts it, the current role. */
export function searchPreview(p: LinkedInRead): { name: string; initials: string; headline: string; cut: boolean; location: string; current: string } {
  const first = shownFirst(p.headline, HEADLINE_SHOWN);
  const role = p.experience.find((r) => r.current) ?? null;
  return {
    name: p.name || "Your name",
    initials: initials(p.name),
    headline: first || p.headline,
    cut: Boolean(first),
    location: p.location,
    current: role ? [role.title, role.company].filter(Boolean).join(" at ") : "",
  };
}

/** The About as it shows before "see more" (all of it when it fits). */
export function aboutPreview(about: string): { shown: string; cut: boolean } {
  const flat = about.replace(/\s*\n+\s*/g, " ").trim();
  const first = shownFirst(flat, ABOUT_SHOWN);
  return { shown: first || flat, cut: Boolean(first) };
}

/** The text a suggestion would paste: the option picked, for a headline or a URL. */
export function chosenText(s: LinkedInSuggestion): string {
  return s.options.length && (s.part === "headline" || s.part === "url") ? (s.options[Math.min(s.choice, s.options.length - 1)]?.text ?? s.after) : s.after;
}

/** The newest suggestion for a part (the server keeps them newest first). */
export function latestFor(list: LinkedInSuggestion[] | undefined, part: LinkedInPart): LinkedInSuggestion | undefined {
  return (list ?? []).find((s) => s.part === part);
}

/** "Copy all": the new headline, About and skills, labelled, to paste one at a time. */
export function copyAll(state: LinkedInState): string {
  const p = state.profile;
  if (!p) return "";
  const list = state.suggestions ?? [];
  const headline = latestFor(list, "headline");
  const about = latestFor(list, "about");
  const skills = latestFor(list, "skills");
  return [
    `Headline\n${headline ? chosenText(headline) : p.headline}`,
    `About\n${about ? about.after : p.about}`,
    `Skills\n${(skills ? skills.items : p.skills).join(", ")}`,
  ].join("\n\n");
}

/** "3 of 7 fixes done on LinkedIn", or nothing yet. */
export function progressText(done: number, total: number): string {
  return total ? `${done} of ${total} fix${total === 1 ? "" : "es"} done on LinkedIn` : "";
}

/** The character counter's state against LinkedIn's limit: amber in the last tenth, rose over it. */
export function charState(length: number, limit: number): "ok" | "near" | "over" {
  if (!limit) return "ok";
  return length > limit ? "over" : length > limit * 0.9 ? "near" : "ok";
}

/** What one fix costs right now, said before it's spent. */
export function fixCost(allowance: ResumeAiAllowance | null, part: LinkedInPart | "rewrite"): string {
  if (part !== "rewrite" && !AI_PARTS.has(part)) return "Free: worked out without AI.";
  if (!allowance) return part === "rewrite" ? "Uses 1 resume credit." : "Uses a fraction of a resume credit.";
  if (allowance.unlimited) return "Included in your plan.";
  const per = Math.max(1, allowance.fixes_per_credit ?? 1);
  if (part === "rewrite") {
    return allowance.credits_left > 0 ? `Uses 1 resume credit. You have ${allowance.credits_left}.` : "Uses 1 resume credit. You're out of credits.";
  }
  const left = (allowance.fixes_left ?? 0) + allowance.credits_left * per;
  if (left <= 0) return "You're out of resume credits. The free fixes still work.";
  return `Uses 1/${per} of a resume credit. You have ${left} fix${left === 1 ? "" : "es"} left.`;
}

/** Placeholders ("[X%]") in a text: the user's own figures to put in before pasting. */
export function placeholders(text: string): string[] {
  return text.match(/\[[^\]\n]{1,24}\]/g) ?? [];
}
