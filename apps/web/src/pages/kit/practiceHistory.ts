import type { Section } from "../aptitude/questions";
export interface AptitudeAttempt { at: string; score: number; total: number; sections: Section[] }
export interface DiscussionAttempt { at: string; topic: string; ticks: number }
export const NO_APTITUDE_HISTORY: AptitudeAttempt[] = [];
export const NO_DISCUSSION_HISTORY: DiscussionAttempt[] = [];
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
export const validAptitudeHistory = (v: unknown): v is AptitudeAttempt[] => Array.isArray(v) && v.length <= 10 && v.every((a: unknown) => object(a) && date(a.at) && Number.isInteger(a.score) && Number.isInteger(a.total) && Number(a.total) > 0 && Number(a.total) <= 100 && Number(a.score) >= 0 && Number(a.score) <= Number(a.total) && Array.isArray(a.sections) && a.sections.length > 0 && a.sections.length <= 3 && a.sections.every((s: unknown) => ["quant", "logical", "verbal"].includes(String(s))));
export const validDiscussionHistory = (v: unknown): v is DiscussionAttempt[] => Array.isArray(v) && v.length <= 8 && v.every((a: unknown) => object(a) && date(a.at) && typeof a.topic === "string" && a.topic.length <= 300 && Number.isInteger(a.ticks) && Number(a.ticks) >= 0 && Number(a.ticks) <= 20);
export interface ScoreAttempt { at: string; score: number }
export const NO_SCORE_HISTORY: ScoreAttempt[] = [];
/** A list of recent overall scores (0 to 100): the communication test and the written round. */
export const validScoreHistory = (v: unknown): v is ScoreAttempt[] => Array.isArray(v) && v.length <= 10 && v.every((a: unknown) => object(a) && date(a.at) && Number.isInteger(a.score) && Number(a.score) >= 0 && Number(a.score) <= 100);
