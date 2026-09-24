import type { AnswerStyle, CodingLanguage, ResponseTiming, ThinkingLevel } from "@orbit/types";

/** "Wait before answering" presets — the server holds a detected question this long (finalizer.GRACE_MS). */
export const RESPONSE_TIMINGS: Array<{ value: ResponseTiming; label: string; hint: string }> = [
  { value: "quick", label: "Quick", hint: "Answer the moment the interviewer pauses" },
  { value: "balanced", label: "Balanced", hint: "Wait ~1.5 s after they stop, in case the question continues" },
  { value: "patient", label: "Patient", hint: "Wait ~3 s — for interviewers who pause mid-question" },
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

/** The answer styles offered in the UI — all spoken, first-person prose. */
export const ANSWER_STYLES: Array<{ value: AnswerStyle; label: string; hint: string }> = [
  { value: "natural", label: "Natural", hint: "Conversational, like a thoughtful person talking" },
  { value: "concise", label: "Concise", hint: "Confident and to the point — the answer first, only essentials" },
  { value: "story", label: "Story", hint: "Walks through a concrete example start to finish" },
];

/** Model thinking effort. Times measured on DeepSeek-V4.1-Flash: seconds before the first word appears. */
export const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string; hint: string }> = [
  { value: "off", label: "Thinking off", hint: "Instant — first words in under a second" },
  { value: "low", label: "Low thinking", hint: "Some reasoning — first words in ~3 s" },
  { value: "high", label: "High thinking", hint: "More reasoning — first words in ~5 s" },
  { value: "max", label: "Max thinking", hint: "Deepest reasoning — first words in ~5–6 s" },
];

const THINKING_KEY = "orbit.thinking";

export function loadThinking(): ThinkingLevel {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(THINKING_KEY) : null;
    return THINKING_LEVELS.some((t) => t.value === raw) ? (raw as ThinkingLevel) : "off";
  } catch {
    return "off";
  }
}

export function saveThinking(level: ThinkingLevel): void {
  try {
    localStorage.setItem(THINKING_KEY, level);
  } catch {
    // storage unavailable — still applies to this session
  }
}

/** Languages offered for coding answers (value = server CodingLanguage). */
export const CODING_LANGUAGES: Array<{ value: CodingLanguage; label: string }> = [
  { value: "python", label: "Python" }, { value: "java", label: "Java" }, { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" }, { value: "cpp", label: "C++" }, { value: "csharp", label: "C#" },
  { value: "go", label: "Go" }, { value: "rust", label: "Rust" }, { value: "sql", label: "SQL" },
];

const CODING_KEY = "orbit.codingLanguage";

export function loadCodingLanguage(): CodingLanguage | undefined {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CODING_KEY) : null;
    return CODING_LANGUAGES.find((l) => l.value === raw)?.value;
  } catch {
    return undefined;
  }
}

export function saveCodingLanguage(lang: CodingLanguage): void {
  try {
    localStorage.setItem(CODING_KEY, lang);
  } catch {
    // storage unavailable — still applies to this session
  }
}
