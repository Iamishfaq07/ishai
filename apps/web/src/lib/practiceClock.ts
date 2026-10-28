/** Wall-clock deadlines remain accurate when background tabs throttle JavaScript timers. */
export const secondsLeft = (deadline: number, now = Date.now()): number => Math.max(0, Math.ceil((deadline - now) / 1000));
export function discussionPhase(deadline: number, now: number, talkSeconds: number): { phase: "prep" | "talk" | "review"; deadline: number; left: number } {
  if (now < deadline) return { phase: "prep", deadline, left: secondsLeft(deadline, now) };
  const talkEnd = deadline + talkSeconds * 1000;
  return now < talkEnd ? { phase: "talk", deadline: talkEnd, left: secondsLeft(talkEnd, now) } : { phase: "review", deadline: talkEnd, left: 0 };
}
