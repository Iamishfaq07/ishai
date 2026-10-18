// The feature films (15-21 s, upright and square, for Reels, Stories and feeds): one message each, a hook in the
// first second and a half, the real screens, and the end card.
import type { Film, Fmt, FrameSpec, Scene } from "../engine";
import { assemble } from "../assemble";
import { endShot } from "../shots/brand";
import { HIDE_TOASTS, LAYOUT, TitleBlock, camera, placement, press, stepsOf, stop, type Press } from "../shots/kit";
import { LANGS, ScoreCard, jobsStop, languagesShot, liveHero, resumeStop } from "../shots/product";
import { ANSWER, IDS, LIVE_HISTORY } from "../content";
import { ep, inOut, out4 } from "../anim";
import { ACCENT, Backdrop, Eyebrow, FONT, INK, INK3, Words, abs, fs } from "../ui";
import { line, when, type Placed } from "../vo";
import type { FilmOptions } from "./index";

const DAY = 24 * 3600 * 1000;

/** The first second and a half: the message, big, on its own. */
function hookShot(fmt: Fmt, r: { from: number; to: number; text: string; eyebrow?: string; dark?: boolean }): Scene {
  const size = fs(fmt, 96, fmt.id === "9x16" ? 92 : 82, 80);
  return {
    id: `hook-${r.from}`, from: r.from, to: r.to,
    cues: [{ t: r.from, kind: "impact", gain: 0.45 }],
    render: (t) => {
      const out = ep(t, r.to - 0.45, r.to, inOut);
      return (
        <>
          <Backdrop fmt={fmt} mode={r.dark ? "ink" : "light"} t={t} z={1} />
          <div style={abs({ left: 0, right: 0, top: 0, bottom: fmt.id === "9x16" ? 260 : 60, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, opacity: 1 - out, transform: `translateY(${-out * 80}px) scale(${1 - out * 0.08})` })}>
            {r.eyebrow && <Eyebrow text={r.eyebrow} t={t} at={r.from} size={fs(fmt, 30, 34, 30)} dark={r.dark} />}
            <Words text={r.text} t={t} at={r.from + 0.02} size={size} align="center" stagger={0.05} dur={0.55} color={r.dark ? "#fff" : INK} lh={1.04} />
          </div>
        </>
      );
    },
  };
}

function endOf(fmt: Fmt, at: number): { scene: Scene; vo: Placed; to: number } {
  const to = at + 3.7;
  return { scene: endShot(fmt, { from: at, to, logoAt: at + 0.1, lineAt: at + 0.45, freeAt: at + 0.65 }), vo: line("end", at + 0.35), to };
}

function film(fmt: Fmt, id: string, scenes: Scene[], vo: Placed[], endAt: number, o: { cover: number; quiet?: Array<[number, number]>; bg?: string; music?: Array<{ name: string; t: number }> }): Film {
  const end = endOf(fmt, endAt);
  return assemble({
    id, fmt, duration: end.to, bpm: 116, background: o.bg ?? "#ffffff", cover: o.cover,
    scenes: [...scenes, end.scene], vo: [...vo, end.vo],
    music: o.music ?? [{ name: "hook", t: 0 }, { name: "body", t: 1.6 }, { name: "peak", t: Math.max(2, endAt - 5) }, { name: "outro", t: endAt }, { name: "logo", t: endAt + 0.1 }],
    quiet: [...(o.quiet ?? []), [endAt, end.to + 1]],
  });
}

// ── 1. The interview assistant ─────────────────────────────────────────────────────────────────────────────────
export function fCopilot(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-copilot.0", 0.35), line("f-copilot.1", 2.75), line("f-copilot.2", 7.9), line("f-copilot.3", 11.35)];
  return film(fmt, "f-copilot", [
    liveHero(fmt, { from: 0, to: 14.5, ask: 0.15, say: 2.4, answer: 3.6, honest: 11.3, title: "Answer notes from\n*your own* resume." }),
  ], v, 14.4, { cover: 7.2, bg: "#0B0F17", music: [{ name: "hook", t: 0 }, { name: "body", t: 2.6 }, { name: "peak", t: 7.6 }, { name: "outro", t: 14.4 }, { name: "logo", t: 14.5 }] });
}

// ── 2. Practice and the review ─────────────────────────────────────────────────────────────────────────────────
function practiceRoom(fmt: Fmt, from: number, to: number): Scene {
  const pl = placement(fmt);
  const id = `room-${from}`;
  const Q1 = "Thanks for joining. To start, tell me about a time you used data to change a product decision.";
  const Q2 = "You said the short version became the default. How did you check it wasn't just a novelty effect?";
  const frame: FrameSpec = {
    id, path: `/live/${IDS.liveMock}`, flow: "live", viewport: pl.vp, from: from - 0.3, to: to + 0.1, historyState: { usr: {}, key: "demo", idx: 0 },
    script: [
      { at: 0.02, hide: { sel: "summary", text: "Critique architecture" } },
      { at: 0.05, live: "emit", data: { type: "transcript.final", data: { turn_id: "m1", speaker: "interviewer", text: Q1, start_ms: 0, end_ms: 0 } } },
      { at: 0.06, live: "emit", data: { type: "mock.question", data: { question_id: "mq1", text: Q1, concept_depth: 1, is_follow_up: false, index: 1, total: 6, question_type: "behavioral" } } },
      { at: 1.4, live: "speak", data: { turn_id: "m2", text: "At Juniper Logistics most late deliveries came from the date we promised at checkout, so I built a delivery-time model and made the case for a delivery window" }, dur: 2300 },
      { at: 3.75, live: "emit", data: { type: "transcript.final", data: { turn_id: "m2", speaker: "candidate", text: "At Juniper Logistics most late deliveries came from the date we promised at checkout, so I built a delivery-time model and made the case for a delivery window.", start_ms: 0, end_ms: 9000 } } },
      { at: 3.85, live: "emit", data: { type: "transcript.final", data: { turn_id: "m3", speaker: "interviewer", text: Q2, start_ms: 0, end_ms: 0 } } },
      { at: 3.9, live: "emit", data: { type: "mock.question", data: { question_id: "mq2", text: Q2, concept_depth: 2, is_follow_up: true, index: 2, total: 6, question_type: "behavioral" } } },
    ],
    layout: camera(pl, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.3, from + 0.5], from: "rise", exit: [to - 0.35, to + 0.1], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.6 }, { t: from + 3.9, kind: "detect", gain: 0.8 }],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={from + 0.05} out={to - 0.4} eyebrow="Practice" title={"It asks out loud,\n*and follows up.*"} />,
  });
}

function reviewScene(fmt: Fmt, from: number, to: number, marks: number[]): Scene {
  const pl = placement(fmt);
  const id = `rev-${from}`;
  const frame: FrameSpec = {
    id, path: `/sessions/${IDS.mockReview}`, viewport: pl.vp, from: from - 0.3, to: to + 0.1,
    script: [
      { at: 0.75, scroll: { sel: "p, span, h2, h3", text: "Strong" }, offset: fmt.portrait ? 150 : 200, dur: 800 },
      { at: marks[0]! - from + 0.1, scroll: { sel: "p, span, h2, h3", text: "What went well" }, offset: fmt.portrait ? 130 : 160, dur: 700 },
      { at: marks[1]! - from + 0.1, scroll: { sel: "p, span, h2, h3", text: "To improve" }, offset: fmt.portrait ? 130 : 120, dur: 700 },
      { at: marks[2]! - from + 0.1, scroll: { sel: "p, span, h2, h3", text: "Practice next" }, offset: fmt.portrait ? 130 : 120, dur: 700 },
    ],
    layout: camera(pl, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.3, from + 0.5], from: "right", exit: [to - 0.35, to + 0.1], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame],
    cues: [{ t: from - 0.1, kind: "swish", dur: 0.6 }, { t: marks[0]! + 0.5, kind: "chime", gain: 0.55 }],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={from + 0.05} out={to - 0.4} eyebrow="Your review" title={"A review after\n*every round.*"} />,
  });
}

export function fPractice(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-practice.0", 0.3), line("f-practice.1", 2.95), line("f-practice.2", 7.35)];
  const r = v[2]!;
  return film(fmt, "f-practice", [
    hookShot(fmt, { from: 0, to: 2.75, text: fmt.id === "9x16" ? "Practise the\ninterview\n*before the\ninterview.*" : "Practise the interview\n*before the interview.*", eyebrow: "Practice" }),
    practiceRoom(fmt, 2.55, 7.35),
    reviewScene(fmt, 7.2, 13.6, [when(r, "what"), when(r, "fix,"), when(r, "practise")]),
  ], v, 13.5, { cover: 4.4, quiet: [[0, 2.7]] });
}

// ── 3. Resume AI ───────────────────────────────────────────────────────────────────────────────────────────────
export function fResume(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-resume.0", 0.3), line("f-resume.1", 3.05), line("f-resume.2", 9.75)];
  const b = v[1]!;
  const from = 2.75;
  const rel = (x: number) => x - from;
  return film(fmt, "f-resume", [
    hookShot(fmt, { from: 0, to: 2.95, text: fmt.id === "9x16" ? "Is your resume\ngetting past\n*the filters?*" : "Is your resume getting\npast *the filters?*", eyebrow: "Resume AI" }),
    resumeStop(fmt, {
      from, to: 13.35, title: "Score it.\n*Fix it with AI.*", speed: 1.3,
      times: { tab: rel(when(b, "scores")) - 0.2, scroll: rel(when(b, "shows")) - 0.3, fix: rel(when(b, "fixes")) - 0.15, fixDelay: 1100, add1: rel(when(v[2]!, "confirm")) + 0.1, add2: rel(when(v[2]!, "skill")) + 0.25, top: rel(when(v[2]!, "adds.")) + 0.35, zoom: 9.0 },
    }),
  ], v, 13.25, { cover: 11.6, quiet: [[0, 2.9]] });
}

// ── 4. Jobs AI and the Mission room ────────────────────────────────────────────────────────────────────────────
function matchesSave(fmt: Fmt, from: number, to: number, saveAt: number): Scene {
  const pl = placement(fmt);
  const id = `ms-${from}`;
  const presses: Press[] = [press(id, saveAt, { sel: "button", text: "=Save", row: "Marketing Data Analyst" }, 0.8)];
  const frame: FrameSpec = {
    id, path: "/jobs/matches", flow: "jobs", viewport: pl.vp, from: from - 0.3, to: to + 0.1,
    script: [
      { at: 0.0, css: HIDE_TOASTS },
      { at: 1.0, scroll: { sel: "h3, h2, a", text: "Senior Data Analyst" }, offset: fmt.portrait ? 110 : 150, dur: 1500 },
      { at: saveAt - from + 0.3 - 1.9, scroll: { sel: "h3, h2, a", text: "Marketing Data Analyst" }, offset: fmt.portrait ? 110 : 150, dur: 1000 },
      ...stepsOf(presses, from - 0.3),
    ],
    layout: camera(pl, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.3, from + 0.5], from: "rise", exit: [to - 0.35, to + 0.1], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame], presses,
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.6 }, { t: saveAt + 0.1, kind: "pop", gain: 0.7 }],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={from + 0.05} out={to - 0.4} eyebrow="Jobs AI" title={"Matched to\n*your resume.*"} />,
  });
}

function simpleScreen(fmt: Fmt, o: { id: string; from: number; to: number; path: string; eyebrow: string; title: string; flow?: string; flowEpoch?: number; latest?: Record<string, string>; script?: FrameSpec["script"]; epochShift?: number; enterFrom?: "right" | "rise"; cues?: Scene["cues"]; storage?: Record<string, string> }): Scene {
  const pl = placement(fmt);
  const frame: FrameSpec = {
    id: o.id, path: o.path, flow: o.flow, flowEpoch: o.flowEpoch, latest: o.latest, epochShift: o.epochShift, viewport: pl.vp, from: o.from - 0.3, to: o.to + 0.1, script: [{ at: 0, css: HIDE_TOASTS }, ...(o.script ?? [])], storage: o.storage,
    layout: camera(pl, [{ t: o.from, z: 1 }, { t: o.to, z: 1.04 }], { enter: [o.from - 0.3, o.from + 0.5], from: o.enterFrom ?? "right", exit: [o.to - 0.35, o.to + 0.1], to: "left" }),
  };
  return stop({
    id: o.id, fmt, from: o.from, to: o.to, frames: [frame], cues: [{ t: o.from - 0.1, kind: "swish", dur: 0.55 }, ...(o.cues ?? [])],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={o.from + 0.05} out={o.to - 0.4} eyebrow={o.eyebrow} title={o.title} />,
  });
}

export function fJobs(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-jobs.0", 1.35), line("f-jobs.1", 6.85)];
  const b = v[1]!;
  return film(fmt, "f-jobs", [
    hookShot(fmt, { from: 0, to: 1.95, text: fmt.id === "9x16" ? "New jobs\nthat *fit you.*" : "New jobs that *fit you.*", eyebrow: "Jobs AI" }),
    matchesSave(fmt, 1.75, 8.6, when(b, "save") + 0.35),
    simpleScreen(fmt, { id: "trk", from: 8.45, to: 10.85, path: "/jobs/tracker", flow: "jobs", flowEpoch: 99, eyebrow: "Tracker", title: "From saved\n*to offer.*", script: [{ at: 0.35, scroll: { sel: "span, p, h2, h3", text: "Saved" }, offset: 120, dur: 900 }] }),
    simpleScreen(fmt, { id: "mis", from: 10.7, to: 12.95, path: `/jobs/mission/${IDS.tracker["Kestrel Pay"]}`, eyebrow: "Mission room", title: "Each job,\n*its own room.*" }),
  ], v, 12.85, { cover: 3.4, quiet: [[0, 1.9]] });
}

// ── 5. Interview day ───────────────────────────────────────────────────────────────────────────────────────────
export function fDayloop(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-dayloop.0", 0.3), line("f-dayloop.1", 2.35), line("f-dayloop.2", 6.85), line("f-dayloop.3", 12.45)];
  const shift = DAY; // Monday: the Kestrel Pay interview is tomorrow
  const c = v[2]!;
  return film(fmt, "f-dayloop", [
    simpleScreen(fmt, { id: "home", from: 0, to: 2.45, path: "/", epochShift: shift, eyebrow: "Interview day", title: "Interview\n*tomorrow?*", enterFrom: "rise", script: [{ at: 0.2, scroll: { sel: "h2, h3", text: "Interview tomorrow" }, offset: fmt.portrait ? 150 : 200, dur: 700 }] }),
    simpleScreen(fmt, { id: "plan", from: 2.3, to: 6.9, path: `/jobs/mission/${IDS.tracker["Kestrel Pay"]}`, epochShift: shift, eyebrow: "Prep plan", title: "The job becomes\n*a prep plan.*", script: [{ at: 0.4, click: { sel: "[role=tab], button", text: "Prep plan" } }, { at: 1.1, scroll: { sel: "h2, h3, p", text: "Today" }, offset: fmt.portrait ? 160 : 220, dur: 900 }] }),
    simpleScreen(fmt, { id: "setup", from: 6.75, to: when(c, "already") + 0.95, path: `/start?application=${IDS.tracker["Kestrel Pay"]}`, epochShift: shift, eyebrow: "Copilot", title: "Started with\n*the job loaded.*", script: [{ at: 0.5, scroll: { sel: "h2, h3, p", text: "Context documents" }, offset: fmt.portrait ? 150 : 220, dur: 1000 }] }),
    simpleScreen(fmt, { id: "wrap", from: 12.3, to: 16.15, path: `/sessions/${IDS.interviewReview}`, flow: "dayloop", flowEpoch: 99, latest: { [`GET /v1/sessions/${IDS.interviewReview}/follow-up`]: `POST /v1/sessions/${IDS.interviewReview}/follow-up` }, epochShift: shift + 0.4 * DAY, eyebrow: "Wrap-up", title: "Your thank-you,\n*drafted.*", script: [{ at: 0.35, scroll: { sel: "h2, h3, p", text: "A quick debrief" }, offset: fmt.portrait ? 200 : 240, dur: 700 }, { at: 1.25, click: { text: "Write my follow-up" } }, { at: 2.0, scroll: { sel: "p, h2, h3, div", text: "Thank-you email" }, offset: fmt.portrait ? 110 : 150, dur: 900 }] }),
  ], v, 16.0, { cover: 4.5 });
}

// ── 6. LinkedIn AI ─────────────────────────────────────────────────────────────────────────────────────────────
function linkedinScene(fmt: Fmt, from: number, to: number, t: { fix: number[]; apply: number[]; top: number }): Scene {
  const pl = placement(fmt);
  const id = `li-${from}`;
  const rows = ["Rewrite the headline", "Rewrite the About", "Rewrite Senior Data Analyst at Juniper Logistics", "Reorder and add skills"];
  const presses: Press[] = [];
  const script: FrameSpec["script"] = [{ at: 0, css: HIDE_TOASTS }, { at: 0.15, click: { sel: "[role=radio], button", text: "Both" } }, { at: 0.25, select: { sel: "select" }, value: IDS.resume }];
  rows.forEach((label, i) => {
    const f = t.fix[i];
    const a = t.apply[i];
    if (f === undefined || a === undefined) return;
    script.push({ at: f - from + 0.3 - 0.75, scroll: { sel: "p", text: label }, offset: fmt.portrait ? 300 : 360, dur: 600 });
    presses.push(press(id, f, { sel: "button", text: "Fix", row: label }, 0.55));
    presses.push(press(id, a, { text: "Apply to my Orbit copy" }, 0.5));
  });
  script.push({ at: t.top - from + 0.3, scroll: 0, dur: 800 });
  // The press finds the row's own button: the scripts' finder takes the first match, so each fix button is located by
  // scrolling its row into view first; the cursor follows the same element.
  const frame: FrameSpec = {
    id, path: "/linkedin", flow: "linkedin", viewport: pl.vp, from: from - 0.3, to: to + 0.1, delays: { "POST /v1/linkedin/fix": 450 },
    script: [...script, ...stepsOf(presses, from - 0.3)],
    layout: camera(pl, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.3, from + 0.5], from: "rise", exit: [to - 0.35, to + 0.1], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame], presses,
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.6 }, ...t.apply.map((x) => ({ t: x + 0.1, kind: "pop", gain: 0.6 }))],
    draw: (tt) => <TitleBlock fmt={fmt} t={tt} at={from + 0.05} out={to - 0.4} eyebrow="LinkedIn AI" title={"Fixes written,\n*ready to paste.*"} />,
  });
}

export function fLinkedin(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-linkedin.0", 0.3), line("f-linkedin.1", 3.15), line("f-linkedin.2", 11.95)];
  const b = v[1]!;
  const hl = when(b, "headline,") + 0.1;
  const ab = when(b, "about,") + 0.2;
  const ro = when(b, "roles.") + 0.25;
  return film(fmt, "f-linkedin", [
    simpleScreen(fmt, { id: "li-search", from: 0, to: 3.3, path: "/linkedin", flow: "linkedin", eyebrow: "LinkedIn AI", title: "See it the way\n*recruiters do.*", enterFrom: "rise", script: [{ at: 0.4, scroll: { sel: "h2, h3", text: "How a recruiter" }, offset: fmt.portrait ? 120 : 140, dur: 900 }] }),
    linkedinScene(fmt, 3.15, 16.3, { fix: [hl, ab, ro, when(v[2]!, "paste") - 0.15], apply: [hl + 1.05, ab + 1.0, ro + 0.95, when(v[2]!, "paste") + 0.55], top: when(v[2]!, "watch") - 0.05 }),
  ], v, 16.2, { cover: 15.4 });
}

// ── 7. 10 languages ────────────────────────────────────────────────────────────────────────────────────────────
export function fLanguages(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-languages.0", 0.3), line("f-languages.1", 2.95)];
  const langs = [LANGS[1]!, LANGS[0]!, LANGS[2]!, LANGS[3]!, LANGS[4]!];
  return film(fmt, "f-languages", [
    hookShot(fmt, { from: 0, to: 2.75, text: fmt.id === "9x16" ? "हिन्दी. Español.\n日本語.\n*Your interview.*" : "हिन्दी. Español. 日本語.\n*Your interview.*", eyebrow: "10 interview languages" }),
    languagesShot(fmt, { from: 2.55, to: 10.25, langs, times: [0.35, 1.8, 3.25, 4.7, 6.1], answerDur: 1.0, title: "Notes in\n*its* language." }),
    simpleScreen(fmt, { id: "setup-l", from: 10.1, to: 11.95, path: "/start", eyebrow: "You choose", title: "Interview in one,\n*notes in another.*",
      script: [{ at: 0.25, scroll: { sel: "label, p, span", text: "Interview language" }, offset: fmt.portrait ? 200 : 260, dur: 1 }, { at: 0.4, select: { sel: "select", nth: 2 }, value: "es" }, { at: 0.75, select: { sel: "select", nth: 3 }, value: "en" }] }),
  ], v, 11.85, { cover: 5.7, quiet: [[0, 2.7]] });
}

// ── 8. Offer AI ────────────────────────────────────────────────────────────────────────────────────────────────
export function fOffer(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-offer.0", 0.3), line("f-offer.1", 1.9)];
  const b = v[1]!;
  const pl = placement(fmt);
  const id = "offer";
  const planAt = when(b, "ask") + 0.1;
  const presses: Press[] = [press(id, planAt, { text: "Make my plan" }, 0.7)];
  const T = (x: number) => x - 1.6 + 0.3;
  const frame: FrameSpec = {
    id, path: `/offers/${IDS.offer}`, flow: "offer", viewport: pl.vp, from: 1.3, to: 12.75, delays: { [`POST /v1/offers/${IDS.offer}/plan`]: 900 },
    script: [
      { at: 0, css: HIDE_TOASTS },
      { at: T(when(b, "reaches")), scroll: { sel: "h2, h3", text: "In your account each month" }, offset: fmt.portrait ? 120 : 140, dur: 800 },
      { at: T(when(b, "market")) - 0.2, scroll: { sel: "h2, h3", text: "Against the market" }, offset: fmt.portrait ? 160 : 260, dur: 900 },
      { at: T(planAt) - 1.0, scroll: { sel: "h2, h3", text: "Your negotiation" }, offset: fmt.portrait ? 260 : 380, dur: 700 },
      ...stepsOf(presses, 1.3),
      { at: T(planAt) + 1.4, scroll: { sel: "p, h3, span", text: "Ask for" }, offset: fmt.portrait ? 140 : 160, dur: 900 },
      { at: T(when(b, "call")), scroll: { sel: "p, h3, h4", text: "On the call" }, offset: fmt.portrait ? 140 : 160, dur: 900 },
      { at: T(when(b, "email.")) - 0.2, scroll: { sel: "p, h3, h4", text: "The email after" }, offset: fmt.portrait ? 120 : 140, dur: 900 },
    ],
    layout: camera(pl, [{ t: 1.6, z: 1 }, { t: 12.7, z: 1.04 }], { enter: [1.3, 2.1], from: "rise", exit: [12.3, 12.75], to: "left" }),
  };
  return film(fmt, "f-offer", [
    hookShot(fmt, { from: 0, to: 1.8, text: "Got an *offer?*", eyebrow: "Offer AI" }),
    stop({ id, fmt, from: 1.6, to: 12.7, frames: [frame], presses, cues: [{ t: 1.5, kind: "whoosh", dur: 0.6 }, { t: planAt + 1.0, kind: "chime", gain: 0.6 }],
      draw: (t) => <TitleBlock fmt={fmt} t={t} at={1.65} out={12.3} eyebrow="Offer AI" title={"What it's worth,\n*and what to ask.*"} /> }),
  ], v, 12.6, { cover: 9.6, quiet: [[0, 1.75]] });
}

// ── 9. Learning AI and KashSec Academy ─────────────────────────────────────────────────────────────────────────
function KashSecCard({ fmt, t, at, out }: { fmt: Fmt; t: number; at: number; out: number }) {
  const p = ep(t, at, at + 0.7, out4);
  const o = p * (1 - ep(t, out - 0.4, out));
  if (o <= 0) return null;
  const teal = "#0d9488";
  const s = fs(fmt, 1, fmt.id === "9x16" ? 1.12 : 1, 1);
  const chips = ["Course paths", "Hands-on labs", "Interview bank", "Timed mock exam"];
  return (
    <div style={abs({ left: 70, right: 70, top: fmt.id === "9x16" ? 1010 : fmt.id === "4x5" ? 760 : 600, zIndex: 44, opacity: o, transform: `translateY(${(1 - p) * 60}px)` })}>
      <div style={{ background: "#fff", borderRadius: 28 * s, padding: `${34 * s}px ${36 * s}px`, boxShadow: "0 0 0 1px rgba(13,148,136,0.25), 0 40px 80px -30px rgba(13,40,60,0.35)", borderTop: `${5 * s}px solid ${teal}` }}>
        <div style={{ font: `600 ${24 * s}px/1 ${FONT}`, color: teal, display: "flex", alignItems: "center", gap: 10 }}>
          <svg width={26 * s} height={26 * s} viewBox="0 0 24 24" fill="none" stroke={teal} strokeWidth="2"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          Free from the Orbit team
        </div>
        <div style={{ font: `600 ${50 * s}px/1.1 ${FONT}`, color: INK, letterSpacing: "-0.025em", marginTop: 18 * s }}>KashSec Academy</div>
        <div style={{ font: `400 ${27 * s}px/1.4 ${FONT}`, color: INK3, marginTop: 12 * s }}>Free cybersecurity education for complete beginners. Start from zero, learn by doing, and reach a real career.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 * s, marginTop: 22 * s }}>
          {chips.map((c, i) => {
            const q = ep(t, at + 0.4 + i * 0.12, at + 0.8 + i * 0.12, out4);
            return (
              <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: `${11 * s}px ${17 * s}px`, borderRadius: 999, border: "1px solid rgba(20,22,45,0.14)", font: `500 ${23 * s}px/1 ${FONT}`, color: INK, opacity: q, transform: `scale(${0.9 + 0.1 * q})` }}>
                <span style={{ width: 9 * s, height: 9 * s, borderRadius: 99, background: teal }} />{c}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 24 * s, font: `600 ${28 * s}px/1 ${FONT}`, color: teal }}>kashsec.vercel.app</div>
      </div>
    </div>
  );
}

export function fLearning(fmt: Fmt, _o: FilmOptions): Film {
  const v = [line("f-learning.0", 0.3), line("f-learning.1", 2.75), line("f-learning.2", 7.65)];
  const k = v[2]!;
  const learnFrom = when(k, "and") - 0.2;
  const ks: Scene = {
    id: "ks", from: learnFrom, to: 17.15, cues: [{ t: when(k, "kashsec") - 0.1, kind: "sparkle", gain: 0.6 }],
    render: (t) => <KashSecCard fmt={fmt} t={t} at={when(k, "free:") - 0.25} out={17.15} />,
  };
  return film(fmt, "f-learning", [
    hookShot(fmt, { from: 0, to: 2.6, text: fmt.id === "9x16" ? "Learn the skills\n*interviews test.*" : "Learn the skills\n*interviews test.*", eyebrow: "Learning AI" }),
    simpleScreen(fmt, { id: "code", from: 2.45, to: learnFrom + 0.15, path: "/code", eyebrow: "Code AI", title: "Coding rounds,\n*by pattern.*", script: [{ at: 1.2, scroll: { sel: "h2, h3, p, span", text: "Two pointers" }, offset: fmt.portrait ? 220 : 260, dur: 1200 }] }),
    simpleScreen(fmt, { id: "learn", from: learnFrom, to: 17.15, path: "/learn", eyebrow: "Learning AI", title: "And cybersecurity,\n*free.*", script: [{ at: 0.4, scroll: { sel: "h2, h3, p", text: "KashSec Academy" }, offset: fmt.portrait ? 140 : 200, dur: 900 }] }),
    ks,
  ], v, 17.0, { cover: 13.0, quiet: [[0, 2.55]] });
}

export const _f = { ACCENT, INK, ANSWER, LIVE_HISTORY, ScoreCard, jobsStop, Backdrop };
