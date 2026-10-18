import type { Film, Fmt } from "../engine";
import { ep, keys, out3, inOut } from "../anim";

// A pipeline check: one app frame, pushed in, with a title over it.
export function testFilm(fmt: Fmt): Film {
  const vp: [number, number] = fmt.portrait ? [390, 844] : [1280, 800];
  return {
    id: "test",
    fmt,
    duration: 4,
    bpm: 110,
    music: [{ name: "intro", t: 0 }],
    captions: [],
    vo: [],
    background: "#f5f6f8",
    scenes: [
      {
        id: "matches",
        from: 0,
        to: 4,
        frames: [
          {
            id: "m",
            path: "/jobs/matches",
            viewport: vp,
            from: 0,
            to: 4,
            bar: !fmt.portrait,
            layout: (t) => ({
              cx: fmt.w / 2,
              cy: fmt.h / 2 + keys(t, [[0, 60], [1.2, 0, out3]]),
              scale: keys(t, [[0, fmt.portrait ? 1.9 : 1.05], [4, fmt.portrait ? 2.05 : 1.16, inOut]]),
              opacity: ep(t, 0, 0.6),
              rx: keys(t, [[0, 10], [1.4, 0, out3]]),
            }),
          },
        ],
        render: (t) => (
          <div className="abs" style={{ left: 0, right: 0, top: 40, textAlign: "center", zIndex: 30, opacity: ep(t, 0.4, 1.2) }}>
            <span style={{ font: "600 44px/1 'IBM Plex Sans Variable'", letterSpacing: "-0.02em" }}>Jobs that fit you</span>
          </div>
        ),
      },
    ],
  };
}
