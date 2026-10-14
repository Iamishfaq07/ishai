/**
 * The 404 page's best guess at where a broken address was heading, from its first path segment: an old practice
 * link goes to practice, a job link to the matches, and so on. Null when the address gives nothing to go on.
 */
export interface Recovery {
  label: string;
  to: string;
}

const RULES: Array<[RegExp, Recovery]> = [
  [/^(practice|practise|mock|mocks|warmup)$/, { label: "Start a practice interview", to: "/mock" }],
  [/^(jobs?|careers?|matches|openings)$/, { label: "Explore matching roles in Jobs AI", to: "/jobs/matches" }],
  [/^(resumes?|resume-ai|resume-maker|cv|ats)$/, { label: "Open Resume AI", to: "/resume-ai" }],
  [/^(sessions?|live|history|transcripts?)$/, { label: "Open your sessions", to: "/sessions" }],
  [/^(start|copilot|interview|interviews|new)$/, { label: "Start a live interview session", to: "/start" }],
  [/^(docs?|documents?|stories|answers)$/, { label: "Open your documents", to: "/documents" }],
  [/^(billing|pricing|plans?|credits|upgrade|checkout)$/, { label: "See plans and credits", to: "/billing" }],
  [/^(settings|account|profile)$/, { label: "Open settings", to: "/settings" }],
  [/^(help|support|contact|feedback)$/, { label: "Contact Orbit", to: "/contact" }],
];

export function recoveryFor(pathname: string): Recovery | null {
  const first = pathname.toLowerCase().split("/").filter(Boolean)[0] ?? "";
  for (const [pattern, recovery] of RULES) if (pattern.test(first)) return recovery;
  return null;
}
