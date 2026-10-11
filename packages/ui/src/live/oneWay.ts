/**
 * A one-way (recorded, HireVue-style) interview's clock for one prompt: thinking time, then a fixed time to answer.
 * It runs from when the prompt appears (the question is read aloud during the thinking time, as on those platforms).
 */
export interface OneWayPhase {
  phase: "think" | "answer" | "over";
  /** Seconds left in this phase. */
  left: number;
  /** 0..1 through this phase. */
  progress: number;
}

export function oneWayPhase(elapsedS: number, thinkS: number, answerS: number): OneWayPhase {
  const t = Math.max(0, elapsedS);
  if (t < thinkS) return { phase: "think", left: Math.ceil(thinkS - t), progress: thinkS ? t / thinkS : 1 };
  const a = t - thinkS;
  if (a < answerS) return { phase: "answer", left: Math.ceil(answerS - a), progress: a / answerS };
  return { phase: "over", left: 0, progress: 1 };
}
