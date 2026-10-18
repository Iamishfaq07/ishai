import { Captions, Mic, PhoneOff, ScrollText, Sparkles, Video, cx } from "@orbit/ui";
import { companyNames } from "virtual:question-bank/names";
import { useCountry } from "../lib/country";
import { Bubble, FakeButton, Panel, Ring, SampleTag, TickRows, Typed, at, typedWords, useClock, usePlay } from "../marketing/kit";
import { PRESETS, presetTitle } from "./mockPresets";

/**
 * Practice's public page, drawn with Practice's own pieces (DECISIONS D79): the video room's look (the dark room in
 * either theme, Saba as a voice: a disc with bars that move with her words, captions word by word, the round's
 * progress, the dock), the review's score ring and per-answer dots (SessionReview: scores out of 5), the drill of
 * answers scored 3 or lower, and the one-tap rounds (mockPresets). A composition, not the room itself: Saba's
 * visualizer is a canvas driven by real audio. Sample data, said so.
 */

const QUESTION = "Tell me about a time you used data to change a product decision.";

/** Bars across Saba's disc: a calm low wave while she listens (the resting heights), rising with her words. */
const BARS = Array.from({ length: 24 }, (_, i) => 0.18 + 0.16 * Math.abs(Math.sin(i * 0.55)) + (i % 3 === 0 ? 0.05 : 0));

/** The hero: the video interview room, Saba asking a question (her bars moving, the caption coming in word by
 *  word), then listening. */
export function RoomArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3600);
  const typed = typedWords(QUESTION, t, 250, 190);
  const speaking = t < 2900;
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[34rem] lg:mr-0">
      <div
        ref={p.ref}
        {...p.attrs}
        role="img"
        aria-label={`Orbit's AI video interview: Saba, the AI interviewer, shown as a voice, asks "${QUESTION}", with captions, then listens. Question 2 of 4.`}
        className="kp video-room mk-float overflow-hidden rounded-2xl bg-zinc-950 text-white"
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-2.5 text-[0.75rem]">
          <span className="relative h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <span className="font-medium text-zinc-100">Live</span>
          <span className="truncate text-zinc-400">Product analyst · hiring manager round</span>
          <span className="ml-auto tabular-nums text-zinc-400">06:12</span>
        </div>
        <div className="flex gap-1 px-4 pt-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cx("h-0.5 flex-1 rounded-full", i < 1 ? "bg-indigo-400" : i === 1 ? "bg-indigo-400/60" : "bg-white/15")} />
          ))}
        </div>
        <div className="relative m-3 grid h-56 place-items-center rounded-xl bg-zinc-900 sm:h-64">
          <div className="grid h-32 w-32 place-items-center rounded-full bg-indigo-400/10 sm:h-40 sm:w-40">
            <span aria-hidden="true" className="flex h-16 items-center gap-[3px]">
              {BARS.map((h, i) => (
                <span key={i} className="kp-voice w-[3px] rounded-full bg-indigo-300" style={{ height: `${h * 100}%`, ...at(i * 37), ["--v" as string]: String(1.6 + (i % 5) * 0.35) }} />
              ))}
            </span>
          </div>
          <p className="absolute left-3 top-3 rounded-full bg-black/30 px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-100">
            Saba · {speaking ? "speaking" : "listening"}
          </p>
          <span className="absolute bottom-3 right-3 grid h-14 w-20 place-items-center rounded-lg bg-zinc-800 ring-1 ring-white/10 sm:h-16 sm:w-24">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-700 text-[0.6875rem] font-semibold text-zinc-100">AR</span>
          </span>
        </div>
        <div className="mx-3 min-h-[3.25rem] rounded-lg bg-black/25 px-3 py-2 text-[0.8125rem] leading-snug text-zinc-100">
          <Typed text={QUESTION} shown={typed.shown} typing={typed.typing} />
        </div>
        <div className="flex items-center justify-center gap-2 px-3 py-3" aria-hidden="true">
          {[Mic, Video, Captions, ScrollText].map((Icon, i) => (
            <span key={i} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-zinc-100">
              <Icon className="h-4 w-4" />
            </span>
          ))}
          <span className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-[0.75rem] font-medium text-white">
            <PhoneOff className="h-4 w-4" /> End
          </span>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Saba, Orbit's AI interviewer, is a voice, never a face. Sample round.</figcaption>
    </figure>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Step 1: the one-tap rounds (Practice's own presets), one picked. */
export function RoundsStepArt() {
  const country = useCountry();
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`One-tap rounds: ${PRESETS.map((x) => presetTitle(x, country)).join(", ")}.`} className="kp grid w-full max-w-[17rem] grid-cols-2 gap-1.5">
      {PRESETS.map((x, i) => (
        <span key={x.id} className={cx("kp-in rounded-lg border mk-surface px-2 py-1.5 text-[0.6875rem]", i === 2 ? "border-indigo-500/60 ring-1 ring-indigo-500/30" : "mk-line")} style={at(100 + i * 90, { y: 6 })}>
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{presetTitle(x, country)}</span>
          <span className="text-zinc-500 dark:text-zinc-400">{x.minutes} min</span>
        </span>
      ))}
    </div>
  );
}

/** Step 2: Saba asks, out loud, and follows up on what you said. */
export function TalkStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="Saba asks a follow-up on what you just said." className="kp w-full max-w-[17rem] space-y-2">
      <Bubble from="ai" className="kp-in" style={at(100, { y: 6 })}>
        You said the test cut cancellations by 6%. How did you pick the sample size?
      </Bubble>
      <Bubble from="you" className="kp-in" style={at(700, { y: 6 })}>
        We ran it for two weeks, split by city, so each arm had enough bookings…
      </Bubble>
      <p className="kp-fade text-center text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(1100)}>
        Saba · listening
      </p>
    </div>
  );
}

const ANSWERS: Array<[string, number]> = [
  ["Tell me about yourself", 4],
  ["A time you used data to change a decision", 5],
  ["A disagreement with a stakeholder", 3],
  ["Why this team?", 4],
];

/** One answer's score, as the review draws it: five dots, the score's worth filled. */
function Dots({ score, from = 0 }: { score: number; from?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cx("h-2 w-2 rounded-full", n <= score ? "kp-pop bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-700")} style={n <= score ? at(from + n * 70) : undefined} />
      ))}
    </span>
  );
}

/** Step 3: the review, the round's score and a score for each answer. */
export function ReviewStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`The review: 4 out of 5 overall, and each answer scored: ${ANSWERS.map(([q, s]) => `${q}, ${s} out of 5`).join("; ")}.`} className="kp w-full max-w-[17rem]">
      <Panel>
        <div className="flex items-center gap-3 border-b mk-line p-2.5">
          <Ring value={4} max={5} start={p.shown} size={44} sub="/5" />
          <span className="text-[0.75rem]">
            <span className="block font-medium text-zinc-900 dark:text-white">Strong</span>
            <span className="text-zinc-500 dark:text-zinc-400">4 of 4 answered and scored</span>
          </span>
        </div>
        <ul className="space-y-1.5 p-2.5">
          {ANSWERS.slice(0, 3).map(([q, s], i) => (
            <li key={q} className="flex items-center justify-between gap-2 text-[0.6875rem]">
              <span className="truncate text-zinc-700 dark:text-zinc-200">
                <span className="mr-1 font-semibold tabular-nums">Q{i + 1}</span>
                {q}
              </span>
              <Dots score={s} from={300 + i * 250} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ─── The toolkit ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A score for every answer: the round's ring, each answer's dots, what landed and what to improve. */
export function ScorecardArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`A round's scorecard: 4 out of 5, strong. ${ANSWERS.map(([q, s]) => `${q}: ${s} out of 5`).join(". ")}. What went well: the point first, then the example; real numbers. To improve: name the result of the disagreement in numbers. One answer to drill.`} className="kp grid gap-3 sm:grid-cols-2">
      <Panel>
        <div className="flex items-center gap-3 border-b mk-line p-3">
          <Ring value={4} max={5} start={p.shown} size={52} sub="/5" />
          <span className="text-[0.75rem] leading-snug">
            <span className="block font-medium text-zinc-900 dark:text-white">Strong</span>
            <span className="text-zinc-500 dark:text-zinc-400">4 of 4 answered and scored</span>
          </span>
        </div>
        <ul className="space-y-2 p-3">
          {ANSWERS.map(([q, s], i) => (
            <li key={q} className="flex items-center justify-between gap-2 text-[0.75rem]">
              <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-100">
                <span className="mr-1.5 font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">Q{i + 1}</span>
                {q}
              </span>
              <Dots score={s} from={200 + i * 260} />
            </li>
          ))}
        </ul>
        <div className="kp-fade border-t mk-line p-3" style={at(1400)}>
          <FakeButton primary>Drill 1 weak question</FakeButton>
        </div>
      </Panel>
      <div className="space-y-2">
        <div className="kp-in rounded-xl border mk-line mk-surface p-3" style={at(900, { y: 8 })}>
          <p className="text-[0.75rem] font-medium text-zinc-900 dark:text-white">What went well</p>
          <ul className="mt-1.5 space-y-1 text-[0.6875rem] text-zinc-700 dark:text-zinc-300">
            <li className="flex gap-1.5"><span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> The point first, then the example</li>
            <li className="flex gap-1.5"><span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> Real numbers from your own work</li>
          </ul>
        </div>
        <div className="kp-in rounded-xl border mk-line mk-surface p-3" style={at(1150, { y: 8 })}>
          <p className="text-[0.75rem] font-medium text-zinc-900 dark:text-white">To improve</p>
          <ul className="mt-1.5 space-y-1 text-[0.6875rem] text-zinc-700 dark:text-zinc-300">
            <li className="flex gap-1.5"><span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> In the disagreement story, name the result in numbers</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const SAID = "We disagreed about the launch date, so I set up a meeting and we talked it through, and in the end it went fine.";
const STRONGER = "Product wanted to launch before the data was clean. I showed them the two dashboards that disagreed, we agreed to a one-week delay, and the launch numbers held up in review.";

/** A stronger way to say it: what you said, then the stronger version written in. */
export function StrongerArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3600);
  const typed = typedWords(STRONGER, t, 600, 80);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`What you said: "${SAID}" A stronger way to say it: "${STRONGER}"`} className="kp space-y-2">
      <div className="rounded-lg bg-zinc-500/5 p-2.5 text-[0.75rem] leading-relaxed text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:text-zinc-300">
        <p className="mb-0.5 text-[0.6875rem] font-medium text-zinc-500 dark:text-zinc-400">What you said · Q3</p>
        {SAID}
      </div>
      <div className="rounded-lg border-l-2 border-indigo-500 bg-indigo-500/5 px-3 py-2 text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100">
        <p className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-medium text-indigo-700 dark:text-indigo-300">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> A stronger way to say it
        </p>
        <Typed text={STRONGER} shown={typed.shown} typing={typed.typing} />
      </div>
    </div>
  );
}

/** Your weakest answers, again: the ones scored 3 or lower, due back on a schedule. */
export function DrillArt() {
  const p = usePlay<HTMLDivElement>();
  const due: Array<[string, number, string]> = [
    ["A disagreement with a stakeholder", 3, "Due today"],
    ["Your biggest weakness", 2, "Due tomorrow"],
    ["A project that failed", 3, "In 3 days"],
  ];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Answers due again: ${due.map(([q, s, d]) => `${q}, scored ${s} out of 5, ${d.toLowerCase()}`).join("; ")}.`} className="kp space-y-1.5">
      {due.map(([q, s, d], i) => (
        <div key={q} className="kp-in flex items-center gap-2.5 rounded-lg border mk-line mk-surface px-2.5 py-2 text-[0.75rem]" style={at(150 + i * 200, { y: 6 })}>
          <Dots score={s} />
          <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">{q}</span>
          <span className={cx("shrink-0 text-[0.6875rem]", i === 0 ? "font-medium text-indigo-700 dark:text-indigo-300" : "text-zinc-500 dark:text-zinc-400")}>{d}</span>
        </div>
      ))}
      <SampleTag className="kp-fade mt-1 inline-block" />
    </div>
  );
}

/** In a company's style: some of the interview guides a round can follow (the question bank's own list). */
export function CompaniesArt() {
  const p = usePlay<HTMLDivElement>();
  const names = Object.values(companyNames);
  const pick = ["TCS", "Infosys", "Amazon", "Google", "Accenture", "Deloitte", "Microsoft", "Flipkart"].filter((n) => names.includes(n));
  const shown = pick.length >= 6 ? pick : names.slice(0, 8);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Company interview guides a round can follow, ${names.length} in all, such as ${shown.join(", ")}.`} className="kp">
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((n, i) => (
          <li key={n} className="kp-pop rounded-full border mk-line mk-surface px-2.5 py-0.5 text-[0.6875rem] font-medium text-zinc-800 dark:text-zinc-100" style={at(150 + i * 80)}>
            {n}
          </li>
        ))}
        <li className="kp-fade rounded-full px-2.5 py-0.5 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(900)}>
          and {names.length - shown.length} more
        </li>
      </ul>
      <p className="mt-3 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">The rounds and what interviewers listen for, as candidates commonly report them. Not made with the companies.</p>
    </div>
  );
}

const STORY = [
  { label: "Situation", note: "Trial users were leaving before their first data source" },
  { label: "Task", note: "Find out why, and what to change" },
  { label: "Action", note: "Split the funnel by device, tested a two-screen setup" },
  { label: "Result", note: "Trial-to-paid up 12% that quarter" },
];

/** Stories for "Tell me about a time": a story in the story bank, its four parts ticking off. */
export function StoryArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`A story in the story bank, the onboarding test, with its four parts: ${STORY.map((x) => `${x.label}: ${x.note}`).join("; ")}.`} className="kp">
      <Panel title="The onboarding test" meta={<SampleTag />}>
        <TickRows className="p-3" rows={STORY} times={STORY.map((_, i) => 250 + i * 280)} />
      </Panel>
      <p className="kp-fade mt-2 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(1500)}>
        Practise telling it: the interviewer asks for the part that's thin.
      </p>
    </div>
  );
}
