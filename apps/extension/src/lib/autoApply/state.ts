// What auto-apply keeps in the extension's own storage (chrome.storage.local), shared by the service worker and the
// popup. Packets are kept only for "Needs you" hand-offs, and only for a week.
import type { ApplicationPacket, ApplyReason, ApplyStatus, ApplyStatusValue, UnknownQuestion } from "./contract";

export interface AutoApplySettings {
  /** The candidate turned auto-apply on (and granted the ATS sites). */
  enabled: boolean;
  /** Unused: pausing is Orbit's own switch (POST /v1/apply/pause), the same in the web app and the popup. Kept so an
   * older stored value reads cleanly. */
  paused: boolean;
}

export interface HistoryItem {
  id: string;
  company: string;
  title: string;
  url: string;
  ats: string;
  status: ApplyStatusValue;
  reason: ApplyReason | null;
  unknown: UnknownQuestion[];
  finalUrl: string | null;
  at: number;
  /** Orbit's own note on how it ended (e.g. which check stopped it). */
  detail?: string;
  /** A "Needs you" item the candidate has since opened or dismissed. */
  handled?: boolean;
}

export interface CurrentRun {
  id: string;
  company: string;
  title: string;
  url?: string;
  ats?: string;
  tabId: number | null;
  windowId: number | null;
  startedAt: number;
  /** When the form's submit button was pressed (set just before). */
  submitAt?: number;
}

export interface Handoff {
  packet: ApplicationPacket;
  reason: ApplyReason | null;
  savedAt: number;
}

export const KEYS = {
  settings: "autoApply",
  history: "autoApplyHistory",
  current: "autoApplyCurrent",
  status: "autoApplyStatus",
  handoffs: "autoApplyHandoffs",
  backoff: "autoApplyBackoff",
  outbox: "autoApplyOutbox",
  /** Packets whose submit was pressed by a service worker that then stopped. */
  recovered: "autoApplyRecovered",
  lastError: "autoApplyLastError",
  /** No new application before this time: a person's gap between applications. */
  nextAllowed: "autoApplyNextAllowed",
} as const;

export const HISTORY_MAX = 20;
export const HANDOFF_TTL_MS = 7 * 24 * 3600_000;

export interface StoredStatus extends ApplyStatus {
  fetchedAt: number;
}

export async function getSettings(): Promise<AutoApplySettings> {
  const { [KEYS.settings]: s } = await chrome.storage.local.get([KEYS.settings]);
  const v = (s ?? {}) as Partial<AutoApplySettings>;
  return { enabled: !!v.enabled, paused: !!v.paused };
}

export async function setSettings(patch: Partial<AutoApplySettings>): Promise<AutoApplySettings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function getHistory(): Promise<HistoryItem[]> {
  const { [KEYS.history]: h } = await chrome.storage.local.get([KEYS.history]);
  return Array.isArray(h) ? (h as HistoryItem[]) : [];
}

export async function getHandoffs(): Promise<Record<string, Handoff>> {
  const { [KEYS.handoffs]: h } = await chrome.storage.local.get([KEYS.handoffs]);
  const all = (h && typeof h === "object" ? h : {}) as Record<string, Handoff>;
  const now = Date.now();
  return Object.fromEntries(Object.entries(all).filter(([, v]) => now - v.savedAt < HANDOFF_TTL_MS));
}

/** Messages from the popup to the service worker. */
export type AutoApplyMessage =
  | { type: "autoApply:changed" }
  | { type: "autoApply:handoff"; id: string }
  | { type: "autoApply:dismiss"; id: string }
  | { type: "autoApply:refresh" };
