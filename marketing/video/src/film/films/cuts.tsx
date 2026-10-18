// The launch film's 30 s and 15 s cuts: the same scenes, shorter, each its own edit.
import type { Film, Fmt, Scene } from "../engine";
import { assemble } from "../assemble";
import { endShot, revealShot } from "../shots/brand";
import { flashShot, jobsStop, liveHero, practiceStop, resumeQuick, windowsShot } from "../shots/product";
import { IDS } from "../content";
import { line, when } from "../vo";
import type { FilmOptions } from "./index";

const cueScene = (cues: Scene["cues"]): Scene => ({ id: "cues", from: 0, to: 0.001, cues });

export function cut30(fmt: Fmt, _o: FilmOptions): Film {
  const v = {
    a: line("c30-01", 0.35),
    b: line("c30-02.0", 3.35),
    c: line("c30-02.1", 6.25),
    d: line("c30-02.2", 9.05),
    e: line("c30-03", 12.6),
    f: line("c30-04.0", 24.15),
    g: line("c30-04.1", 26.95),
  };
  return assemble({
    id: "cut30", fmt, duration: 30.4, bpm: 116, background: "#ffffff", cover: 15.8,
    scenes: [
      revealShot(fmt, { from: 0, to: 3.25, logoAt: 0.0, lineAt: when(v.a, "one") - 0.15, line: fmt.id === "16x9" ? "One account for your *whole job search.*" : "One account for\nyour *whole job search.*" }),
      resumeQuick(fmt, { from: 3.15, to: 6.25 }),
      jobsStop(fmt, { from: 6.1, to: 9.05, trackerAt: 7.75 }),
      practiceStop(fmt, { from: 8.9, to: 11.9, reviewAt: 10.45 }),
      liveHero(fmt, { from: 11.75, to: 21.6, ask: 0.6, say: 2.2, answer: 3.6, honest: 12.3 }),
      windowsShot(fmt, { from: 21.45, to: 23.95, webAt: 22.75 }),
      endShot(fmt, { from: 23.8, to: 30.4, logoAt: 23.95, lineAt: when(v.f, "interview-ready") - 0.05, freeAt: 26.9 }),
      cueScene([{ t: 11.7, kind: "crash", gain: 0.7 }, { t: 0.0, kind: "impact", gain: 0.6 }]),
    ],
    vo: Object.values(v),
    music: [{ name: "hook", t: 0 }, { name: "groove", t: 3.15 }, { name: "hero", t: 11.75 }, { name: "reach", t: 21.45 }, { name: "outro", t: 23.8 }, { name: "logo", t: 23.95 }],
    quiet: [[0, 3.2], [23.8, 31]],
  });
}

export function cut15(fmt: Fmt, _o: FilmOptions): Film {
  const v = { a: line("c15-01", 0.45), b: line("end", 12.05) };
  return assemble({
    id: "cut15", fmt, duration: 15.4, bpm: 116, background: "#0B0F17", cover: 6.5,
    scenes: [
      liveHero(fmt, { from: 0, to: 9.55, ask: 0.15, say: 1.3, answer: 3.2, honest: 0.6, title: fmt.id === "16x9" ? "Answer notes\nfrom *your own*\nresume. Live." : "Answer notes from\n*your own* resume." }),
      flashShot(fmt, {
        from: 9.45, to: 12.0, items: [
          { path: `/resume-ai/${IDS.draft}`, label: "Resume AI", flow: "resume", flowEpoch: 99, latest: { [`GET /v1/resumes/${IDS.draft}`]: `PUT /v1/resumes/${IDS.draft}`, "POST /v1/resumes/score": "POST /v1/resumes/score" } },
          { path: "/jobs/matches", label: "Jobs AI" },
          { path: `/sessions/${IDS.mockReview}`, label: "Practice" },
        ],
      }),
      endShot(fmt, { from: 11.9, to: 15.4, logoAt: 11.95, lineAt: 12.35, freeAt: 12.6, tagline: fmt.id === "16x9" ? "Interview-ready, from resume to offer." : "Interview-ready,\nfrom resume to offer." }),
      cueScene([{ t: 0.0, kind: "impact", gain: 0.5 }]),
    ],
    vo: Object.values(v),
    music: [{ name: "peak", t: 0 }, { name: "body", t: 9.45 }, { name: "outro", t: 11.9 }, { name: "logo", t: 11.95 }],
    quiet: [[11.9, 16]],
  });
}
