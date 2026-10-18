// "Saba takes an interview": her room (the real VideoInterviewRoom), her voice bars following her real voice (Aurora,
// the files the room asks the voice endpoint for), the room's captions as she speaks, the candidate answering (a
// second voice), a follow-up on what was said, the closing, and the review. 16:9 and 9:16, about 45 s, and a 15 s cut.
import type { Film, Fmt, FrameSpec, Scene } from "../engine";
import { assemble } from "../assemble";
import { endShot } from "../shots/brand";
import { TitleBlock, camera, placement } from "../shots/kit";
import { ep, inOut } from "../anim";
import { Backdrop, Eyebrow, Words, abs, fs, type CaptionBox } from "../ui";
import { dur, line, type Placed } from "../vo";
import sabaIds from "../../../fixtures/flows/video.json";
import saba from "../../../vo/saba.json";
import sabaReviewFlow from "../../../fixtures/flows/sabaReview.json";
import sabaPlays from "../../../vo/saba-plays.json";
import type { FilmOptions } from "./index";

const VIDEO_LIVE = (sabaIds as { __sessions: { video: string } }).__sessions.video;
// The ended interview the review shows (tools/seed_video.py video, recorded as fixtures/flows/sabaReview.json).
const REVIEW = Object.keys(sabaReviewFlow).map((k) => /^GET \/v1\/sessions\/([0-9a-f-]{36})$/.exec(k)?.[1]).find(Boolean) ?? "";

/** Saba's pieces, as the room cuts her lines (vo/saba.json): what it asks the voice endpoint for, and the file. */
const PIECES = (saba.lines as Array<{ id: string; text: string }>).filter((l) => l.id.startsWith("saba-"));
const clip = (id: string) => ({ text: PIECES.find((p) => p.id === id)!.text, file: `${id}.mp3` });
const LINES = {
  hello: { ids: ["saba-01a", "saba-01b"], text: "Hi Aditi, I'm Saba. Thanks for making time today." },
  q1: { ids: ["saba-02"], text: "To start, tell me about a time you used data to change a product decision." },
  q2: { ids: ["saba-03a", "saba-03b"], text: "That's a clear result. When you made the case for a window, how did you convince the product team?" },
  bye: { ids: ["saba-04a", "saba-04b"], text: "Thank you, Aditi. That's all from me today, and your review is ready now." },
};
/**
 * Her short acknowledgement after an answer ("Mm-hmm.", while her reply is on its way): the room asks for all of
 * naturalVoice.ts ACKS ahead; the film has this one, so it's the one she says (the others aren't available).
 */
const ACK = "saba-ack-mm";
/** From her line arriving to her first sound: the room fetches, decodes and starts the clip (measured, tools/render.mjs medialog). */
export const SABA_LATENCY = 0.05;
/**
 * Where the room really played each of her clips (tools/render.mjs medialog, by film and format): the mix puts her
 * voice there. Without a measurement (a new timing), the film's own guess (SABA_LATENCY) is used.
 */
type Play = { file: string; at: number; end: number | null };
const PLAYS = sabaPlays as unknown as Record<string, Play[]>;

type Step = Record<string, unknown> & { at: number };

/** The room's script: her lines and the candidate's, at seconds after the room opens; and where each voice clip falls. */
function conversation(o: { hello?: number; q1?: number; answer1?: { at: number; parts: string[] }; q2?: number; answer2?: { at: number; parts: string[] }; bye?: number; done?: number }) {
  const steps: Step[] = [{ at: 0.02, hide: { sel: "summary", text: "Critique architecture" } }];
  const voice: Array<{ id: string; at: number }> = [];
  const say = (key: keyof typeof LINES, at: number, kind: "say" | "question", n: number, follow = false) => {
    const l = LINES[key];
    if (kind === "say") steps.push({ at, live: "emit", data: { type: "mock.say", data: { say_id: `s-${key}`, text: l.text, kind: key === "bye" ? "closing" : "smalltalk" } } });
    else {
      steps.push({ at, live: "emit", data: { type: "transcript.final", data: { turn_id: `t-${key}`, speaker: "interviewer", text: l.text, start_ms: 0, end_ms: 0 } } });
      steps.push({ at: at + 0.01, live: "emit", data: { type: "mock.question", data: { question_id: `q-${key}`, text: l.text, concept_depth: n, is_follow_up: follow, index: n, total: 4, question_type: "behavioral" } } });
    }
    let t = at + SABA_LATENCY;
    for (const id of l.ids) {
      voice.push({ id, at: t });
      t += dur(id);
    }
    return t;
  };
  const answer = (a: { at: number; parts: string[] }, turn: string) => {
    let t = a.at;
    const words: string[] = [];
    for (const id of a.parts) {
      const p = line(id, t);
      words.push(p.text);
      steps.push({ at: t, live: "speak", data: { turn_id: turn, text: words.join(" ") , from: words.slice(0, -1).join(" ") }, dur: p.dur * 1000 });
      voice.push({ id, at: t });
      t += p.dur + 0.25;
    }
    steps.push({ at: t - 0.15, live: "emit", data: { type: "transcript.final", data: { turn_id: turn, speaker: "candidate", text: words.join(" "), start_ms: 0, end_ms: 9000 } } });
    return t;
  };
  if (o.hello !== undefined) say("hello", o.hello, "say", 0);
  if (o.q1 !== undefined) say("q1", o.q1, "question", 1);
  if (o.answer1) answer(o.answer1, "a1");
  if (o.q2 !== undefined) {
    steps.push({ at: o.q2 - 0.5, live: "emit", data: { type: "mock.thinking", data: {} } });
    say("q2", o.q2, "question", 2, true);
  }
  if (o.answer2) answer(o.answer2, "a2");
  if (o.bye !== undefined) say("bye", o.bye, "say", 0);
  if (o.done !== undefined) steps.push({ at: o.done, live: "emit", data: { type: "mock.completed", data: { questions: 2, topics: ["Product decisions"], follow_ups: 1, answered: 2, unanswered: 0, average_answer_words: 28, drill: null } } });
  return { steps, voice };
}

const VOICE_STATUS = { available: true, voices: [{ id: "aurora", label: "Aurora · bright and lively", model: "aura-2-aurora-en" }], default_voice: "aurora", chars_left: null };

const ROOM: Record<string, { vp: [number, number]; p: { sx: number; sy: number; scale: number } }> = {
  "16x9": { vp: [1280, 800], p: { sx: 960, sy: 546, scale: 1.28 } },
  "9x16": { vp: [430, 900], p: { sx: 540, sy: 300 + 900, scale: 2.0 } },
  "4x5": { vp: [470, 600], p: { sx: 540, sy: 92 + (600 * 1.76) / 2, scale: 1.76 } },
  "1x1": { vp: [580, 540], p: { sx: 540, sy: 70 + (540 * 1.56) / 2, scale: 1.56 } },
};

const CAPTIONS: Record<string, CaptionBox | undefined> = {
  "16x9": { x: 979, y: 690, max: 50, maxWidth: 500, size: 34 },
  "9x16": { y: 1270, max: 52, maxWidth: 780 },
};

function room(fmt: Fmt, from: number, to: number, conv: ReturnType<typeof conversation>, preroll = 1500): Scene {
  const land = fmt.id === "16x9";
  // The room's own layouts: the wide one (her tile, yours, the transcript beside) in 16:9, the phone one elsewhere.
  const { vp, p: base } = ROOM[fmt.id];
  const frame: FrameSpec = {
    id: `room-${from}`, path: `/live/${VIDEO_LIVE}`, flow: "video", viewport: vp, from: from - 0.3, to: to + 0.1, preroll,
    historyState: { usr: { systemAudio: false }, key: "demo", idx: 0 }, theme: "dark",
    routes: { "GET /v1/voice": { status: 200, body: VOICE_STATUS } },
    voiceClips: [...Object.values(LINES).flatMap((l) => l.ids.map(clip)), clip(ACK)],
    script: conv.steps.map((s) => ({ ...s, at: s.at + 0.3 })),
    layout: camera({ vp, p: base }, [{ t: from, z: 1 }, { t: to, z: 1.03 }], { enter: [from - 0.3, from + 0.6], from: "rise", exit: [to - 0.4, to + 0.1], to: "back", lift: 1.2, anchorTop: !land }),
  } as FrameSpec;
  return {
    id: `room-${from}`, from, to, frames: [frame],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.7 }],
    render: (t) => <Backdrop fmt={fmt} mode="ink" t={t} z={1} />,
  };
}

function hook(fmt: Fmt, from: number, to: number, text: string): Scene {
  const size = fs(fmt, 92, 88, 80);
  return {
    id: `hook-${from}`, from, to, cues: [{ t: from, kind: "impact", gain: 0.4 }],
    render: (t) => {
      const out = ep(t, to - 0.45, to, inOut);
      return (
        <>
          <Backdrop fmt={fmt} mode="ink" t={t} z={1} />
          <div style={abs({ left: 0, right: 0, top: 0, bottom: fmt.id === "9x16" ? 260 : 40, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, opacity: 1 - out, transform: `translateY(${-out * 60}px)` })}>
            <Eyebrow text="AI video interview" t={t} at={from} size={fs(fmt, 30, 34, 30)} dark />
            <Words text={text} t={t} at={from + 0.02} size={size} align="center" color="#fff" stagger={0.05} dur={0.55} lh={1.04} />
          </div>
        </>
      );
    },
  };
}

function review(fmt: Fmt, from: number, to: number): Scene {
  const land = fmt.id === "16x9";
  const { vp, p: base } = placement(fmt);
  const frame: FrameSpec = {
    id: `rev-${from}`, path: `/sessions/${REVIEW}`, flow: "sabaReview", viewport: vp, from: from - 0.3, to: to + 0.1,
    script: [{ at: 0.6, scroll: { sel: "p, span, h2, h3", text: "Strong" }, offset: land ? 200 : 150, dur: 900 }],
    layout: camera({ vp, p: base }, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.3, from + 0.5], from: "right", exit: [to - 0.35, to + 0.1], to: "left" }),
  };
  return {
    id: `rev-${from}`, from, to, frames: [frame],
    cues: [{ t: from - 0.1, kind: "swish", dur: 0.6 }, { t: from + 1.0, kind: "chime", gain: 0.55 }],
    render: (t) => (
      <>
        <Backdrop fmt={fmt} mode="mist" t={t} z={1} />
        <TitleBlock fmt={fmt} t={t} at={from + 0.05} out={to - 0.4} eyebrow="Your review" title={land ? "Every answer\n*scored, with\nwhat to fix.*" : "Every answer,\n*scored.*"} />
      </>
    ),
  };
}

function sabaFilm(fmt: Fmt, id: string, o: {
  hookText: string; hookTo: number; roomFrom: number; conv: Parameters<typeof conversation>[0]; roomTo: number; reviewTo?: number; cover: number;
  /** The room's clock before it's seen (ms): a cut that opens mid-interview has her question asked in it. */
  preroll?: number;
}): Film {
  const conv = conversation(o.conv);
  const shift = (x: number) => x + o.roomFrom + 0.3 - 0.3;
  const measured = PLAYS[`${id}/${fmt.id}`];
  const voice: Placed[] = [
    ...conv.voice.filter((v) => !measured || !v.id.startsWith("saba-")).map((v) => line(v.id, shift(v.at))),
    ...(measured ?? []).map((p) => line(p.file.replace(/\.mp3$/, ""), p.at)),
  ].filter((v) => v.t >= 0) // what she said before the film begins (a cut's opening question) isn't heard
  .sort((a, b) => a.t - b.t);
  const scenes: Scene[] = [hook(fmt, 0, o.hookTo, o.hookText), room(fmt, o.roomFrom, o.roomTo, conv, o.preroll)];
  let endAt = o.roomTo - 0.1;
  if (o.reviewTo) {
    scenes.push(review(fmt, o.roomTo - 0.15, o.reviewTo));
    endAt = o.reviewTo - 0.1;
  }
  const end = endShot(fmt, { from: endAt, to: endAt + 3.7, logoAt: endAt + 0.1, lineAt: endAt + 0.45, freeAt: endAt + 0.65 });
  scenes.push(end);
  const endVo = line("end", endAt + 0.35);
  // Saba's lines are captioned by the room itself (her caption, word by word): no second caption box over them.
  const sabaQuiet = voice.filter((v) => v.id.startsWith("saba-")).map((v) => [v.t - 0.05, v.t + v.dur] as [number, number]);
  return assemble({
    id, fmt, duration: endAt + 3.7, bpm: 104, background: "#0B0F17", cover: o.cover,
    scenes, vo: [...voice, endVo],
    music: [{ name: "hook", t: 0 }, { name: "journey", t: o.roomFrom }, { name: "body", t: o.roomTo - 0.15 }, { name: "outro", t: endAt }, { name: "logo", t: endAt + 0.1 }],
    quiet: [...sabaQuiet, [endAt, endAt + 5]],
    // The candidate's words: in 16:9 in their own (camera-off) tile, in 9:16 between Saba's voice and her caption.
    captionBox: CAPTIONS[fmt.id],
  });
}

export function sabaLong(fmt: Fmt, _o: FilmOptions): Film {
  const land = fmt.id === "16x9";
  return sabaFilm(fmt, "saba", {
    hookText: land ? "Meet Saba,\n*your AI interviewer.*" : "Meet Saba,\nyour AI\n*interviewer.*", hookTo: 2.3, roomFrom: 1.9,
    conv: { hello: 0.9, q1: 5.0, answer1: { at: 9.4, parts: ["cand-01.0", "cand-01.2"] }, q2: 18.6, answer2: { at: 24.4, parts: ["cand-02"] }, bye: 32.3, done: 36.3 },
    roomTo: 39.7, reviewTo: 45.1, cover: 10.4,
  });
}

export function sabaShort(fmt: Fmt, _o: FilmOptions): Film {
  const land = fmt.id === "16x9";
  return sabaFilm(fmt, "saba15", {
    hookText: land ? "Saba listens,\n*and follows up.*" : "Saba listens,\n*and follows up.*", hookTo: 1.6, roomFrom: 1.2,
    // Opens mid-interview: her first question was asked before the film (the room has her in it, not "joining").
    conv: { q1: -6.5, answer1: { at: 0.2, parts: ["cand-01.2"] }, q2: 4.15 }, preroll: 9500,
    roomTo: 11.3, cover: 10.2,
  });
}
