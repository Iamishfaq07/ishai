import type { Film, Fmt, FrameSpec } from "../engine";
import { IDS, LIVE_HISTORY, liveScript } from "../content";

// A contact sheet of phone-width screens, to see how each page lays out at 390 px.
export function gallery(fmt: Fmt): Film {
  const pages: Array<Partial<FrameSpec> & { path: string }> = [
    { path: `/resume-ai/${IDS.draft}`, flow: "resume", script: [{ at: 0.2, click: { text: "ATS score" } }] },
    { path: "/linkedin", flow: "linkedin" },
    { path: `/offers/${IDS.offer}`, flow: "offer" },
    { path: `/live/${IDS.liveInterview}`, flow: "live", historyState: LIVE_HISTORY, script: liveScript(0.3, { say: 0.8, answer: 1.2, speak: false }) },
    { path: `/sessions/${IDS.mockReview}` },
    { path: "/jobs/tracker" },
    { path: `/jobs/mission/${IDS.tracker["Kestrel Pay"]}?tab=interview` },
    { path: "/" },
  ];
  const s = 0.56;
  return {
    id: "gallery", fmt, duration: 4, bpm: 100, music: [], captions: [], vo: [], background: "#d9dbe3",
    scenes: [{
      id: "g", from: 0, to: 4,
      frames: pages.map((p, i) => ({
        id: `g${i}`, viewport: [390, 844] as [number, number], from: 0, to: 4, ...p,
        layout: () => ({ cx: 130 + (i % 8) * 237, cy: 540, scale: s, lift: 0.3 }),
      })) as FrameSpec[],
    }],
  };
}
