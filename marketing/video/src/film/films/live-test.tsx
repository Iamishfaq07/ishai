import type { Film, Fmt } from "../engine";
import { IDS, LIVE_HISTORY, liveScript } from "../content";

export function liveTest(fmt: Fmt): Film {
  const vp: [number, number] = fmt.portrait ? [390, 844] : [1280, 800];
  return {
    id: "live-test", fmt, duration: 16, bpm: 110, music: [], captions: [], vo: [], background: "#f5f6f8",
    scenes: [{
      id: "live", from: 0, to: 16,
      frames: [{
        id: "live", path: `/live/${IDS.liveInterview}`, flow: "live", viewport: vp, from: 0, to: 16, historyState: LIVE_HISTORY,
        script: liveScript(1.0),
        layout: () => ({ cx: fmt.w / 2, cy: fmt.h / 2, scale: fmt.portrait ? 2.0 : 1.25 }),
      }],
    }],
  };
}
