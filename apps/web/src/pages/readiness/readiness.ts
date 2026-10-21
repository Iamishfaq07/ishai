/**
 * Skill readiness (the evidence-backed readiness model InterviewOS uses): each skill's readiness is the decayed
 * average of the evidence the candidate logs (a practice answer, a self-check, a real interview), with a confidence
 * that grows with fresh evidence. The prep plan orders skills by how many target jobs ask for them times how far from
 * ready they are, so weak, in-demand skills come back first. Evidence is the candidate's own rating; nothing is
 * inferred about them.
 */

export type EvidenceKind = "practice" | "self" | "interview";
export interface Evidence { at: string; score: number; kind: EvidenceKind; note: string }
export interface SkillRecord { skill: string; evidence: Evidence[] }

export const KINDS: { id: EvidenceKind; label: string; weight: number }[] = [
  { id: "interview", label: "Real interview", weight: 1.5 },
  { id: "practice", label: "Practice answer", weight: 1 },
  { id: "self", label: "Self-check", weight: 0.6 },
];

export const HALF_LIFE_DAYS = 30;
const DAY = 86_400_000;

/** Readiness 1–5 (null with no evidence) and confidence 0–1: evidence halves in weight every 30 days. */
export function readiness(evidence: Evidence[], now = Date.now()): { value: number | null; confidence: number } {
  let sum = 0, weight = 0;
  for (const e of evidence) {
    const age = Math.max(0, (now - Date.parse(e.at)) / DAY);
    const w = (KINDS.find((k) => k.id === e.kind)?.weight ?? 1) * 0.5 ** (age / HALF_LIFE_DAYS);
    sum += e.score * w; weight += w;
  }
  if (!weight) return { value: null, confidence: 0 };
  return { value: Math.round((sum / weight) * 10) / 10, confidence: Math.min(1, Math.round((weight / 3) * 100) / 100) };
}

/** Change against the readiness 30 days ago (null when there was nothing then). */
export function trend(evidence: Evidence[], now = Date.now()): number | null {
  const then = now - HALF_LIFE_DAYS * DAY;
  const before = readiness(evidence.filter((e) => Date.parse(e.at) <= then), then).value;
  const today = readiness(evidence, now).value;
  return before === null || today === null ? null : Math.round((today - before) * 10) / 10;
}

export type Action = "rate" | "learn" | "practise" | "retest" | "keep";

/** What to do next for a skill, and how urgent it is (higher first). */
export function nextStep(value: number | null, confidence: number, demand: number, maxDemand: number): { action: Action; priority: number } {
  const importance = maxDemand ? 0.4 + (0.6 * demand) / maxDemand : 1;
  if (value === null) return { action: "rate", priority: importance * 1.1 };
  const gap = (5 - value) / 4; // 0 ready … 1 not at all
  const unsure = 1 - confidence;
  const priority = importance * (0.75 * gap + 0.25 * unsure);
  const action: Action = value < 2.5 ? "learn" : value < 4 ? "practise" : confidence < 0.5 ? "retest" : "keep";
  return { action, priority: Math.round(priority * 100) / 100 };
}

export const ACTIONS: Record<Action, { label: string; to: string; cta: string }> = {
  rate: { label: "Not rated yet: answer one question on it and rate yourself", to: "/warmup", cta: "Quick warm-up" },
  learn: { label: "Build the basics before practising answers", to: "/learn", cta: "Learning" },
  practise: { label: "Practise answering out loud, then log how it went", to: "/mock", cta: "Mock interview" },
  retest: { label: "Looks good but evidence is old or thin: retest it", to: "/warmup", cta: "Retest" },
  keep: { label: "Ready. A quick retest in a couple of weeks keeps it fresh", to: "/warmup", cta: "Warm-up" },
};
