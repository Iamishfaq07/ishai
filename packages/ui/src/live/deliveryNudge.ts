import type { LiveViewState } from "./reducer";

/**
 * Live delivery nudges for a real interview: a quiet line when the answer you're giving runs long, goes fast or
 * fills up with "um"s, the coaching a speech coach would whisper. Read from your own words as transcribed (the mic's
 * candidate turns since the interviewer last spoke), never sent anywhere. Thresholds as the post-session delivery
 * card's (sessions/delivery.py): a comfortable pace is about 120-160 words a minute.
 */
export type NudgeKind = "long" | "fast" | "fillers";

export interface Nudge {
  kind: NudgeKind;
  text: string;
}

export interface AnswerRun {
  /** The turns of the current answer, in order. */
  turnIds: string[];
  words: number;
  /** First word to last of its finished turns, in ms (0 until two timed turns or one with a length). */
  spanMs: number;
  fillers: number;
}

const LONG_MS = 120_000;
const FAST_WPM = 175;
const MIN_PACE_MS = 20_000; // under this there's too little speech to judge pace
const MIN_FILLERS = 5;
const FILLERS_PER_MIN = 6;
const FILLER = /\b(?:um+|uh+|erm+|uhm+|hmm+|you know|basically)\b/gi;

/** The answer being given: your turns since the interviewer last spoke (echoes of their voice left out). */
export function currentRun(live: Pick<LiveViewState, "turnOrder" | "turns">): AnswerRun | null {
  const ids: string[] = [];
  for (let i = live.turnOrder.length - 1; i >= 0; i--) {
    const id = live.turnOrder[i]!;
    const t = live.turns[id];
    if (!t || t.echo) continue;
    if (t.speaker === "interviewer") break;
    if (t.speaker === "candidate") ids.unshift(id);
  }
  if (!ids.length) return null;
  let words = 0;
  let fillers = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const id of ids) {
    const t = live.turns[id]!;
    words += t.text.split(/\s+/).filter(Boolean).length;
    fillers += t.text.match(FILLER)?.length ?? 0;
    if (t.start_ms !== null) start = start === null ? t.start_ms : Math.min(start, t.start_ms);
    if (t.end_ms !== null) end = end === null ? t.end_ms : Math.max(end, t.end_ms);
  }
  const spanMs = start !== null && end !== null ? Math.max(0, end - start) : 0;
  return { turnIds: ids, words, spanMs, fillers };
}

export function nudgeFor(run: AnswerRun | null): Nudge | null {
  if (!run || run.spanMs <= 0) return null;
  const minutes = run.spanMs / 60_000;
  if (run.spanMs >= LONG_MS) {
    const s = Math.floor(run.spanMs / 1000);
    return { kind: "long", text: `Talking for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}: land your point and stop` };
  }
  const wpm = Math.round(run.words / minutes);
  if (run.spanMs >= MIN_PACE_MS && wpm > FAST_WPM) {
    return { kind: "fast", text: `Speaking fast, about ${wpm} words a minute: slow down a little` };
  }
  if (run.fillers >= MIN_FILLERS && run.fillers / Math.max(minutes, 0.5) > FILLERS_PER_MIN) {
    return { kind: "fillers", text: `${run.fillers} filler words in this answer: pause instead of "um"` };
  }
  return null;
}
