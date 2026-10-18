import type { Film, Fmt, Scene } from "./engine";
import { Captions, chunk, type CaptionBox, type Chunk } from "./ui";
import type { Placed } from "./vo";

/** A film from its scenes and voice-over: captions from the voice (except where the screen already says it). */
export function assemble(o: {
  id: string;
  fmt: Fmt;
  duration: number;
  scenes: Scene[];
  vo: Placed[];
  music: Array<{ name: string; t: number }>;
  bpm: number;
  background?: string;
  cover?: number;
  /** Time ranges where the words on screen already are the voice: no caption box there. */
  quiet?: Array<[number, number]>;
  /** Captions in white boxes (for dark scenes) in these ranges. */
  darkCaptions?: Array<[number, number]>;
  /** Where the caption box sits and how wide it is (default: the format's usual place). */
  captionBox?: CaptionBox;
}): Film {
  const chunks: Chunk[] = o.vo.flatMap((v) => chunk(v.words, o.fmt, o.captionBox?.max)).sort((a, b) => a.from - b.from);
  // A line's last caption is held a moment after its words; never into the next line's first one.
  for (let i = 0; i + 1 < chunks.length; i++) chunks[i]!.to = Math.min(chunks[i]!.to, chunks[i + 1]!.from);
  const shown = chunks.filter((c) => !(o.quiet ?? []).some(([a, b]) => c.from >= a - 0.05 && c.from < b));
  return {
    id: o.id,
    fmt: o.fmt,
    duration: o.duration,
    scenes: o.scenes,
    music: o.music,
    bpm: o.bpm,
    background: o.background,
    cover: o.cover,
    captions: chunks.map((c) => ({ from: c.from, to: c.to, text: c.words.map((w) => w[0]).join(" ") })),
    vo: o.vo.map((v) => ({ id: v.id, t: v.t, text: v.text, dur: v.dur })),
    overlay: (t) => <Captions t={t} fmt={o.fmt} chunks={shown} box={o.captionBox} />,
  };
}
