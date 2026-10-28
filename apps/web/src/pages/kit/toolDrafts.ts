import type { BulletParts } from "./bullets";
import { REASONS, type GapInput } from "./gaps";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
export interface BulletDraft extends BulletParts { pasted?: string }
export interface StarDraft { question: string; answer: string }
export const validBulletDraft = (v: unknown): v is BulletDraft => object(v) && text(v.did, 2000) && text(v.result, 2000) && text(v.measure, 1000) && (v.pasted === undefined || text(v.pasted, 4000));
export const validStarDraft = (v: unknown): v is StarDraft => object(v) && text(v.question, 400) && text(v.answer, 20000);
export const validGapDraft = (v: unknown): v is GapInput => object(v) && REASONS.some((r) => r.id === v.reason) && text(v.from, 100) && text(v.to, 100) && text(v.during, 2000) && text(v.role, 200);
