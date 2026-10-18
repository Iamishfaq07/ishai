// The product scenes: real Orbit screens (app frames) with a camera, words and a cursor. Each takes its place on the
// film's clock (from, to) and the format, so the launch film, its cuts and the feature films share them.
import type { Ctx, Fmt, FrameSpec, Scene } from "../engine";
import { clamp, ep, inOut, keys, lerp, out3, out4, outBack, prog } from "../anim";
import { ANSWER, IDS, LIVE_HISTORY, liveScript } from "../content";
import { ACCENT, Backdrop, Eyebrow, FONT, INK, INK3, Spot, Words, abs, fs } from "../ui";
import { HIDE_TOASTS, LAYOUT, TitleBlock, camera, placement, press, stepsOf, stop, type Press } from "./kit";

type Range = { from: number; to: number };
const ENTER = 0.7;

/** Resume AI: the draft's ATS score, Fix everything with AI, the skills it may add confirmed, the score at the top. */
export type ResumeTimes = { tab: number; scroll: number; fix: number; add1: number; add2: number; top: number; zoom: number; fixDelay: number };
const RESUME_TIMES: ResumeTimes = { tab: 0.9, scroll: 1.45, fix: 2.3, add1: 3.75, add2: 4.3, top: 4.75, zoom: 4.6, fixDelay: 1000 };

export function resumeStop(fmt: Fmt, r: Range & { title?: string; eyebrow?: string; full?: boolean; titleOut?: number; times?: Partial<ResumeTimes>; speed?: number }): Scene {
  const { from, to } = r;
  const phone = fmt.portrait;
  const pl = placement(fmt);
  const id = `resume-${from}`;
  const T = (x: number) => from + x;
  const k = { ...RESUME_TIMES, ...r.times };
  const presses: Press[] = [
    press(id, T(k.tab), { sel: "[role=tab]", text: "ATS score" }),
    press(id, T(k.fix), { text: "Fix everything with AI" }),
    press(id, T(k.add1), { text: "Add all" }),
    press(id, T(k.add2), { text: "Add all" }),
  ];
  const vp = pl.vp;
  const frame: FrameSpec = {
    id, path: `/resume-ai/${IDS.draft}`, flow: "resume", viewport: vp, from: from - 0.2, to, bar: fmt.id === "16x9", speed: r.speed,
    delays: { "POST /v1/resumes/fix": k.fixDelay },
    script: [
      { at: 0.0, css: HIDE_TOASTS },
      ...stepsOf(presses, from - 0.2),
      { at: T(k.scroll) - (from - 0.2), scroll: { text: "Fix everything with AI", sel: "button" }, offset: phone ? 260 : 330, dur: 650 },
      { at: T(k.top) - (from - 0.2), scroll: 0, dur: 700 },
    ],
    layout: camera(pl, phone
      ? [{ t: from, z: 1 }, { t: to, z: 1.04 }]
      : [{ t: from, z: 1 }, { t: T(k.scroll + 0.15), z: 1 }, { t: T(k.fix + 0.1), z: 1.26, fx: 420, fy: 470 }, { t: T(k.zoom), z: 1.26, fx: 420, fy: 470 }, { t: T(k.zoom + 0.9), z: 1.75, fx: 690, fy: 150 }, { t: to, z: 1.82, fx: 690, fy: 150 }],
      { enter: [from - 0.2, from + ENTER], from: fmt.id === "16x9" ? "right" : "rise", exit: [to - 0.45, to], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame], presses,
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.7 }, { t: T(k.fix + k.fixDelay / 1000 + 0.05), kind: "chime", gain: 0.6 }, { t: T(k.add2 + 0.1), kind: "pop", gain: 0.8 }],
    draw: (t) => (
      <TitleBlock fmt={fmt} t={t} at={from + 0.1} out={r.titleOut ?? (fmt.id === "16x9" ? T(k.zoom - 0.15) : to - 0.5)} eyebrow={r.eyebrow ?? "Resume AI"} title={r.title ?? (fmt.id === "16x9" ? "Your ATS score,\nout of 100.\n*Fixed with AI.*" : "Your ATS score.\n*Fixed with AI.*")} />
    ),
  });
}

/** Jobs AI: matches from careers pages with their fit, then the tracker board. */
export function jobsStop(fmt: Fmt, r: Range & { title?: string; trackerAt?: number }): Scene {
  const { from, to } = r;
  const phone = fmt.portrait;
  const pl = placement(fmt);
  const id = `jobs-${from}`;
  const tr = `tracker-${from}`;
  const swap = r.trackerAt ?? from + (to - from) * 0.55;
  const matches: FrameSpec = {
    id, path: "/jobs/matches", viewport: pl.vp, from: from - 0.2, to: swap + 0.8, bar: fmt.id === "16x9",
    script: [{ at: 1.3, scroll: { sel: "h3, h2, a", text: "Product Analyst, Payments" }, offset: phone ? 120 : 180, dur: 1400 }],
    layout: camera(pl, phone
      ? [{ t: from, z: 1 }, { t: from + 1.2, z: 1 }, { t: swap, z: 1.12, fy: 380 }]
      : [{ t: from, z: 1 }, { t: from + 1.2, z: 1 }, { t: swap, z: 1.32, fx: 760, fy: 300 }],
      { enter: [from - 0.2, from + ENTER], from: fmt.id === "16x9" ? "right" : "rise", exit: [swap, swap + 0.8], to: "back" }),
  };
  const tracker: FrameSpec = {
    id: tr, path: "/jobs/tracker", viewport: pl.vp, from: swap - 0.3, to, bar: fmt.id === "16x9",
    script: phone ? [{ at: 0.4, scroll: { sel: "h2, h3, p, span", text: "Saved" }, offset: 140, dur: 1 }] : [{ at: 0.3, scroll: { sel: "span, p, h2, h3", text: "Saved" }, offset: 120, dur: 1 }],
    layout: camera(pl, [{ t: swap, z: 1.04 }, { t: to, z: 1.12 }], { enter: [swap - 0.1, swap + 0.75], from: "right", exit: [to - 0.45, to], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [matches, tracker],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.7 }, { t: swap - 0.05, kind: "swish", dur: 0.6 }],
    draw: (t) => (
      <TitleBlock fmt={fmt} t={t} at={from + 0.1} out={to - 0.5} eyebrow="Jobs AI" title={r.title ?? (fmt.id === "16x9" ? "Jobs that fit you,\nfrom companies'\n*own careers pages.*" : "Jobs that fit you,\n*from careers pages.*")} />
    ),
  });
}

/** Practice: the AI interviewer asks out loud, you answer; then the round's review. */
export function practiceStop(fmt: Fmt, r: Range & { reviewAt?: number; title?: string }): Scene {
  const { from, to } = r;
  const pl = placement(fmt);
  const id = `mock-${from}`;
  const rv = `review-${from}`;
  const swap = r.reviewAt ?? from + (to - from) * 0.5;
  const Q = "Tell me about a time you used data to change a product decision.";
  const room: FrameSpec = {
    id, path: `/live/${IDS.liveMock}`, flow: "live", viewport: pl.vp, from: from - 0.2, to: swap + 0.8, bar: fmt.id === "16x9",
    historyState: { usr: {}, key: "demo", idx: 0 },
    script: [
      { at: 0.02, hide: { sel: "summary", text: "Critique architecture" } },
      { at: 0.03, css: "[class*='Dev'] {}" },
      { at: 0.05, live: "emit", data: { type: "transcript.final", data: { turn_id: "m1", speaker: "interviewer", text: `Thanks for joining. To start, ${Q.toLowerCase()}`, start_ms: 0, end_ms: 0 } } },
      { at: 0.06, live: "emit", data: { type: "mock.question", data: { question_id: "mq1", text: `Thanks for joining. To start, ${Q.toLowerCase()}`, concept_depth: 1, is_follow_up: false, index: 1, total: 6, question_type: "behavioral" } } },
      { at: 1.9, live: "speak", data: { turn_id: "m2", text: "At Juniper Logistics most late deliveries came from the date we promised at checkout, so I built a delivery-time model" }, dur: 2600 },
    ],
    layout: camera(pl, [{ t: from, z: 1 }, { t: swap, z: 1.1, fy: pl.vp[1] * 0.38 }], { enter: [from - 0.2, from + ENTER], from: fmt.id === "16x9" ? "right" : "rise", exit: [swap, swap + 0.8], to: "back" }),
  };
  const review: FrameSpec = {
    id: rv, path: `/sessions/${IDS.mockReview}`, viewport: pl.vp, from: swap - 0.3, to, bar: fmt.id === "16x9",
    script: [{ at: 0.35, scroll: { sel: "p, span, h2, h3", text: "Strong" }, offset: fmt.portrait ? 160 : 210, dur: 900 }],
    layout: camera(pl, [{ t: swap, z: 1.02 }, { t: to, z: fmt.portrait ? 1.06 : 1.14 }], { enter: [swap - 0.1, swap + 0.75], from: "right", exit: [to - 0.45, to], to: "left" }),
  };
  return stop({
    id, fmt, from, to, frames: [room, review],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.7 }, { t: from + 0.3, kind: "voicebed", dur: 1.6 }, { t: swap - 0.05, kind: "swish", dur: 0.6 }, { t: swap + 0.9, kind: "chime", gain: 0.5 }],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={from + 0.1} out={to - 0.5} eyebrow="Practice" title={r.title ?? (fmt.id === "16x9" ? "Practise out loud.\n*Get a review*\nafter every round." : "Practise out loud.\n*Get a review.*")} />,
  });
}

/** Interview day: the tracked job's Interview tab, and the copilot started with it. */
export function dayStop(fmt: Fmt, r: Range & { title?: string }): Scene {
  const { from, to } = r;
  const pl = placement(fmt);
  const id = `day-${from}`;
  const presses: Press[] = [press(id, to - 0.75, { text: "Start copilot for this interview" }, 0.9)];
  const frame: FrameSpec = {
    id, path: `/jobs/mission/${IDS.tracker["Kestrel Pay"]}?tab=interview`, viewport: pl.vp, from: from - 0.2, to: to + 0.1, bar: fmt.id === "16x9",
    script: fmt.portrait ? [{ at: 0.6, scroll: { sel: "h2, h3, p", text: "Your interview" }, offset: 170, dur: 900 }] : [],
    layout: camera(pl, fmt.portrait
      ? [{ t: from, z: 1 }, { t: to, z: 1.1, fy: 420 }]
      : [{ t: from, z: 1 }, { t: from + 1.2, z: 1.0 }, { t: to - 0.6, z: 1.42, fx: 470, fy: 330 }, { t: to + 0.1, z: 2.3, fx: 470, fy: 330, e: (x) => x * x }],
      { enter: [from - 0.2, from + ENTER], from: fmt.id === "16x9" ? "right" : "rise", exit: [to - 0.25, to + 0.1], to: "back" }),
  };
  return stop({
    id, fmt, from, to, frames: [frame], presses,
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.7 }],
    draw: (t) => <TitleBlock fmt={fmt} t={t} at={from + 0.1} out={to - 0.5} eyebrow="Interview day" title={r.title ?? (fmt.id === "16x9" ? "Your prep and the job\n*come with you.*" : "Your prep comes\n*with you.*")} />,
  });
}

/** The live session: the question heard, an answer from the resume, its key points ticking off. */
export function liveHero(fmt: Fmt, r: Range & { ask?: number; say?: number; answer?: number; title?: string; eyebrow?: string; honest?: number; dark?: boolean; zoomTo?: number }): Scene {
  const { from, to } = r;
  const id = `live-${from}`;
  const ask = r.ask ?? 1.6;
  const say = r.say ?? 2.6;
  const ansDur = r.answer ?? 4.0;
  const dark = r.dark ?? true;
  const land = fmt.id === "16x9";
  const sq = fmt.id === "1x1" && LAYOUT.phoneSquare;
  const vp: [number, number] = land ? [1280, 800] : sq ? [600, 860] : fmt.id === "1x1" ? [1100, 860] : [600, 1000];
  const base = land ? { sx: 1338, sy: 556, scale: 0.98 } : sq ? { sx: 540, sy: 330 + 537, scale: 1.25 } : fmt.id === "1x1" ? { sx: 540, sy: 330 + 370, scale: 0.86 } : fmt.id === "9x16" ? { sx: 540, sy: 600 + 810, scale: 1.62 } : { sx: 540, sy: 330 + 700, scale: 1.4 };
  const qT = from + ask + say;
  const z1 = land ? 1.32 : 1.18;
  const frame: FrameSpec = {
    id, path: `/live/${IDS.liveInterview}`, flow: "live", viewport: vp, from: from - 0.25, to: to + 0.05, historyState: LIVE_HISTORY,
    script: liveScript(ask + 0.25, { say, answer: ansDur }),
    layout: camera({ vp, p: base }, land
      ? [{ t: from, z: 0.94 }, { t: qT, z: 1.0, fx: 640, fy: 380 }, { t: qT + ansDur * 0.8, z: z1, fx: 560, fy: 420 }, { t: r.zoomTo ?? to - 1.4, z: z1 + 0.06, fx: 520, fy: 520 }, { t: to, z: z1, fx: 560, fy: 470 }]
      : [{ t: from, z: 1 }, { t: to, z: 1.03 }],
      { enter: [from - 0.25, from + 0.8], from: "rise", exit: [to - 0.4, to + 0.05], to: "back", lift: 1.2, anchorTop: !land }),
  };
  const honest = r.honest ?? from + 1.1;
  return {
    id, from, to, frames: [frame],
    cues: [
      { t: from - 0.15, kind: "whoosh", dur: 0.8 }, { t: from + ask + 0.25, kind: "voicebed", dur: say }, { t: qT + 0.4, kind: "detect", gain: 0.8 },
      { t: qT + 0.6, kind: "stream", dur: ansDur }, { t: qT + 0.6 + ansDur + 0.2, kind: "chime", gain: 0.55 },
      ...[0, 1, 2].map((k) => ({ t: qT + ansDur + 1.3 + k * 1.05, kind: "tick", gain: 0.55 })),
    ],
    render: (t) => (
      <>
        <Backdrop fmt={fmt} mode={dark ? "ink" : "mist"} t={t} z={1} />
        <div style={abs({ left: land ? 1240 - 700 : 0, top: land ? 0 : 0, width: land ? 1400 : fmt.w, height: fmt.h, zIndex: 2, background: `radial-gradient(closest-side, rgba(112,72,245,${dark ? 0.32 : 0.12}), transparent 75%)`, opacity: ep(t, from, from + 1.2) })} />
        <TitleBlock fmt={fmt} t={t} at={from + 0.2} out={to - 0.55} dark={dark} eyebrow={r.eyebrow ?? "Interview copilot"} title={r.title ?? (land ? "Answer notes\nfrom *your own*\nresume. Live." : "Answer notes from\n*your own* resume.")} size={fs(fmt, 66, 62, 56)} />
        <div style={abs({ left: land ? 104 : 0, right: land ? undefined : 0, top: land ? 660 : fmt.id === "9x16" ? fmt.safe.t + 252 : fmt.id === "4x5" ? 262 : 262, width: land ? 520 : undefined, zIndex: 31, textAlign: land ? "left" : "center", font: `500 ${fs(fmt, 24, 28, 25)}px/1.35 ${FONT}`, color: dark ? "rgba(255,255,255,0.62)" : INK3, opacity: ep(t, honest, honest + 0.6) * (1 - ep(t, to - 0.55, to - 0.1)) })}>
          For interviews and calls where AI help is allowed.
        </div>
      </>
    ),
  };
}

/** The same session, in other interview languages: a question and its answer in each, one after another. */
export const LANGS: Array<{ code: string; label: string; q: string; a: string; points: string[] }> = [
  {
    code: "es", label: "Español",
    q: "Cuéntame de una vez en que usaste datos para cambiar una decisión de producto.",
    a: "En Juniper Logistics, la mayoría de las entregas tardías venían de la fecha que prometíamos al pagar. Construí un modelo de tiempos de entrega, mostré que una ventana de entrega sería más honesta que una sola fecha y lo propuse a producto. Lo probamos, se lanzó y las entregas tardías bajaron un 18 % en dos trimestres.",
    points: ["La fecha prometida al pagar", "El modelo de tiempos de entrega", "La propuesta a producto", "18 % menos entregas tardías"],
  },
  {
    code: "hi", label: "हिन्दी",
    q: "मुझे ऐसे समय के बारे में बताइए जब आपने डेटा से किसी प्रोडक्ट फ़ैसले को बदला।",
    a: "Juniper Logistics में ज़्यादातर देर से होने वाली डिलीवरी उस तारीख़ की वजह से थीं जो हम चेकआउट पर दिखाते थे। मैंने डिलीवरी-टाइम मॉडल बनाया, दिखाया कि एक तारीख़ की जगह डिलीवरी विंडो ज़्यादा सही रहेगी, और प्रोडक्ट टीम के सामने यह बात रखी। हमने इसे टेस्ट किया, यह लॉन्च हुआ, और दो तिमाहियों में देर से होने वाली डिलीवरी 18% कम हो गईं।",
    points: ["चेकआउट पर दिखाई गई तारीख़", "डिलीवरी-टाइम मॉडल", "प्रोडक्ट टीम को सुझाव", "18% कम देरी"],
  },
  {
    code: "ja", label: "日本語",
    q: "データを使ってプロダクトの意思決定を変えた経験を教えてください。",
    a: "Juniper Logistics では、配送遅延の多くがチェックアウトで約束していた日付に原因がありました。私は配送時間のモデルを作り、単一の日付よりも配送時間帯で示す方が正確だと示して、プロダクトチームに提案しました。テストを経て正式に導入され、2四半期で配送遅延が18%減りました。",
    points: ["チェックアウトでの約束", "配送時間モデルの構築", "プロダクトへの提案", "配送遅延を18%削減"],
  },
  {
    code: "fr", label: "Français",
    q: "Parlez-moi d'une fois où vous avez utilisé des données pour changer une décision produit.",
    a: "Chez Juniper Logistics, la plupart des retards de livraison venaient de la date promise au paiement. J'ai construit un modèle de délais de livraison, montré qu'une fenêtre de livraison serait plus honnête qu'une date unique, et défendu l'idée auprès de l'équipe produit. Nous l'avons testée, elle a été déployée, et les retards ont baissé de 18 % en deux trimestres.",
    points: ["La date promise au paiement", "Le modèle de délais", "La proposition au produit", "18 % de retards en moins"],
  },
  {
    code: "de", label: "Deutsch",
    q: "Erzählen Sie mir von einem Mal, als Sie mit Daten eine Produktentscheidung verändert haben.",
    a: "Bei Juniper Logistics kamen die meisten verspäteten Lieferungen von dem Datum, das wir beim Checkout versprochen haben. Ich habe ein Lieferzeitmodell gebaut, gezeigt, dass ein Lieferfenster ehrlicher wäre als ein einzelnes Datum, und das dem Produktteam vorgeschlagen. Wir haben es getestet, es wurde eingeführt, und verspätete Lieferungen sanken in zwei Quartalen um 18 %.",
    points: ["Das Versprechen beim Checkout", "Das Lieferzeitmodell", "Der Vorschlag ans Produktteam", "18 % weniger Verspätungen"],
  },
  {
    code: "pt", label: "Português",
    q: "Conte-me sobre uma vez em que você usou dados para mudar uma decisão de produto.",
    a: "Na Juniper Logistics, a maioria das entregas atrasadas vinha da data que prometíamos no checkout. Construí um modelo de prazo de entrega, mostrei que uma janela de entrega seria mais honesta do que uma data única e levei a proposta ao time de produto. Testamos, foi lançado, e as entregas atrasadas caíram 18% em dois trimestres.",
    points: ["A data prometida no checkout", "O modelo de prazo de entrega", "A proposta ao produto", "18% menos atrasos"],
  },
];
export const ALL_LANGS = ["English", "हिन्दी", "Hinglish", "Español", "Français", "Deutsch", "Português", "Italiano", "Nederlands", "日本語", "Русский"];

/** Script steps: each language's question and answer at `times` (seconds after the frame opens). */
export function languageSteps(langs: typeof LANGS, times: number[], answerDur = 0.9) {
  const steps: Array<Record<string, unknown> & { at: number }> = [
    { at: 0.02, click: { text: "Share tab audio" } },
    { at: 0.03, hide: { sel: "summary", text: "Critique architecture" } },
    { at: 0.04, shiftClock: (14 * 60 + 2) * 1000 },
  ];
  langs.forEach((l, i) => {
    const at = times[i]!;
    const qid = `lq${i}`;
    steps.push({ at, live: "emit", data: { type: "transcript.final", data: { turn_id: `lt${i}`, speaker: "interviewer", text: l.q, start_ms: 0, end_ms: 2000 } } });
    steps.push({ at: at + 0.05, live: "emit", data: { type: "question.detected", data: { question_id: qid, turn_id: `lt${i}`, text: l.q, type: "behavioral", confidence: 0.95, is_follow_up: false } } });
    steps.push({ at: at + 0.12, live: "answer", data: { answer_id: `la${i}`, question_id: qid, answer: { ...ANSWER, question: l.q, direct_answer: l.a, key_points: l.points, follow_up: null, sources: ANSWER.sources } }, dur: answerDur * 1000 });
  });
  return steps;
}

export function languagesShot(fmt: Fmt, r: Range & { times?: number[]; langs?: typeof LANGS; title?: string; dark?: boolean; answerDur?: number }): Scene {
  const { from, to } = r;
  const id = `langs-${from}`;
  const langs = r.langs ?? LANGS.slice(0, 3);
  const times = r.times ?? langs.map((_, i) => 0.35 + i * ((to - from - 0.6) / langs.length));
  const land = fmt.id === "16x9";
  const sq = fmt.id === "1x1" && LAYOUT.phoneSquare;
  const vp: [number, number] = land ? [1280, 800] : sq ? [600, 860] : fmt.id === "1x1" ? [1100, 860] : [600, 1000];
  const base = land ? { sx: 1338, sy: 556, scale: 1.0 } : sq ? { sx: 540, sy: 372 + 537, scale: 1.25 } : fmt.id === "1x1" ? { sx: 540, sy: 700, scale: 0.84 } : fmt.id === "9x16" ? { sx: 540, sy: 760 + 800, scale: 1.6 } : { sx: 540, sy: 440 + 700, scale: 1.4 };
  const frame: FrameSpec = {
    id, path: `/live/${IDS.liveInterview}`, flow: "live", viewport: vp, from: from - 0.25, to: to + 0.05, historyState: LIVE_HISTORY,
    script: languageSteps(langs, times.map((x) => x + 0.25), r.answerDur ?? 0.9),
    layout: camera({ vp, p: base }, land ? [{ t: from, z: 1.12, fx: 560, fy: 330 }, { t: to, z: 1.2, fx: 560, fy: 360 }] : [{ t: from, z: 1 }, { t: to, z: 1.03 }], { enter: [from - 0.25, from + 0.6], from: "rise", exit: [to - 0.4, to + 0.05], to: "back", anchorTop: !land }),
  };
  const dark = r.dark ?? false;
  return {
    id, from, to, frames: [frame],
    cues: [{ t: from - 0.15, kind: "whoosh", dur: 0.7 }, ...times.map((x) => ({ t: from + x + 0.5, kind: "tick", gain: 0.8 }))],
    render: (t) => {
      // The chip moves when the answer in that language starts to show, not when the question is asked.
      const cur = Math.max(0, times.filter((x) => t >= from + x + 0.5).length - 1);
      const label = langs[cur]!.label;
      return (
        <>
          <Backdrop fmt={fmt} mode={dark ? "ink" : "light"} t={t} z={1} />
          <TitleBlock fmt={fmt} t={t} at={from + 0.1} out={to - 0.5} dark={dark} eyebrow="10 interview languages" title={r.title ?? (land ? "The interview,\nin *its* language." : "In *its* language.")} size={fs(fmt, 64, 62, 56)} />
          <LangChips fmt={fmt} t={t} from={from} to={to} active={label} dark={dark} />
        </>
      );
    },
  };
}

function LangChips({ fmt, t, from, to, active, dark }: { fmt: Fmt; t: number; from: number; to: number; active: string; dark: boolean }) {
  const land = fmt.id === "16x9";
  const size = fs(fmt, 22, 26, 21);
  return (
    <div style={abs({ left: land ? 104 : 60, right: land ? undefined : 60, top: land ? 640 : fmt.id === "9x16" ? fmt.safe.t + 262 : fmt.id === "4x5" ? 268 : 262, width: land ? 560 : undefined, zIndex: 31, display: "flex", flexWrap: "wrap", gap: size * 0.45, justifyContent: land ? "flex-start" : "center" })}>
      {ALL_LANGS.map((l, i) => {
        const p = ep(t, from + 0.3 + i * 0.05, from + 0.8 + i * 0.05, outBack);
        const on = l === active;
        return (
          <span key={l} style={{ padding: `${size * 0.36}px ${size * 0.7}px`, borderRadius: 999, font: `600 ${size}px/1 ${FONT}`, opacity: p * (1 - ep(t, to - 0.5, to - 0.1)), transform: `scale(${0.8 + 0.2 * p})`,
            background: on ? ACCENT : dark ? "rgba(255,255,255,0.08)" : "#fff", color: on ? "#fff" : dark ? "rgba(255,255,255,0.8)" : INK, border: `1px solid ${on ? ACCENT : dark ? "rgba(255,255,255,0.14)" : "rgba(20,22,45,0.12)"}`, boxShadow: on ? "0 8px 24px -8px rgba(112,72,245,0.6)" : "none" }}>
            {l}
          </span>
        );
      })}
    </div>
  );
}

/** "On Windows, and on the web": the compact panel beside a call, then the browser. */
export function windowsShot(fmt: Fmt, r: Range & { webAt?: number }): Scene {
  const { from, to } = r;
  const id = `win-${from}`;
  const web = `web-${from}`;
  const webAt = r.webAt ?? from + (to - from) * 0.5;
  const land = fmt.id === "16x9";
  const compactVp: [number, number] = [420, 600];
  const cBase = land ? { sx: 1420, sy: 545, scale: 1.18 } : fmt.id === "1x1" ? { sx: 760, sy: 600, scale: 1.0 } : fmt.id === "9x16" ? { sx: 540, sy: 860 + 465, scale: 1.55 } : { sx: 700, sy: 800, scale: 1.18 };
  const steps = [
    { at: 0.02, click: { text: "Share tab audio" } },
    { at: 0.03, hide: { sel: "summary", text: "Critique architecture" } },
    { at: 0.04, shiftClock: (15 * 60 + 10) * 1000 },
    { at: 0.05, live: "emit", data: { type: "transcript.final", data: { turn_id: "w1", speaker: "interviewer", text: "Tell me about a time you used data to change a product decision.", start_ms: 0, end_ms: 2000 } } },
    { at: 0.06, live: "emit", data: { type: "question.detected", data: { question_id: "wq", turn_id: "w1", text: ANSWER.question, type: "behavioral", confidence: 0.96, is_follow_up: false } } },
    { at: 0.07, live: "answer", data: { answer_id: "wa", question_id: "wq", answer: ANSWER }, dur: 300 },
  ];
  const compact: FrameSpec = {
    id, path: `/live/${IDS.liveInterview}`, flow: "live", viewport: compactVp, from: from - 0.25, to: to + 0.05, historyState: LIVE_HISTORY,
    storage: { "orbit.web.panelMode": "compact" }, script: steps,
    layout: camera({ vp: compactVp, p: cBase }, [{ t: from, z: 1 }, { t: to, z: 1.04 }], { enter: [from - 0.15, from + 0.6], from: "rise", exit: [webAt + 0.1, webAt + 0.7], to: "back", lift: 1.1 }),
  };
  const bVp: [number, number] = [1280, 800];
  const bBase = land ? { sx: 960, sy: 560, scale: 1.08 } : fmt.id === "1x1" ? { sx: 540, sy: 600, scale: 0.78 } : { sx: 540, sy: fmt.id === "9x16" ? 1060 : 760, scale: 0.8 };
  const browser: FrameSpec = {
    id: web, path: `/live/${IDS.liveInterview}`, flow: "live", viewport: bVp, from: webAt - 0.3, to: to + 0.05, historyState: LIVE_HISTORY, bar: true, script: steps,
    layout: camera({ vp: bVp, p: bBase }, [{ t: webAt, z: 1 }, { t: to, z: 1.05 }], { enter: [webAt - 0.1, webAt + 0.7], from: "bottom", exit: [to - 0.35, to + 0.05], to: "back" }),
  };
  return {
    id, from, to, frames: [compact, browser],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.6 }, { t: webAt - 0.05, kind: "swish", dur: 0.6 }],
    render: (t) => (
      <>
        <Desktop fmt={fmt} t={t} from={from} webAt={webAt} />
        <WinTitle fmt={fmt} t={t} from={from} webAt={webAt} base={cBase} vp={compactVp} />
        <div style={abs({ left: 0, right: 0, top: land ? 54 : fmt.id === "9x16" ? fmt.safe.t + 10 : 60, zIndex: 40, display: "flex", justifyContent: "center", gap: 14 })}>
          <Eyebrow text="Windows app" t={t} at={from + 0.15} out={webAt - 0.1} size={fs(fmt, 26, 30, 28)} dark />
        </div>
        <div style={abs({ left: 0, right: 0, top: land ? 54 : fmt.id === "9x16" ? fmt.safe.t + 10 : 60, zIndex: 40, display: "flex", justifyContent: "center" })}>
          <Eyebrow text="On the web: orbitanswer.com" t={t} at={webAt + 0.15} out={to - 0.4} size={fs(fmt, 26, 30, 28)} />
        </div>
      </>
    ),
  };
}

/** A calm desktop behind the Windows app: a wallpaper, a taskbar, and a video call (initials, no faces). */
function Desktop({ fmt, t, from, webAt }: { fmt: Fmt; t: number; from: number; webAt: number }) {
  const land = fmt.id === "16x9";
  const o = ep(t, from - 0.2, from + 0.4);
  const call = land ? { x: 120, y: 150, w: 980, h: 720 } : fmt.id === "1x1" ? { x: 50, y: 170, w: 600, h: 520 } : fmt.id === "9x16" ? { x: 90, y: 340, w: 900, h: 470 } : { x: 50, y: 220, w: 560, h: 520 };
  const speaking = 0.5 + 0.5 * Math.sin(t * 9) * Math.sin(t * 3.1);
  return (
    <div style={abs({ inset: 0, zIndex: 1, opacity: o })}>
      <div style={abs({ inset: 0, background: "radial-gradient(120% 90% at 20% 10%, #2b2f6b 0%, #171a3d 40%, #0c0e22 100%)" })} />
      <div style={abs({ inset: 0, background: "radial-gradient(60% 50% at 80% 80%, rgba(34,211,238,0.18), transparent 70%), radial-gradient(50% 40% at 30% 70%, rgba(134,102,255,0.22), transparent 70%)" })} />
      {/* the call */}
      <div style={abs({ left: call.x, top: call.y, width: call.w, height: call.h, borderRadius: 12, background: "#1b1d26", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)", overflow: "hidden", opacity: 1 - ep(t, webAt, webAt + 0.6) })}>
        <div style={{ height: 38, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: "#14161e", color: "rgba(255,255,255,0.7)", font: `500 15px/1 ${FONT}` }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: "#ef4444" }} /> Kestrel Pay · Hiring manager round
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>15:{String(10 + Math.floor(t - from)).padStart(2, "0")}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: 12, height: call.h - 38 - 70 }}>
          {[{ n: "PM", label: "Interviewer", on: true }, { n: "AR", label: "You", on: false }].map((p) => (
            <div key={p.n} style={{ borderRadius: 10, background: "#262938", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: call.w * 0.14, height: call.w * 0.14, borderRadius: 999, background: p.on ? "linear-gradient(135deg,#8666FF,#22D3EE)" : "#3a3e52", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", font: `600 ${call.w * 0.045}px/1 ${FONT}`, boxShadow: p.on ? `0 0 0 ${4 + speaking * 8}px rgba(134,102,255,0.25)` : "none" }}>{p.n}</div>
              <span style={abs({ left: 12, bottom: 10, color: "rgba(255,255,255,0.75)", font: `500 14px/1 ${FONT}` })}>{p.label}</span>
            </div>
          ))}
        </div>
        <div style={{ height: 70, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          {["#3a3e52", "#3a3e52", "#3a3e52", "#ef4444"].map((c, i) => <span key={i} style={{ width: 42, height: 42, borderRadius: 99, background: c }} />)}
        </div>
      </div>
      {/* taskbar */}
      <div style={abs({ left: 0, right: 0, bottom: 0, height: land ? 52 : 70, background: "rgba(20,22,40,0.75)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "center", alignItems: "center", gap: 18 })}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ width: land ? 30 : 40, height: land ? 30 : 40, borderRadius: 8, background: i === 4 ? "linear-gradient(135deg,#7048F5,#22D3EE)" : "rgba(255,255,255,0.12)" }} />
        ))}
      </div>
    </div>
  );
}

/** The compact window's title bar (the Windows app draws its own: the mark, "Orbit", always on top, minimise, close). */
function WinTitle({ fmt, t, from, webAt, base, vp }: { fmt: Fmt; t: number; from: number; webAt: number; base: { sx: number; sy: number; scale: number }; vp: [number, number] }) {
  const p = ep(t, from - 0.15, from + 0.6, out4);
  const o = p * (1 - ep(t, webAt + 0.1, webAt + 0.6));
  const s = base.scale * keys(t, [[from, 1], [webAt + 1, 1.04, inOut]]);
  const w = vp[0] * s;
  const h = 34 * s;
  const top = base.sy - (vp[1] * s) / 2 - h + (1 - p) * 140 * s * 0.5;
  return (
    <div style={abs({ left: base.sx - w / 2, top, width: w, height: h, zIndex: 11, opacity: o, borderRadius: `${10 * s}px ${10 * s}px 0 0`, background: "#f3f4f7", borderBottom: "1px solid #e2e4ec", display: "flex", alignItems: "center", gap: 8 * s, padding: `0 ${10 * s}px`, font: `600 ${13 * s}px/1 ${FONT}`, color: INK })}>
      <svg width={16 * s} height={16 * s} viewBox="0 0 64 64"><path d="M51.41 20.84 A23 23 0 1 1 43.16 12.59" fill="none" stroke={ACCENT} strokeWidth="8" strokeLinecap="round" /><circle cx="32" cy="32" r="8.5" fill={ACCENT} /></svg>
      Orbit
      <span style={{ marginLeft: "auto", display: "flex", gap: 16 * s, color: INK3, font: `400 ${14 * s}px/1 ${FONT}` }}>
        <span>—</span><span>✕</span>
      </span>
    </div>
  );
}

/** The rest of the account, one card each: LinkedIn AI, Offer AI, Learning AI. */
export function moreShot(fmt: Fmt, r: Range): Scene {
  const { from, to } = r;
  const land = fmt.id === "16x9";
  const step = (to - from) / 3;
  const items = [
    { id: "li", path: "/linkedin", flow: "linkedin" as string | undefined, epoch: 99, label: "LinkedIn AI", word: "Profile fixes, ready to paste", focus: [760, 300] as [number, number] },
    { id: "of", path: `/offers/${IDS.offer}`, flow: "offer", epoch: 99, label: "Offer AI", word: "What an offer is really worth", focus: [760, 330] as [number, number] },
    { id: "le", path: "/learn", flow: undefined, epoch: 0, label: "Learning AI", word: "Coding rounds, and free cybersecurity", focus: [760, 520] as [number, number] },
  ];
  const vp: [number, number] = fmt.portrait ? [390, 844] : land ? [1280, 800] : [1100, 860];
  const pl = fmt.portrait ? placement(fmt, "phone").p : land ? { sx: 960, sy: 590, scale: 0.98 } : { sx: 540, sy: 190 + 370, scale: 0.86 };
  const frames: FrameSpec[] = items.map((it, i) => {
    const a = from + i * step;
    return {
      id: `${it.id}-${from}`, path: it.path, flow: it.flow, flowEpoch: it.epoch, viewport: vp,
      latest: it.id === "li" ? { "GET /v1/linkedin": "POST /v1/linkedin" } : it.id === "of" ? { "GET /v1/offers": `POST /v1/offers/${IDS.offer}/plan []` } : undefined, from: a - 0.3, to: a + step + 0.5, bar: land,
      script: it.id === "le" ? [{ at: 0.3, scroll: { sel: "h2, h3, p", text: "KashSec Academy" }, offset: fmt.portrait ? 120 : 160, dur: 1 }] : it.id === "of" ? [{ at: 0.3, scroll: { sel: "h2, h3", text: "Your negotiation" }, offset: fmt.portrait ? 100 : 250, dur: 1 }] : [],
      layout: camera({ vp, p: { ...pl, anchor: !land } }, !land ? [{ t: a, z: 1 }, { t: a + step, z: 1.04 }] : [{ t: a, z: 1, fx: it.focus[0], fy: it.focus[1] }, { t: a + step, z: 1.06, fx: it.focus[0], fy: it.focus[1] }], { enter: [a - 0.2, a + 0.5], from: "right", exit: [a + step - 0.15, a + step + 0.45], to: "left" }),
    };
  });
  return {
    id: `more-${from}`, from, to, frames,
    cues: items.map((_, i) => ({ t: from + i * step - 0.15, kind: "swish", dur: 0.55 })),
    render: (t) => (
      <>
        <Backdrop fmt={fmt} mode="mist" t={t} z={1} />
        {items.map((it, i) => {
          const a = from + i * step;
          return (
            <div key={it.id} style={abs({ left: 0, right: 0, top: land ? 44 : fmt.id === "9x16" ? fmt.safe.t + 16 : fmt.id === "4x5" ? 64 : 56, zIndex: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 })}>
              <Eyebrow text={it.label} t={t} at={a + 0.05} out={a + step - 0.2} size={fs(fmt, 26, 30, 28)} />
              <Words text={it.word} t={t} at={a + 0.12} out={a + step - 0.25} size={fs(fmt, 40, 46, 42)} align="center" />
            </div>
          );
        })}
      </>
    ),
  };
}

export const _x = { clamp, lerp, out3, Spot, ACCENT, INK, prog };
export type { Ctx };

/** A floating score card drawn over a scene: a ring and a number that counts between two real scores. */
export function ScoreCard({ fmt, t, at, out, from: a, to: b, label, x, y, dark }: { fmt: Fmt; t: number; at: number; out: number; from: number; to: number; label: string; x: number; y: number; dark?: boolean }) {
  const p = ep(t, at, at + 0.6, outBack);
  const o = ep(t, at, at + 0.3) * (1 - ep(t, out - 0.3, out));
  if (o <= 0) return null;
  const v = Math.round(keys(t, [[at + 0.5, a], [at + 1.9, b, inOut]]));
  const size = fs(fmt, 150, 170, 150);
  const r = 34;
  const c = 2 * Math.PI * r;
  const col = v >= 85 ? "#10b981" : v >= 65 ? ACCENT : "#f59e0b";
  return (
    <div style={abs({ left: x, top: y, zIndex: 45, opacity: o, transform: `scale(${0.85 + 0.15 * p})`, transformOrigin: "0 0", display: "flex", alignItems: "center", gap: size * 0.16, padding: `${size * 0.12}px ${size * 0.2}px ${size * 0.12}px ${size * 0.12}px`, borderRadius: size * 0.18, background: dark ? "#141B27" : "#fff", boxShadow: "0 0 0 1px rgba(15,18,30,0.08), 0 30px 60px -20px rgba(30,20,80,0.35)" })}>
      <svg width={size} height={size} viewBox="0 0 80 80" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" stroke={col} opacity={0.16} />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" stroke={col} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ font: `600 ${size * 0.5}px/1 ${FONT}`, color: dark ? "#fff" : INK, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{v}<span style={{ fontSize: size * 0.2, color: INK3, letterSpacing: 0 }}> / 100</span></div>
        <div style={{ font: `500 ${size * 0.15}px/1.2 ${FONT}`, color: dark ? "rgba(255,255,255,0.7)" : INK3 }}>{label}</div>
      </div>
    </div>
  );
}

/** Resume AI in a few seconds: the fixed resume's score tab, with the score counting from the draft's to the fix's. */
export function resumeQuick(fmt: Fmt, r: Range & { title?: string }): Scene {
  const { from, to } = r;
  const pl = placement(fmt);
  const id = `rq-${from}`;
  const land = fmt.id === "16x9";
  const frame: FrameSpec = {
    id, path: `/resume-ai/${IDS.draft}`, flow: "resume", viewport: pl.vp, from: from - 0.3, to, bar: land, flowEpoch: 99,
    latest: { [`GET /v1/resumes/${IDS.draft}`]: `PUT /v1/resumes/${IDS.draft}`, "POST /v1/resumes/score": "POST /v1/resumes/score" },
    script: [{ at: 0.0, css: HIDE_TOASTS }, { at: 0.25, click: { sel: "[role=tab]", text: "ATS score" } }],
    layout: camera(pl, land ? [{ t: from, z: 1 }, { t: to, z: 1.06 }] : [{ t: from, z: 1 }, { t: to, z: 1.03 }], { enter: [from - 0.3, from + 0.5], from: land ? "right" : "rise", exit: [to - 0.4, to], to: "left" }),
  };
  const card = land ? { x: 104, y: 640 } : fmt.id === "9x16" ? { x: 560, y: 1080 } : fmt.id === "4x5" ? { x: 540, y: 760 } : { x: 600, y: 600 };
  return stop({
    id, fmt, from, to, frames: [frame],
    cues: [{ t: from - 0.1, kind: "whoosh", dur: 0.6 }, { t: from + 1.9, kind: "chime", gain: 0.6 }],
    draw: (t) => (
      <>
        <TitleBlock fmt={fmt} t={t} at={from + 0.05} out={to - 0.45} eyebrow="Resume AI" title={r.title ?? (land ? "Your ATS score,\n*fixed with AI.*" : "Your ATS score,\n*fixed with AI.*")} />
        <ScoreCard fmt={fmt} t={t} at={from + 0.35} out={to} from={74} to={99} label="ATS score, after AI fixes" x={card.x} y={card.y} />
      </>
    ),
  });
}

/** A few screens in quick succession, each with its name. */
export function flashShot(fmt: Fmt, r: Range & { items: Array<{ path: string; label: string; flow?: string; flowEpoch?: number; latest?: Record<string, string>; script?: FrameSpec["script"] }> }): Scene {
  const { from, to } = r;
  const land = fmt.id === "16x9";
  const step = (to - from) / r.items.length;
  const vp: [number, number] = fmt.portrait ? [390, 844] : land ? [1280, 800] : [1100, 860];
  const pl = fmt.portrait ? placement(fmt, "phone").p : land ? { sx: 960, sy: 600, scale: 0.98 } : { sx: 540, sy: 190 + 370, scale: 0.86 };
  const frames: FrameSpec[] = r.items.map((it, i) => {
    const a = from + i * step;
    return {
      id: `fl${i}-${from}`, path: it.path, flow: it.flow, flowEpoch: it.flowEpoch, latest: it.latest, viewport: vp, from: a - 0.3, to: a + step + 0.4, bar: land, script: it.script,
      layout: camera({ vp, p: { ...pl, anchor: !land } }, [{ t: a, z: 1 }, { t: a + step, z: 1.04 }], { enter: [a - 0.2, a + 0.4], from: "right", exit: [a + step - 0.1, a + step + 0.35], to: "left" }),
    };
  });
  return {
    id: `flash-${from}`, from, to, frames,
    cues: r.items.map((_, i) => ({ t: from + i * step - 0.12, kind: "swish", dur: 0.45 })),
    render: (t) => (
      <>
        <Backdrop fmt={fmt} mode="mist" t={t} z={1} />
        {r.items.map((it, i) => {
          const a = from + i * step;
          return (
            <div key={i} style={abs({ left: 0, right: 0, top: land ? 52 : fmt.id === "9x16" ? fmt.safe.t + 40 : fmt.id === "4x5" ? 80 : 64, zIndex: 40, display: "flex", justifyContent: "center" })}>
              <Eyebrow text={it.label} t={t} at={a + 0.02} out={a + step - 0.15} size={fs(fmt, 30, 36, 32)} />
            </div>
          );
        })}
      </>
    ),
  };
}
