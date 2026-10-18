import { useEffect, useRef } from "react";

/**
 * Barge-in: the candidate starts talking while the AI interviewer's voice (or read-aloud) is playing. The mic keeps
 * capturing during that playback (its audio just isn't sent), so its level tells us.
 *
 * Her own voice leaks from the speakers into the mic (echo cancellation takes most of it, not all), so it must never
 * count as the candidate (D76: it was stopping Saba a sentence in, which looked like "she doesn't talk"). The echo is
 * learnt from her voice itself: while she's audibly speaking, how much of her output level comes back in the mic
 * (`echo`, a ratio). From then on the mic has to be clearly above what her current level would leak, and above the
 * room's own noise, through most of HOLD_MS (speech dips between syllables and words: a dip up to GAP_MS doesn't end
 * the stretch, and it fires when at least VOICED of the readings in it were over), before it's the candidate. The old
 * way calibrated in the first 300 ms after the line
 * was asked for: with the natural voice that's before any sound has come out (the clip is still on its way), so the
 * "echo floor" was the quiet room and her first loud syllable tripped it.
 */
export interface BargeInState {
  started: number; // when she was asked to speak (ms)
  heardAt: number | null; // when her voice was first actually heard (her output level up)
  floor: number; // the room's noise in the mic, while she's quiet
  echo: number; // mic level per unit of her output level: her voice coming back through the speakers
  above: number | null; // since when the candidate's stretch of speech began (null: none)
  lastAbove: number | null; // the latest reading over the threshold
  over: number; // readings over the threshold in this stretch
  readings: number; // all readings in this stretch
}

export const CALIBRATE_MS = 500; // of her audibly speaking, learning the echo
export const HOLD_MS = 300;
export const GAP_MS = 180; // a dip between syllables or words: still the same stretch of speech
export const VOICED = 0.5; // of the readings in the stretch
// RMS of a quiet but real voice close to a laptop mic (a 5 ms reading). 0.05 missed a soft first syllable and the
// stretch began a few readings late (a real call: she stopped 0.57 s after their voice began, D76).
export const MIN_LEVEL = 0.03;
export const OVER_ECHO = 2.4;
const HEARD = 0.08; // her output level (0..1) that means sound is coming out
const QUIET = 0.03;

export function bargeInStart(now: number): BargeInState {
  return { started: now, heardAt: null, floor: 0.01, echo: 0, above: null, lastAbove: null, over: 0, readings: 0 };
}

/** The mic's level the candidate has to be over now, given her output level now. */
export function bargeInThreshold(state: BargeInState, output: number): number {
  return Math.max(MIN_LEVEL, state.floor * 3, state.echo * output * OVER_ECHO + state.floor);
}

/** One step: the mic's RMS and her output level (0..1, VoiceTap.level) now. */
export function bargeInStep(state: BargeInState, mic: number, output: number, now: number): { state: BargeInState; fired: boolean } {
  let { heardAt, floor, echo } = state;
  if (output < QUIET) floor = mic < floor ? mic : floor + (mic - floor) * 0.02; // the room, between her words
  if (output >= HEARD && heardAt === null) heardAt = now;
  if (heardAt !== null && now - heardAt < CALIBRATE_MS) {
    // Learning her echo: what comes back in the mic for how loud she is.
    if (output >= HEARD) echo = Math.max(echo, (mic - floor) / output);
    return { state: { ...state, heardAt, floor, echo, above: null, lastAbove: null, over: 0, readings: 0 }, fired: false };
  }
  const threshold = bargeInThreshold({ ...state, floor, echo }, output);
  if (mic < threshold) {
    // Keep learning, slowly, while it's clearly her (the volume can change).
    if (output >= HEARD && heardAt !== null) echo = Math.max(echo * 0.998, (mic - floor) / output);
    // A dip between their syllables keeps the stretch; a longer quiet ends it.
    if (state.above !== null && state.lastAbove !== null && now - state.lastAbove <= GAP_MS) {
      return { state: { ...state, heardAt, floor, echo, readings: state.readings + 1 }, fired: false };
    }
    return { state: { ...state, heardAt, floor, echo, above: null, lastAbove: null, over: 0, readings: 0 }, fired: false };
  }
  const above = state.above ?? now;
  const over = (state.above === null ? 0 : state.over) + 1;
  const readings = (state.above === null ? 0 : state.readings) + 1;
  return {
    state: { ...state, heardAt, floor, echo, above, lastAbove: now, over, readings },
    fired: now - above >= HOLD_MS && over / readings >= VOICED,
  };
}

/**
 * Watches the mic level while `active` (the AI is speaking, or about to) and calls `onBargeIn` once when the candidate
 * talks over it. Reads the analyser (web) or an amplitude getter (desktop), and her own output level (`output`),
 * about every 30 ms; nothing runs while inactive.
 */
export function useBargeIn({ active, analyser, amplitude, output, onBargeIn }: {
  active: boolean;
  analyser?: AnalyserNode | undefined;
  amplitude?: (() => number) | undefined;
  /** Her voice's level now, 0..1 (the video room's VoiceTap.level); without it she's taken as speaking throughout. */
  output?: (() => number) | undefined;
  onBargeIn: () => void;
}): void {
  const callback = useRef(onBargeIn);
  callback.current = onBargeIn;
  const outputRef = useRef(output);
  outputRef.current = output;
  useEffect(() => {
    if (!active || (!analyser && !amplitude)) return;
    let state = bargeInStart(performance.now());
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
      // Without her level (read-aloud, the desktop): she's taken as speaking throughout, so the first half second is
      // the echo, as before.
      const out = outputRef.current ? outputRef.current() : 0.5;
      const step = bargeInStep(state, level(), out, performance.now());
      state = step.state;
      if (step.fired) {
        window.clearInterval(timer);
        callback.current();
      }
    }, 30);
    return () => window.clearInterval(timer);
  }, [active, analyser, amplitude]);
}
