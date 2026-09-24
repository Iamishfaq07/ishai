import type { ResponseTiming } from "@orbit/types";

/** "Wait before answering" presets — the server holds a detected question this long (finalizer.GRACE_MS). */
export const RESPONSE_TIMINGS: Array<{ value: ResponseTiming; label: string; hint: string }> = [
  { value: "quick", label: "Quick", hint: "Answer the moment the interviewer pauses" },
  { value: "balanced", label: "Balanced", hint: "Wait ~1 s after they stop, in case the question continues" },
  { value: "patient", label: "Patient", hint: "Wait ~2 s — for interviewers who pause mid-question" },
];

const STORAGE_KEY = "orbit.responseTiming";

/** A per-device preference (not per session): how someone likes to be answered doesn't change per call. */
export function loadResponseTiming(): ResponseTiming {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return RESPONSE_TIMINGS.some((t) => t.value === raw) ? (raw as ResponseTiming) : "balanced";
  } catch {
    return "balanced";
  }
}

export function saveResponseTiming(timing: ResponseTiming): void {
  try {
    localStorage.setItem(STORAGE_KEY, timing);
  } catch {
    // storage unavailable (private mode) — the choice still applies to this session
  }
}
