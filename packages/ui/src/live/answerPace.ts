import type { LiveViewState } from "./reducer";

/**
 * The mock interview's answer timer: how long an answer to this kind of question usually runs, and where the one
 * being given is against that. Advice, never a cut-off: the interviewer still waits for the pause.
 */
export interface AnswerBand {
  /** Seconds: under this, the answer is probably thin. */
  min: number;
  /** Seconds: past this, wrap up with the result. */
  max: number;
}

export type PaceState = "warming" | "good" | "long";

type MockQuestion = NonNullable<LiveViewState["mock"]>;

/** A full answer runs 45 s to 2 min (a STAR story fits); a follow-up is shorter; the "short version" drill is ~30 s. */
export function answerBand(q: Pick<MockQuestion, "isFollowUp" | "drillKind">): AnswerBand {
  if (q.drillKind === "concise") return { min: 20, max: 45 };
  if (q.isFollowUp || q.drillKind === "follow_up") return { min: 20, max: 90 };
  return { min: 45, max: 120 };
}

export function paceState(elapsedS: number, band: AnswerBand): PaceState {
  if (elapsedS < band.min) return "warming";
  return elapsedS <= band.max ? "good" : "long";
}

/** 75 -> "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The band as said aloud: "0:45–2:00". */
export function bandLabel(band: AnswerBand): string {
  return `${clock(band.min)}–${clock(band.max)}`;
}

/** Words the candidate has said in the turns from `from` on (the turns since the question), echoes left out. */
export function answerWords(live: Pick<LiveViewState, "turnOrder" | "turns">, from: number): number {
  let words = 0;
  for (const id of live.turnOrder.slice(from)) {
    const t = live.turns[id];
    if (!t || t.speaker !== "candidate" || t.echo) continue;
    words += t.text.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

/** An answered question's length in the review: under 20 s is thin, over 2 min runs long (the full answer's band). */
export function reviewLength(seconds: number): "short" | "long" | null {
  if (seconds < 20) return "short";
  return seconds > answerBand({ isFollowUp: false, drillKind: null }).max ? "long" : null;
}
