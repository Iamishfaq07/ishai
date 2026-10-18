import { useState, type CSSProperties } from "react";
import type { ResumeData, ResumeDesign, ResumeTemplate } from "@orbit/types";
import { Check, Download, FileText, FileUp, RefreshCw, Sparkles, Undo2, cx, focusRing, wordDiff } from "@orbit/ui";
import { useCountry } from "../../lib/country";
import { Bars, Chips, FakeButton, Panel, Ring, SampleTag, TickRows, Typed, at, stepsDone, typedWords, useClock, useNear, usePlay } from "../../marketing/kit";
import { LOOKS, templatesFor } from "./model";
import { MM_TO_PX, PAGE_MM, ResumePreview } from "./ResumePreview";
import { sampleResume, type SampleResume } from "./sample";

/**
 * Resume AI's public page, drawn from Resume AI itself (DECISIONS D79): the real resume renderer (ResumePreview) with
 * the page's sample resume (sample.ts), and the editor's own pieces as small renders. Every number here is the real
 * ATS check's (orbit_api/resumes/ats.py, run on this sample): 82 with four things wrong, then 85, 91, 96 and 98 as
 * each is fixed; with the sample job post, 11 of its 15 keywords covered. Made-up people and companies, said so.
 */

// ─── The real check on the sample ──────────────────────────────────────────────────────────────────────────────────

/** The sample with four things wrong scores 82; each fix, in order, gives the score after it (ats.py). */
const STORY = {
  from: 82,
  fixes: [
    { label: "Bullets start with an action verb", how: "Fix with AI", gain: 3, score: 85 },
    { label: "A summary of 25-90 words", how: "Fix with AI", gain: 6, score: 91 },
    { label: "At least 8 skills listed", how: "Fix with AI", gain: 5, score: 96 },
    { label: "A LinkedIn or portfolio link", how: "You add it", gain: 2, score: 98 },
  ],
} as const;

/** The finished sample's eight parts (seven: there's no job post to match), as the check scores them. */
const PARTS = [
  { label: "Contact details", value: 10, max: 10 },
  { label: "Standard sections", value: 10, max: 10 },
  { label: "Summary", value: 4, max: 4 },
  { label: "Experience bullets", value: 26, max: 26 },
  { label: "Skills", value: 7, max: 7 },
  { label: "Readability", value: 12.8, max: 14 },
  { label: "ATS-safe layout", value: 4, max: 4 },
];

/** The sample against the sample job post (a retail data analyst role): what the check found. */
const MATCHED = ["Power BI", "Python", "SQL", "A/B testing", "BigQuery", "Statistics", "Tableau", "Analytics", "Sales", "Retail", "Data"];
const MISSING = ["Forecasting", "Looker", "dbt", "Communication"];

const WEAK = "Worked on Power BI dashboards for 40+ store managers to replace 12 weekly Excel reports.";
const STRONG = "Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.";

// ─── A resume, drawn at a fixed size ───────────────────────────────────────────────────────────────────────────────

/** The real resume, scaled to a box of a fixed size (no measuring, so the built page and the app's copy match and
 *  nothing shifts): `--s1` below `sm`, `--s2` from it, for the paper size the sample uses. */
function Paper({ data, design, widths, className, style }: { data: ResumeData; design: ResumeDesign; widths: [number, number]; className?: string; style?: CSSProperties }) {
  const page = PAGE_MM[design.page].w * MM_TO_PX;
  const vars = { "--s1": String(widths[0] / page), "--s2": String(widths[1] / page) } as CSSProperties;
  return (
    <div className={cx("overflow-hidden bg-white", className)} style={style}>
      <div aria-hidden="true" inert className="w-max origin-top-left [scale:var(--s1)] sm:[scale:var(--s2)]" style={vars}>
        <ResumePreview data={data} design={design} decorative />
      </div>
    </div>
  );
}

/** A template's own look for the sample, from the quick looks where it has one. */
function lookFor(sample: SampleResume, template: ResumeTemplate): ResumeDesign {
  const look = LOOKS.find((l) => l.design.template === template)?.design;
  // Space Grotesk isn't loaded on the public site; Inter is (the sample uses it).
  const font = look?.font && look.font !== "grotesk" ? look.font : sample.design.font;
  return { ...sample.design, template, accent: look?.accent ?? sample.design.accent, font };
}

// ─── The hero ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The hero: the sample resume, two of its other templates behind it, and the ATS score counting up from 82 to 98 as
 * the check's four fixes are made one after another. Plays once at Full motion (Play again after); finished at
 * Gentle, Off, data saver and in the built HTML.
 */
export function ResumeHeroArt() {
  const sample = sampleResume(useCountry());
  const [run, setRun] = useState(0);
  const p = usePlay<HTMLDivElement>();
  const times = STORY.fixes.map((_, i) => 900 + i * 800);
  const t = useClock(p.shown, p.play, times[times.length - 1]! + 700, run);
  const done = stepsDone(times, t);
  const score = done === 0 ? STORY.from : STORY.fixes[done - 1]!.score;
  // First the score itself counts up, then on from each score to the next.
  const before = done === 0 ? 40 : done === 1 ? STORY.from : STORY.fixes[done - 2]!.score;
  const floating = "mk-menu-shadow absolute rounded-xl mk-surface";
  return (
    <figure className="relative mx-auto w-full max-w-[34rem] lg:mr-0">
      <div
        key={run}
        ref={p.ref}
        {...p.attrs}
        role="img"
        aria-label={`A sample resume in Resume AI. Its ATS score goes from ${STORY.from} to 98 out of 100 as four fixes are made: ${STORY.fixes.map((f) => `${f.label.toLowerCase()}, plus ${f.gain}`).join("; ")}.`}
        className="kp relative h-[26rem] sm:h-[31rem]"
      >
        {/* Two of the other templates, behind. */}
        <Paper
          data={sample.data}
          design={lookFor(sample, "classic")}
          widths={[192, 232]}
          className="kp-in absolute left-0 top-12 hidden h-[17rem] w-[12rem] rounded-lg ring-1 ring-zinc-900/10 sm:block sm:h-[20rem] sm:w-[14.5rem] dark:ring-white/10"
          style={at(0, { x: 16 })}
        />
        <Paper
          data={sample.data}
          design={lookFor(sample, "executive")}
          widths={[208, 264]}
          className="kp-in mk-float absolute left-0 top-6 h-[18rem] w-[13rem] rounded-lg sm:left-12 sm:h-[22rem] sm:w-[16.5rem]"
          style={at(80, { x: 16 })}
        />
        {/* The resume, with its top two thirds showing. */}
        <div className="mk-float absolute right-0 top-0 overflow-hidden rounded-xl" style={{ maskImage: "linear-gradient(to bottom, #000 70%, transparent 98%)", WebkitMaskImage: "linear-gradient(to bottom, #000 70%, transparent 98%)" }}>
          <Paper data={sample.data} design={sample.design} widths={[264, 384]} className="h-[22rem] w-[16.5rem] sm:h-[28rem] sm:w-[24rem]" />
        </div>
        {/* The score. */}
        <div className={cx(floating, "-right-1 -top-4 flex items-center gap-3 p-2.5 pr-3.5 sm:-right-5")}>
          <Ring value={score} from={before} start={p.shown} size={52} duration={500} />
          <span className="text-xs leading-tight">
            <span className="block font-medium text-zinc-900 dark:text-white">ATS score</span>
            <span className="text-zinc-500 dark:text-zinc-400">{score >= 80 ? "Strong" : "Good"} · out of 100</span>
          </span>
          <span className="kp-fade rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-emerald-800 dark:text-emerald-200" style={at(times[3]! + 300)}>
            +16
          </span>
        </div>
        {/* The fixes, made one after another. */}
        <div className={cx(floating, "kp-in inset-x-2 bottom-0 p-3.5 sm:inset-x-auto sm:bottom-2 sm:left-0 sm:w-[19rem]")} style={at(200, { y: 10 })}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> 4 fixes found
          </p>
          <TickRows className="mt-2.5" times={times} rows={STORY.fixes.map((f) => ({ label: f.label, note: f.how, meta: `+${f.gain}` }))} />
        </div>
      </div>
      <figcaption className="mt-3 flex min-h-8 items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span>A sample resume, scored by Resume AI's own ATS check.</span>
        {p.play && t === Infinity && (
          <button
            type="button"
            onClick={() => setRun((r) => r + 1)}
            className={cx("inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 font-medium text-zinc-600 hover:bg-zinc-900/[0.04] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Play again
          </button>
        )}
      </figcaption>
    </figure>
  );
}

// ─── The three steps ───────────────────────────────────────────────────────────────────────────────────────────────

/** Step 1: a PDF read into the editor's sections, each one ticking in. */
export function ImportStepArt() {
  const p = usePlay<HTMLDivElement>();
  const rows: Array<[string, string]> = [
    ["Contact details", "6 fields"],
    ["Experience", "2 roles"],
    ["Education", "1 degree"],
    ["Skills", "9 skills"],
  ];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="A resume PDF being read into sections: contact details, experience, education and skills." className="kp w-full max-w-[17rem]">
      <Panel>
        <div className="flex items-center gap-2.5 border-b mk-line p-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300">
            <FileUp className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.75rem] font-medium text-zinc-900 dark:text-zinc-100">my-resume.pdf</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-zinc-900/[0.06] dark:bg-white/10">
              <span className="kp-fill block h-full w-full rounded-full bg-indigo-500" style={at(100)} />
            </span>
          </span>
        </div>
        <ul className="space-y-1 p-2.5">
          {rows.map(([name, meta], i) => (
            <li key={name} className="kp-in flex items-center gap-2 rounded-lg px-1.5 py-1 text-[0.75rem]" style={at(900 + i * 180, { y: 6 })}>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
              </span>
              <span className="flex-1 text-zinc-800 dark:text-zinc-100">{name}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{meta}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Step 2: the score counting up and the job post's keywords lighting up. */
export function ScoreStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`The ATS score, 98 out of 100, and a job post's keywords: ${MATCHED.length} of ${MATCHED.length + MISSING.length} covered.`} className="kp w-full max-w-[17rem]">
      <Panel>
        <div className="flex items-center gap-3 border-b mk-line p-3">
          <Ring value={98} from={40} start={p.shown} size={56} />
          <span className="text-[0.75rem] leading-snug">
            <span className="block font-medium text-zinc-900 dark:text-white">Strong</span>
            <span className="text-zinc-500 dark:text-zinc-400">1 thing to look at</span>
          </span>
        </div>
        <div className="p-3">
          <p className="text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-300">
            Job post: {MATCHED.length} of {MATCHED.length + MISSING.length} keywords
          </p>
          <Chips className="mt-2" from={700} every={90} items={[...MATCHED.slice(0, 5).map((label) => ({ label, on: true })), ...MISSING.slice(0, 2).map((label) => ({ label, on: false }))]} />
        </div>
      </Panel>
    </div>
  );
}

/** Step 3: the download, Word or PDF, and the file it made. */
export function DownloadStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="Download as Word or as a PDF; the PDF is saved." className="kp w-full max-w-[17rem]">
      <Panel>
        <div className="flex items-center justify-end gap-1.5 border-b mk-line p-2">
          <FakeButton>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Word
          </FakeButton>
          <FakeButton primary>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download PDF
          </FakeButton>
        </div>
        <div className="flex gap-3 p-3">
          <span aria-hidden="true" className="flex h-24 w-[4.25rem] shrink-0 flex-col gap-1 rounded bg-white p-2 ring-1 ring-zinc-900/10">
            <span className="h-1.5 w-8 rounded-full bg-indigo-500/70" />
            <span className="h-1 w-10 rounded-full bg-zinc-300" />
            {[10, 9, 10, 7, 10, 8, 9].map((w, i) => (
              <span key={i} className="h-1 rounded-full bg-zinc-200" style={{ width: `${w * 0.25}rem` }} />
            ))}
          </span>
          <span className="min-w-0 flex-1 text-[0.75rem]">
            <span className="block font-medium text-zinc-900 dark:text-zinc-100">1 page, A4 or Letter</span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">Real text an ATS reads, not an image</span>
            <span className="kp-in mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-200" style={at(800, { y: 6 })}>
              <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" /> Downloaded
            </span>
          </span>
        </div>
      </Panel>
    </div>
  );
}

// ─── The templates ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A placeholder page while a template's card is off screen: the same box, a few faint lines. */
function PagePlaceholder() {
  return (
    <span aria-hidden="true" className="flex h-full w-full flex-col gap-2 bg-white p-5">
      <span className="h-3 w-24 rounded-full bg-zinc-200" />
      <span className="h-2 w-32 rounded-full bg-zinc-100" />
      {[90, 80, 86, 60, 88, 72, 84, 66].map((w, i) => (
        <span key={i} className="h-1.5 rounded-full bg-zinc-100" style={{ width: `${w}%` }} />
      ))}
    </span>
  );
}

export function useTemplates() {
  const country = useCountry();
  return { sample: sampleResume(country), templates: templatesFor(country) };
}

/** One template's card in the carousel: the sample drawn in it (once it's near the screen), its name and note. */
export function TemplateCard({ index, near }: { index: number; near: boolean }) {
  const { sample, templates } = useTemplates();
  const t = templates[index]!;
  return (
    <figure className="w-[15rem]">
      <div className="h-[20rem] w-[15rem] overflow-hidden rounded-xl border mk-line bg-white">
        {near ? <Paper data={sample.data} design={lookFor(sample, t.id)} widths={[240, 240]} className="h-full w-full" /> : <PagePlaceholder />}
      </div>
      <figcaption className="mt-3">
        <span className="block text-sm font-semibold text-zinc-950 dark:text-white">{t.label}</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-zinc-600 dark:text-zinc-400">{t.note}</span>
      </figcaption>
    </figure>
  );
}

// ─── The toolkit ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Fix with AI: the failing check, the press, then the rewrite typed in with the changed words marked. */
export function FixArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 4200);
  const typed = typedWords(STRONG, t, 1300, 70);
  const marked = t >= 2600;
  const diff = wordDiff(WEAK, STRONG).filter((d) => d.kind !== "removed");
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Fix with AI on a bullet that didn't start with an action verb. Before: "${WEAK}" After: "${STRONG}" The numbers stay as they were.`} className="kp grid gap-3 sm:grid-cols-2">
      <Panel title="Bullets start with an action verb" meta="+3">
        <div className="space-y-2.5 p-3">
          <p className="text-[0.75rem] leading-relaxed text-zinc-600 dark:text-zinc-300">3 of 5 bullets start with an action verb. Lead with what you did: Led, Built, Reduced, Launched.</p>
          <FakeButton primary className={cx("transition-transform duration-press-out", t >= 700 && t < 1000 && "scale-[0.97]")}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Fix with AI
          </FakeButton>
        </div>
      </Panel>
      <Panel title="AI rewrite" meta="Dhan Retail · bullet 1">
        <div className="space-y-2 p-3 text-[0.75rem] leading-relaxed">
          <p className="rounded-lg bg-rose-500/5 px-2 py-1.5 text-zinc-500 line-through decoration-rose-400/60 dark:text-zinc-400">{WEAK}</p>
          <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-zinc-800 dark:text-zinc-100">
            {marked ? (
              <span className="block">
                {diff.map((d, i) => (d.kind === "added" ? <mark key={i} className="kp-fade rounded-sm bg-emerald-500/20 text-inherit" style={at(2600)}>{d.text}</mark> : <span key={i}>{d.text}</span>))}
              </span>
            ) : (
              <Typed text={STRONG} shown={typed.shown} typing={typed.typing} />
            )}
          </div>
          <div className="kp-fade flex flex-wrap items-center gap-1.5" style={at(2800)}>
            <FakeButton primary>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Keep
            </FakeButton>
            <FakeButton>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
            </FakeButton>
            <span className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">40+ and 12 kept, nothing added</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** The ATS check: the score, its parts filling in, and the one thing left to look at. */
export function ChecksArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="The ATS score, 98 out of 100, part by part: contact details, sections, summary, experience bullets, skills and layout full; readability 12.8 of 14, because the resume is under 300 words." className="kp">
      <div className="flex items-center gap-3">
        <Ring value={98} from={60} start={p.shown} size={60} />
        <span className="text-[0.75rem] leading-snug">
          <span className="block font-medium text-zinc-900 dark:text-white">Strong</span>
          <span className="text-zinc-500 dark:text-zinc-400">8 parts, the way screening software reads</span>
        </span>
      </div>
      <Bars className="mt-4" rows={PARTS} from={250} every={80} />
      <p className="kp-fade mt-3 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[0.6875rem] text-amber-950 dark:text-amber-100" style={at(1000)}>
        300-1,000 words (1-2 pages): add more detail to your roles.
      </p>
    </div>
  );
}

/** The job post: how many of its keywords the resume covers, which, and which it doesn't. */
export function MatchArt() {
  const p = usePlay<HTMLDivElement>();
  const total = MATCHED.length + MISSING.length;
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`A job post's keywords: ${MATCHED.length} of ${total} are on the resume (${MATCHED.join(", ")}); missing: ${MISSING.join(", ")}.`} className="kp">
      <div className="flex items-center gap-3">
        <Ring value={Math.round((MATCHED.length / total) * 100)} start={p.shown} size={60} suffix="%" />
        <span className="text-[0.75rem] leading-snug">
          <span className="block font-medium text-zinc-900 dark:text-white">
            {MATCHED.length} of {total} keywords
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">Data Analyst, Retail Insights</span>
        </span>
      </div>
      <Chips className="mt-4" from={500} every={70} items={[...MATCHED.map((label) => ({ label, on: true })), ...MISSING.map((label) => ({ label, on: false }))]} />
      <p className="mt-3 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">Add the ones you really have, in your skills or bullets.</p>
    </div>
  );
}

const LETTER =
  "Dear hiring team, I'm a data analyst at Dhan Retail, where the Power BI sales dashboard I built is used by 40+ store managers every week. Your Retail Insights role asks for SQL, Python and A/B tests on promotions: that's the work I do now, and I'd like to do it for your category teams.";

/** A cover letter written from the resume and the job post, in the tone picked. */
export function LetterArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 4600);
  const typed = typedWords(LETTER, t, 500, 75);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`A cover letter written from the resume and the job post, in a warm tone: "${LETTER}"`} className="kp">
      <Panel title="Cover letter" meta={<SampleTag />}>
        <div className="p-3">
          <div className="flex gap-1 text-[0.6875rem]">
            {["Formal", "Warm", "Short"].map((x) => (
              <span key={x} className={cx("rounded-md px-2 py-0.5", x === "Warm" ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950" : "text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:text-zinc-300 dark:ring-white/10")}>
                {x}
              </span>
            ))}
          </div>
          <Typed className="mt-2.5 text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100" text={LETTER} shown={typed.shown} typing={typed.typing} />
        </div>
      </Panel>
    </div>
  );
}

const PREP = [
  "Your dashboard replaced 12 weekly Excel reports. How did you get 40+ store managers to use it?",
  "How did you cut the inventory report from 2 days to 3 hours?",
  "The job asks for forecasting, which your resume doesn't show. How would you answer a question on it?",
];

/** Interview prep from the resume: the questions it will get you asked, coming in one after another. */
export function PrepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Questions this resume will get you asked: ${PREP.join(" ")}`} className="kp space-y-2">
      {PREP.map((q, i) => (
        <p key={q} className="kp-in rounded-lg border mk-line mk-surface px-3 py-2 text-[0.75rem] leading-snug text-zinc-800 dark:text-zinc-100" style={at(200 + i * 260, { y: 8 })}>
          <span className="mr-1.5 font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">Q{i + 1}</span>
          {q}
        </p>
      ))}
      <p className="kp-fade flex items-center justify-between pt-1 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(1000)}>
        <span>Example questions</span>
        <span className="font-medium text-indigo-700 dark:text-indigo-300">Practise them in a mock interview</span>
      </p>
    </div>
  );
}

// ─── The comparison ────────────────────────────────────────────────────────────────────────────────────────────────

/** What a general chatbot hands back: text, the layout left to you. */
export function ChatbotArt() {
  return (
    <div aria-hidden="true" className="h-full p-4 text-[0.75rem] leading-relaxed text-zinc-700 dark:text-zinc-300" style={{ maskImage: "linear-gradient(to bottom, #000 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 60%, transparent)" }}>
      <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-white dark:text-zinc-950">Make my resume better for this job</p>
      <div className="mt-3 space-y-2 text-[0.6875rem]">
        <p>**Summary**</p>
        <p>Data analyst with two years of experience turning sales and inventory data into dashboards…</p>
        <p>**Experience**</p>
        <p>- Built a Power BI sales dashboard used by store managers…</p>
        <p>- Automated the monthly inventory report…</p>
      </div>
    </div>
  );
}

/** What Resume AI hands back: the resume itself, laid out, scored. */
export function ResumeOutArt() {
  const sample = sampleResume(useCountry());
  // A whole resume page: drawn once it's near the screen (the built HTML keeps the light placeholder).
  const [ref, near] = useNear<HTMLDivElement>();
  return (
    <div ref={ref} aria-hidden="true" className="relative h-full p-4">
      <div className="mx-auto h-full w-[18rem] overflow-hidden rounded-t-lg ring-1 ring-zinc-900/10" style={{ maskImage: "linear-gradient(to bottom, #000 70%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 70%, transparent)" }}>
        {near ? <Paper data={sample.data} design={lookFor(sample, "modern")} widths={[288, 288]} className="h-full w-full" /> : <PagePlaceholder />}
      </div>
      <span className="mk-menu-shadow absolute right-3 top-3 rounded-lg mk-surface px-2 py-1 text-[0.6875rem] font-semibold text-emerald-800 dark:text-emerald-200">ATS 98</span>
    </div>
  );
}
