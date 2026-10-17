import { useEffect, useState, type RefObject } from "react";
import { TALK_START, follow, rms, talkStep, voiceLevel } from "../live/audioLevel";

const FRAME_MS = 33; // ~30 a second: plenty for a ring and a talking state

/**
 * The candidate's voice on the mic, for the video room. Returns whether they're talking (with hysteresis, so it
 * doesn't flicker between words; React re-renders only when it changes). On `levelRef`'s element it keeps a `--level`
 * CSS variable (0..1, quick up, slower down, nothing for room noise) and a `data-talking` attribute, which the camera
 * tile's speaking ring draws from (base.css `.speak-ring`). One loop at ~30 a second (`every` ms: the still meter at
 * motion Off steps a few times a second) that stops while the tab is hidden; nothing runs without an analyser or
 * while `enabled` is false.
 */
export function useMicActivity(
  analyser: AnalyserNode | undefined,
  { enabled = true, levelRef, every = FRAME_MS }: { enabled?: boolean; levelRef?: RefObject<HTMLElement | null>; every?: number | undefined } = {},
): boolean {
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    const el = levelRef?.current ?? null;
    const reset = () => {
      el?.style.setProperty("--level", "0");
      el?.removeAttribute("data-talking");
    };
    if (!analyser || !enabled) {
      reset();
      setTalking(false);
      return;
    }
    let wave = new Float32Array(analyser.fftSize);
    let state = TALK_START;
    let shown = 0;
    let written = -1;
    let last = 0;
    let raf = 0;
    const micFrame = (now: number) => {
      // A hidden tab: stop until it's back (browsers pause frames there anyway; this doesn't rely on it).
      if (document.hidden) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(micFrame);
      const dt = now - last;
      if (dt < every - 1) return;
      last = now;
      if (wave.length !== analyser.fftSize) wave = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(wave);
      const r = rms(wave);
      const before = state.talking;
      state = talkStep(state, r, now, Math.min(dt, 250));
      if (state.talking !== before) {
        setTalking(state.talking);
        if (state.talking) el?.setAttribute("data-talking", "");
        else el?.removeAttribute("data-talking");
      }
      const voiced = r > Math.max(0.02, state.floor + 0.02);
      shown = every > FRAME_MS ? (voiced ? voiceLevel(r) : 0) : follow(shown, voiced ? voiceLevel(r) : 0, Math.min(dt, 100), 40, 260);
      const rounded = Math.round(shown * 50) / 50;
      if (rounded !== written) {
        written = rounded;
        el?.style.setProperty("--level", String(rounded));
      }
    };
    const onVisibility = () => {
      if (!document.hidden && !raf) raf = requestAnimationFrame(micFrame);
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(micFrame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      reset();
    };
  }, [analyser, enabled, levelRef, every]);
  return enabled && talking;
}
