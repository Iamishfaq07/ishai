// The launch film (about 74 s): the job search before → one account → resume, jobs, practice, interview day → live
// answer notes from your own resume → languages, Windows and the web → the rest of the account → the end card.
import type { Film, Fmt } from "../engine";
import { assemble } from "../assemble";
import { chaosShot, openWhite } from "../shots/chaos";
import { endShot, journeyShot, revealShot } from "../shots/brand";
import { dayStop, jobsStop, languagesShot, liveHero, moreShot, practiceStop, resumeStop, windowsShot } from "../shots/product";
import { line, when } from "../vo";
import type { FilmOptions } from "./index";

export function launchFilm(fmt: Fmt, _o: FilmOptions): Film {
  const v = {
    a: line("launch-01.0", 0.7),
    b: line("launch-01.1", 3.5),
    c: line("launch-02", 10.2),
    d: line("launch-03", 15.4),
    e: line("launch-04", 21.5),
    f: line("launch-05", 27.6),
    g: line("launch-06", 33.0),
    h: line("launch-07", 38.0),
    i: line("launch-08.0", 49.7),
    j: line("launch-08.1", 53.7),
    k: line("launch-09", 58.4),
    l: line("launch-10.0", 64.6),
    m: line("launch-10.1", 65.7),
    n: line("launch-10.2", 69.4),
  };
  const tabs = when(v.b, "tabs");
  const versions = when(v.b, "the", 1);
  const interview = when(v.b, "the", 2);
  const chaos = chaosShot(fmt, {
    from: 0, to: 9.75, implode: 8.7,
    lines: [
      [fmt.id === "16x9" ? "Looking for a job\nis a lot to carry." : "Looking for a job\nis a lot\nto carry.", 0.75, tabs - 0.35],
      ["The tabs.", tabs - 0.05, versions - 0.2],
      [fmt.id === "16x9" ? "The resume versions." : "The resume\nversions.", versions - 0.05, interview - 0.2],
      [fmt.id === "16x9" ? "The interview you\nkeep replaying." : "The interview\nyou keep\nreplaying.", interview - 0.05, 8.75],
    ],
  });
  const reveal = revealShot(fmt, { from: 9.6, to: 14.0, logoAt: 9.95, lineAt: when(v.c, "one") - 0.1 });
  const flash = { id: "flash", from: 9.6, to: 10.6, render: (t: number) => openWhite(fmt, t, 9.65, 0.75, 50) };
  return assemble({
    id: "launch", fmt, duration: 74.6, bpm: 116, background: "#0B0F17", cover: 44.5,
    scenes: [
      chaos, reveal, flash,
      journeyShot(fmt, { from: 13.6, to: 15.35, diveAt: 14.8 }),
      resumeStop(fmt, { from: 15.25, to: 21.5, speed: 1.8, times: { tab: 0.75, scroll: 1.2, fix: 1.95, fixDelay: 1100, add1: 3.55, add2: 4.05, top: 4.55, zoom: 4.45 } }),
      jobsStop(fmt, { from: 21.35, to: 27.4, trackerAt: 24.5 }),
      practiceStop(fmt, { from: 27.25, to: 32.9, reviewAt: 30.1 }),
      dayStop(fmt, { from: 32.75, to: 37.25 }),
      liveHero(fmt, { from: 37.05, to: 49.5, ask: 1.4, say: 2.7, answer: 4.0 }),
      languagesShot(fmt, { from: 49.35, to: 53.65, times: [0.3, 1.65, 2.95] }),
      windowsShot(fmt, { from: 53.5, to: 58.2, webAt: 55.45 }),
      moreShot(fmt, { from: 58.05, to: 63.75 }),
      endShot(fmt, { from: 63.6, to: 74.6, logoAt: 64.35, lineAt: 65.75, freeAt: 69.35 }),
    ],
    vo: Object.values(v),
    music: [
      { name: "intro", t: 0 }, { name: "tension", t: 3.5 }, { name: "reveal", t: 9.75 }, { name: "journey", t: 13.6 },
      { name: "groove", t: 15.25 }, { name: "lift", t: 32.75 }, { name: "hero", t: 37.05 }, { name: "reach", t: 49.35 },
      { name: "more", t: 58.05 }, { name: "outro", t: 63.6 }, { name: "logo", t: 64.35 },
    ],
    quiet: [[0, 13.7], [63.6, 75]],
  });
}
