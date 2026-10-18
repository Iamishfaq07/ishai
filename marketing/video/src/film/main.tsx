// The film page: film.html?film=<id>&fmt=<16x9|9x16|1x1|4x5>. Exposes window.FILM for tools/render.mjs.
import "../app/virtualTime";
import "../../../../apps/web/src/fonts.css";
import "./tw.css";
import "./film.css";
import { FORMATS, cuesOf, mediaLogs, misses, seek, start, type FmtId } from "./engine";
import { FILMS } from "./films";

const q = new URLSearchParams(location.search);
const fmt = FORMATS[(q.get("fmt") as FmtId) ?? "16x9"] ?? FORMATS["16x9"];
const make = FILMS[q.get("film") ?? "test"];
if (!make) throw new Error(`no film ${q.get("film")}`);
const film = make(fmt, { voice: q.get("vo") !== "0" });
// A cover picture has no caption box (cap=0).
if (q.get("cap") === "0") film.overlay = undefined;
start(film);

declare global {
  interface Window {
    FILM: unknown;
    READY: boolean;
  }
}
window.FILM = {
  id: film.id,
  duration: film.duration,
  fmt: film.fmt,
  bpm: film.bpm,
  cover: film.cover ?? film.duration * 0.4,
  seek,
  cues: () => cuesOf(film),
  music: () => film.music,
  captions: () => film.captions,
  vo: () => film.vo,
  misses,
  mediaLogs,
};
await document.fonts.ready;
window.READY = true;
