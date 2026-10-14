import { useEffect, useRef } from "react";

/**
 * Barge-in: the candidate starts talking while the AI interviewer's voice (or read-aloud) is playing. The mic keeps
 * capturing during that playback (its audio just isn't sent), so its level tells us. The interviewer's own voice can
 * leak from the speakers into the mic, so the first stretch of playback is measured as the echo floor, and only speech
 * clearly louder than it, held for a moment, counts.
 */
export interface BargeInState {
  started: number; // when playback started (ms)
  floor: number; // the loudest level heard during the calibration window: the echo
  above: number | null; // since when the level has been over the threshold
}

export const CALIBRATE_MS = 300;
export const HOLD_MS = 120;
export const MIN_LEVEL = 0.04; // RMS of a quiet but real voice close to a laptop mic
export const OVER_ECHO = 2.2;

export function bargeInStep(state: BargeInState, level: number, now: number): { state: BargeInState; fired: boolean } {
  if (now - state.started < CALIBRATE_MS) {
    return { state: { ...state, floor: Math.max(state.floor, level), above: null }, fired: false };
  }
  const threshold = Math.max(MIN_LEVEL, state.floor * OVER_ECHO);
  if (level < threshold) return { state: { ...state, above: null }, fired: false };
  const above = state.above ?? now;
  return { state: { ...state, above }, fired: now - above >= HOLD_MS };
}

/**
 * Watches the mic level while `active` (the AI is speaking) and calls `onBargeIn` once when the candidate talks over
 * it. Reads the analyser (web) or an amplitude getter (desktop) about every 30 ms; nothing runs while inactive.
 */
export function useBargeIn({ active, analyser, amplitude, onBargeIn }: {
  active: boolean;
  analyser?: AnalyserNode;
  amplitude?: () => number;
  onBargeIn: () => void;
}): void {
  const callback = useRef(onBargeIn);
  callback.current = onBargeIn;
  useEffect(() => {
    if (!active || (!analyser && !amplitude)) return;
    let state: BargeInState = { started: performance.now(), floor: 0, above: null };
    let wave = analyser ? new Float32Array(analyser.fftSize) : null;
    const level = (): number => {
      if (analyser && wave) {
        if (wave.length !== analyser.fftSize) wave = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(wave);
        let sum = 0;
        for (const v of wave) sum += v * v;
        return Math.sqrt(sum / wave.length);
      }
      return amplitude?.() ?? 0;
    };
    const timer = window.setInterval(() => {
      const step = bargeInStep(state, level(), performance.now());
      state = step.state;
      if (step.fired) {
        window.clearInterval(timer);
        callback.current();
      }
    }, 30);
    return () => window.clearInterval(timer);
  }, [active, analyser, amplitude]);
}
