import type { JobTrackerEntry, ResumeExperience } from "@orbit/types";

/**
 * Apply-priority scorecard (the job-evaluation pattern open-source job-search agents such as career-ops use: score
 * each saved job on a few dimensions, 1.0–5.0, grade it A–F, apply to the top of the list first). Three dimensions
 * are read from records (resume keywords against the saved job post, the title's level against the resume's years,
 * and how fresh the post is); the rest the candidate rates. Nothing here decides for the candidate.
 */

export const DIMENSIONS = [
  { id: "match", label: "Resume match", auto: true, hint: "Keywords in the saved job post that your resume shows" },
  { id: "level", label: "Level fit", auto: true, hint: "The title's seniority against the years on your resume" },
  { id: "fresh", label: "Freshness", auto: true, hint: "How recently it was posted, and whether it's still listed" },
  { id: "interest", label: "Interest", auto: false, hint: "How much you want this job" },
  { id: "pay", label: "Pay", auto: false, hint: "What you know or expect it pays, against what you need" },
  { id: "place", label: "Location & work mode", auto: false, hint: "Commute, remote or relocation" },
  { id: "growth", label: "Growth & learning", auto: false, hint: "What you'd learn and where it leads" },
] as const;
export type Dimension = typeof DIMENSIONS[number]["id"];
export type Weights = Record<Dimension, number>;
export const DEFAULT_WEIGHTS: Weights = { match: 5, level: 3, fresh: 2, interest: 4, pay: 3, place: 3, growth: 3 };

/** Seniority bands: the years of experience a title usually asks for. */
const BANDS = [
  { re: /\b(?:intern|internship|trainee|apprentice)\b/i, min: 0, max: 1 },
  { re: /\b(?:head|director|vp|vice president|principal|chief)\b/i, min: 10, max: 40 },
  { re: /\b(?:staff|lead|architect|manager)\b/i, min: 7, max: 40 },
  { re: /\b(?:senior|sr\.?)\b/i, min: 4, max: 12 },
  { re: /\b(?:junior|jr\.?|associate|graduate|fresher|entry[- ]level)\b/i, min: 0, max: 2 },
];
const MID = { min: 2, max: 6 };

export function bandOf(title: string): { min: number; max: number } {
  return BANDS.find((b) => b.re.test(title)) ?? MID;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A resume date ("Jan 2022", "2022-01", "01/2022", "2022") as months since year 0; null when it has no year. */
export function monthOf(text: string): number | null {
  const t = text.trim().toLowerCase();
  const year = /\b(19|20)\d{2}\b/.exec(t);
  if (!year) return null;
  const named = MONTHS.findIndex((m) => t.includes(m));
  const numeric = /\b(\d{4})[-/.](\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})[-/.](\d{4})\b/.exec(t);
  let month = named >= 0 ? named : 0;
  if (named < 0 && numeric) {
    const m = Number(numeric[1]!.length === 4 ? numeric[2] : numeric[1]);
    if (m >= 1 && m <= 12) month = m - 1;
  }
  return Number(year[0]) * 12 + month;
}

/** Years of work on the resume: the months its roles cover, overlaps counted once. null when no role has dates. */
export function yearsOfExperience(roles: Pick<ResumeExperience, "start" | "end" | "current">[], now = new Date()): number | null {
  const today = now.getFullYear() * 12 + now.getMonth();
  const spans = roles.flatMap((r) => {
    const from = monthOf(r.start);
    const to = r.current || /present|current|now/i.test(r.end) ? today : monthOf(r.end);
    return from !== null && to !== null && to >= from ? [[from, to] as const] : [];
  }).sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let months = 0, start = spans[0]![0], end = spans[0]![1];
  for (const [a, b] of spans.slice(1)) {
    if (a > end) { months += end - start; start = a; end = b; } else end = Math.max(end, b);
  }
  months += end - start;
  return Math.round((months / 12) * 10) / 10;
}

/** 5 inside the title's band, 3 a couple of years either side, 1 further off. */
export function levelScore(title: string, years: number | null): number | null {
  if (years === null) return null;
  const { min, max } = bandOf(title);
  if (years >= min && years <= max) return 5;
  const off = years < min ? min - years : years - max;
  return off <= 2 ? 3 : 1;
}

export function freshScore(entry: Pick<JobTrackerEntry, "posted_at" | "live">, now = Date.now()): number | null {
  if (!entry.live) return 1;
  if (!entry.posted_at) return null;
  const days = (now - Date.parse(entry.posted_at)) / 86_400_000;
  if (Number.isNaN(days)) return null;
  return days <= 7 ? 5 : days <= 14 ? 4 : days <= 30 ? 3 : days <= 60 ? 2 : 1;
}

/** Share of the post's keywords the resume shows, as 1–5. */
export function matchScore(matched: number, missing: number): number | null {
  const total = matched + missing;
  return total ? Math.round((1 + (4 * matched) / total) * 10) / 10 : null;
}

export type Scores = Partial<Record<Dimension, number | null>>;

export function grade(score: number): "A" | "B" | "C" | "D" | "F" {
  return score >= 4.2 ? "A" : score >= 3.6 ? "B" : score >= 3 ? "C" : score >= 2.4 ? "D" : "F";
}

export const ADVICE: Record<ReturnType<typeof grade>, string> = {
  A: "Apply this week, with a tailored resume.",
  B: "Worth applying; tailor first.",
  C: "Apply if you have time, or close a gap first.",
  D: "Park it unless something changes.",
  F: "Probably skip.",
};

/** One job's score: the candidate's ratings win over what's read from records; anything unknown counts as 3. */
export function scoreJob(auto: Scores, ratings: Scores, weights: Weights) {
  const total = DIMENSIONS.reduce((n, d) => n + weights[d.id], 0) || 1;
  const parts = DIMENSIONS.map((d) => {
    const rated = ratings[d.id];
    const read = auto[d.id];
    const value = rated ?? read ?? null;
    return { id: d.id, label: d.label, value, known: value !== null, from: rated != null ? "you" as const : read != null ? "records" as const : null };
  });
  const score = parts.reduce((n, p) => n + (p.value ?? 3) * weights[p.id], 0) / total;
  const rounded = Math.round(score * 10) / 10;
  const weighted = parts.filter((p) => p.known && weights[p.id] >= 3);
  const strongest = [...weighted].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const weakest = [...weighted].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
  return { score: rounded, grade: grade(rounded), parts, strongest, weakest, unknown: parts.filter((p) => !p.known).length };
}
