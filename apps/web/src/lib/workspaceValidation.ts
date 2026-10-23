import type { SkillRecord } from "../pages/readiness/readiness";
import type { Drive, Marks } from "../pages/campus/campus";
import type { Scores, Weights } from "../pages/jobs/priority";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const numeric = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const nullableNumber = (v: unknown): boolean => v === null || numeric(v);
export function validReadiness(v: unknown): v is SkillRecord[] {
  return Array.isArray(v) && v.every((r) => object(r) && typeof r.skill === "string" && Array.isArray(r.evidence) && r.evidence.every((e: unknown) => object(e) && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) && numeric(e.score) && typeof e.kind === "string" && ["practice", "self", "interview"].includes(e.kind) && typeof e.note === "string"));
}
export function validCampus(v: unknown): v is { marks: Marks; drives: Drive[] } {
  if (!object(v) || !object(v.marks) || !Array.isArray(v.drives)) return false;
  const m = v.marks;
  return typeof m.branch === "string" && [m.cgpa, m.tenth, m.twelfth, m.backlogs].every(nullableNumber) && v.drives.every((d: unknown) => {
    if (!object(d)) return false;
    return [d.id, d.company, d.role, d.date, d.ctc, d.branches].every((x) => typeof x === "string") && [d.minCgpa, d.min10, d.min12, d.maxBacklogs].every(nullableNumber) && strings(d.rounds) && strings(d.done) && [...d.rounds, ...d.done].every((x) => ["aptitude", "coding", "gd", "technical", "hr"].includes(x)) && typeof d.status === "string" && ["upcoming", "applied", "shortlisted", "selected", "not-selected", "skipped"].includes(d.status);
  });
}
export function validPriority(v: unknown): v is { resumeId: string | null; weights: Weights; ratings: Record<string, Scores>; breakers?: string[] } {
  if (!object(v) || !object(v.weights) || !object(v.ratings)) return false;
  return (v.resumeId === null || typeof v.resumeId === "string") && Object.values(v.weights).every(numeric) && Object.values(v.ratings).every((r) => object(r) && Object.values(r).every(nullableNumber)) && (v.breakers === undefined || strings(v.breakers));
}
