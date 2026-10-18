import type { LinkedInRead, LinkedInSectionScore } from "@orbit/types";
import { Check, Copy, FileUp, Sparkles, Wand2, cx, wordDiff } from "@orbit/ui";
import { Chips, FakeButton, Panel, SampleTag, TickRows, Typed, at, stepsDone, typedWords, useClock, usePlay } from "../../marketing/kit";
import { HEADLINE_SHOWN, scoreWord } from "./model";
import { ScoreRing, SectionBars } from "./ScorePanel";

/**
 * LinkedIn AI's public page, drawn with LinkedIn AI itself (DECISIONS D79): the real score ring and section bars
 * (ScorePanel), the real recruiter-search preview (SearchPreview, on the page), and a fix card in SuggestionCard's
 * look. The sample profile is made up; its scores are the real audit's (orbit_api/linkedin/audit.py, run on it with
 * the role "Data Analyst"): 47 as read, then 61, 73, 80, 91 and 94 as the headline, the About, the latest role, the
 * skills and the custom URL are fixed. Orbit's own drawing, never LinkedIn's look or logo (DESIGN.md, LinkedIn AI).
 */

type Row = [LinkedInSectionScore["id"], string, number];
const sec = (rows: Array<[LinkedInSectionScore["id"], string, number, number]>): LinkedInSectionScore[] =>
  rows.map(([id, label, points, max]) => ({ id, label, points, max, known: true, roles: [] }));
const MAX: Record<string, number> = { headline: 20, about: 20, experience: 21, skills: 15, keywords: 10, education: 7, url: 3 };
const LABELS: Row[] = [
  ["headline", "Headline", 0],
  ["about", "About", 0],
  ["experience", "Experience", 0],
  ["skills", "Skills", 0],
  ["keywords", "Search keywords", 0],
  ["education", "Education and certifications", 0],
  ["url", "Custom URL", 0],
];
/** Each section's points after each step, in LABELS' order (the audit's own numbers). */
const POINTS = [
  [9, 6, 14, 4, 5, 7, 0],
  [20, 6, 14, 4, 8, 7, 0],
  [20, 17, 14, 4, 8, 7, 0],
  [20, 17, 21, 4, 8, 7, 0],
  [20, 17, 21, 12, 10, 7, 0],
  [20, 17, 21, 12, 10, 7, 3],
];
const SCORES = [47, 61, 73, 80, 91, 94];
const FIXES = [
  { label: "Rewrite the headline", note: "Written by AI", gain: 14 },
  { label: "Rewrite the About", note: "Written by AI", gain: 12 },
  { label: "Rewrite Data Analyst at Dhan Retail", note: "Written by AI", gain: 7 },
  { label: "Reorder and add skills", note: "Worked out by Orbit, free", gain: 11 },
  { label: "Set a custom URL", note: "Worked out by Orbit, free", gain: 3 },
];
const sectionsAt = (step: number) => sec(LABELS.map(([id, label], i) => [id, label, POINTS[step]![i]!, MAX[id]!]));

export const HEADLINE_BEFORE = "Data Analyst at Dhan Retail";
export const HEADLINE_AFTER = "Data Analyst · SQL, Python, Power BI · Dashboards used by 40+ store managers";
const ABOUT_AFTER =
  "Data analyst at Dhan Retail, turning sales and inventory data into Power BI dashboards that 40+ store managers use every week. I automated our monthly inventory report with Python and SQL, from 2 days to 3 hours. Open to data analyst roles in Bengaluru.";

/** The sample profile as LinkedIn has it, and as Orbit's copy reads with the fixes (for the search preview). */
export const PROFILE_BEFORE: LinkedInRead = {
  name: "Ananya Iyer",
  headline: HEADLINE_BEFORE,
  location: "Bengaluru, Karnataka, India",
  about: "I am a data analyst who likes working with data.",
  url: "linkedin.com/in/ananya-iyer-8b21a4193",
  experience: [
    { title: "Data Analyst", company: "Dhan Retail Pvt. Ltd.", dates: "July 2023 - Present", current: true, description: "Working on dashboards and reports for the stores." },
    { title: "Analytics Intern", company: "Insight Labs", dates: "January 2023 - June 2023", current: false, description: "" },
  ],
  education: [{ school: "Pune Institute of Technology", degree: "B.Tech, Computer Science" }],
  skills: ["SQL", "Excel"],
  certifications: ["Google Data Analytics Certificate"],
};
export const PROFILE_AFTER: LinkedInRead = { ...PROFILE_BEFORE, headline: HEADLINE_AFTER, about: ABOUT_AFTER, url: "linkedin.com/in/ananya-iyer" };

/**
 * The hero: the profile's score ring and section bars (the real ones), going from 47 to 94 as the five fixes are
 * applied one after another; the ring counts on from each score with the change beside it, the bars slide.
 */
export function LinkedInHeroArt() {
  const p = usePlay<HTMLDivElement>();
  const times = FIXES.map((_, i) => 900 + i * 750);
  const t = useClock(p.shown, p.play, times[times.length - 1]! + 1800);
  const step = stepsDone(times, t);
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[32rem] lg:mr-0">
      <div
        ref={p.ref}
        {...p.attrs}
        role="img"
        aria-label={`A sample LinkedIn profile scored by LinkedIn AI: 47 out of 100 as read, then 94 after five fixes: ${FIXES.map((f) => `${f.label.toLowerCase()}, plus ${f.gain}`).join("; ")}.`}
        className="kp relative pb-44 sm:pb-36"
      >
        <div aria-hidden="true" inert className="mk-float rounded-2xl mk-surface p-5">
          <div className="flex items-center gap-4">
            <ScoreRing score={SCORES[step]!} size={88} />
            <div className="min-w-0">
              <p className="text-base font-semibold text-zinc-950 dark:text-white">{scoreWord(SCORES[step]!)}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Ananya Iyer · for Data Analyst roles</p>
              <SampleTag className="mt-1.5 inline-block">Sample profile</SampleTag>
            </div>
          </div>
          <div className="mt-4 text-sm">
            <SectionBars sections={sectionsAt(step)} flash={null} />
          </div>
        </div>
        <div className="kp-in mk-menu-shadow absolute inset-x-3 bottom-0 rounded-xl mk-surface p-3.5 sm:inset-x-auto sm:-left-8 sm:w-[19rem]" style={at(300, { y: 10 })}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Raise it: five fixes
          </p>
          <TickRows className="mt-2.5" times={times} rows={FIXES.map((f) => ({ label: f.label, note: f.note, meta: `+${f.gain}` }))} />
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">A made-up profile, scored by LinkedIn AI's own check.</figcaption>
    </figure>
  );
}

/** A fix in SuggestionCard's look: before and after with the changed words marked, the count, Copy, Done on LinkedIn. */
export function FixCardArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 2600);
  const done = t >= 1900;
  const tokens = wordDiff(HEADLINE_BEFORE, HEADLINE_AFTER);
  const shown = HEADLINE_AFTER.slice(0, HEADLINE_SHOWN + 1);
  const cut = shown.lastIndexOf(" ") > HEADLINE_SHOWN / 2 ? shown.lastIndexOf(" ") : HEADLINE_SHOWN;
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`The headline fix, ready to paste. On LinkedIn now: "${HEADLINE_BEFORE}". Paste this: "${HEADLINE_AFTER}", ${HEADLINE_AFTER.length} of 220 characters. Copy, then tick Done on LinkedIn.`} className="kp">
      <div className={cx("rounded-xl border mk-surface p-3.5 transition-colors duration-panel", done ? "border-emerald-500/30 dark:border-emerald-400/20" : "mk-line")}>
        <p className="text-sm font-semibold text-zinc-950 dark:text-white">Headline</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.6875rem]">
          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-800 dark:text-indigo-200">Written by AI</span>
          <span className="text-zinc-500 dark:text-zinc-400">From your profile and resume</span>
          {done && <span className="kp-pop rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-200">Done on LinkedIn</span>}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-zinc-500/5 p-2.5 ring-1 ring-inset ring-zinc-500/10">
            <p className="mb-1 text-[0.6875rem] font-medium text-zinc-500 dark:text-zinc-400">On LinkedIn now</p>
            <p className="text-[0.75rem] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {tokens.filter((x) => x.kind !== "added").map((x, i) => (x.kind === "removed" ? <del key={i} className="text-rose-800/80 decoration-rose-500/60 dark:text-rose-200/80">{x.text}</del> : <span key={i}>{x.text}</span>))}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-500/5 p-2.5 ring-1 ring-inset ring-emerald-500/20">
            <p className="mb-1 text-[0.6875rem] font-medium text-emerald-800 dark:text-emerald-300">Paste this</p>
            <p className="text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100">
              {tokens.filter((x) => x.kind !== "removed").map((x, i) => (x.kind === "added" ? <ins key={i} className="kp-lit rounded-sm bg-emerald-500/15 text-emerald-900 no-underline dark:text-emerald-100" style={at(300 + i * 40)}>{x.text}</ins> : <span key={i}>{x.text}</span>))}
            </p>
          </div>
        </div>
        <p className="mt-2 flex flex-wrap justify-between gap-2 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
          <span className="tabular-nums">{HEADLINE_AFTER.length}/220 characters</span>
          <span>
            A search result shows about: <span className="text-zinc-700 dark:text-zinc-300">“{HEADLINE_AFTER.slice(0, cut)}…”</span>
          </span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FakeButton className={cx("transition-transform duration-press-out", t >= 900 && t < 1150 && "scale-[0.97]")}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
          </FakeButton>
          <FakeButton>
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Apply to my Orbit copy
          </FakeButton>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-2 text-[0.75rem] text-zinc-800 dark:text-zinc-100">
            <span className={cx("grid h-4 w-4 place-items-center rounded border transition-colors duration-press", done ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-white/25")}>
              {done && <Check className="kp-pop h-3 w-3" strokeWidth={3} aria-hidden="true" />}
            </span>
            Done on LinkedIn
          </span>
        </div>
        <div className="mt-3 rounded-lg bg-zinc-500/5 px-3 py-2 text-[0.6875rem] text-zinc-700 dark:text-zinc-300">
          <p className="font-medium text-zinc-600 dark:text-zinc-300">Where to paste it on LinkedIn</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>On LinkedIn, open your profile (Me → View profile).</li>
            <li>Click the pencil (Edit) icon in your intro, beside your photo.</li>
            <li>Replace the Headline with this, then Save.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

/** The About rewritten from the profile and resume, typed in, with where "see more" cuts it. */
export function AboutArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3600);
  const typed = typedWords(ABOUT_AFTER, t, 300, 70);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`The About, rewritten: "${ABOUT_AFTER}"`} className="kp">
      <Panel title="About" meta={<SampleTag />}>
        <Typed className="p-3 text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100" text={ABOUT_AFTER} shown={typed.shown} typing={typed.typing} />
      </Panel>
      <p className="kp-fade mt-2 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(3300)}>
        Your role and best result come first: about 265 characters show before “see more”.
      </p>
    </div>
  );
}

/** The search keywords: the ones the profile has, lighting up, and the one it's missing. */
export function KeywordsArt() {
  const p = usePlay<HTMLDivElement>();
  const found = ["SQL", "Python", "Power BI", "Tableau", "Excel", "Statistics", "A/B testing", "BigQuery", "Dashboards"];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Search keywords for data analyst roles: the profile now has ${found.join(", ")}; it's missing Forecasting.`} className="kp">
      <p className="text-[0.75rem] font-medium text-zinc-900 dark:text-white">9 of 10 skills employers ask for</p>
      <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">From job posts for Data Analyst roles</p>
      <Chips className="mt-3" from={300} every={90} items={[...found.map((label) => ({ label, on: true })), { label: "Forecasting", on: false }]} />
    </div>
  );
}

/** The free fixes, worked out without AI: a clean custom URL and the skills in the order to list them. */
export function FreeFixesArt() {
  const p = usePlay<HTMLDivElement>();
  const skills = ["SQL", "Python", "Power BI", "Tableau", "Statistics", "A/B testing", "BigQuery", "Excel"];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="Free fixes: the custom URL linkedin.com/in/ananya-iyer instead of one ending in numbers, and the skills in the order to list them." className="kp space-y-3">
      <div className="rounded-lg border mk-line mk-surface p-2.5 text-[0.75rem]">
        <p className="text-[0.6875rem] font-medium text-zinc-500 dark:text-zinc-400">Custom URL</p>
        <p className="mt-0.5 truncate text-zinc-500 line-through decoration-rose-400/60">linkedin.com/in/ananya-iyer-8b21a4193</p>
        <p className="kp-in truncate font-medium text-zinc-900 dark:text-zinc-100" style={at(300, { y: 4 })}>
          linkedin.com/in/ananya-iyer
        </p>
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-hidden="true">
        {skills.map((s, i) => (
          <li key={s} className={cx("kp-in inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] ring-1 ring-inset", i === 0 || i === 7 ? "bg-zinc-500/5 text-zinc-700 ring-zinc-500/15 dark:text-zinc-300" : "bg-emerald-500/10 text-emerald-900 ring-emerald-500/25 dark:text-emerald-100", i < 5 && "font-medium")} style={at(500 + i * 80, { y: 4 })}>
            {i < 5 && <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{i + 1}</span>}
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Step 1: LinkedIn's PDF of the profile, uploaded and read. */
export function PdfStepArt() {
  const p = usePlay<HTMLDivElement>();
  const rows: Array<[string, string]> = [
    ["Headline and About", "read"],
    ["Experience", "2 roles"],
    ["Skills", "2 skills"],
    ["Education", "1 school"],
  ];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="LinkedIn's PDF of a profile, uploaded and read into its sections." className="kp w-full max-w-[17rem]">
      <Panel>
        <div className="flex items-center gap-2.5 border-b mk-line p-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300">
            <FileUp className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.75rem] font-medium text-zinc-900 dark:text-zinc-100">Profile.pdf</span>
            <span className="block text-[0.6875rem] text-zinc-500 dark:text-zinc-400">Saved from LinkedIn</span>
          </span>
        </div>
        <ul className="space-y-1 p-2.5">
          {rows.map(([name, meta], i) => (
            <li key={name} className="kp-in flex items-center gap-2 px-1.5 py-0.5 text-[0.75rem]" style={at(300 + i * 180, { y: 6 })}>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} aria-hidden="true" />
              <span className="flex-1 text-zinc-800 dark:text-zinc-100">{name}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{meta}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Step 2: the score and the fixes worth most, first. */
export function ScoreStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="The profile's score, 47 out of 100, and its fixes worth most first: skills plus 17, the About plus 14, the headline plus 11." className="kp w-full max-w-[17rem]">
      <Panel>
        <div aria-hidden="true" inert className="flex items-center gap-3 border-b mk-line p-3">
          <ScoreRing score={47} size={56} />
          <span className="text-[0.75rem]">
            <span className="block font-medium text-zinc-900 dark:text-white">{scoreWord(47)}</span>
            <span className="text-zinc-500 dark:text-zinc-400">Biggest gain first</span>
          </span>
        </div>
        <ul className="space-y-1 p-2.5 text-[0.75rem]">
          {[["Reorder and add skills", 17], ["Rewrite the About", 14], ["Rewrite the headline", 11]].map(([label, gain], i) => (
            <li key={label} className="kp-in flex items-center justify-between gap-2 px-1.5 py-0.5" style={at(500 + i * 160, { y: 6 })}>
              <span className="text-zinc-800 dark:text-zinc-100">{label}</span>
              <span className="rounded-full bg-emerald-500/10 px-1.5 font-semibold tabular-nums text-emerald-800 dark:text-emerald-200">+{gain}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Step 3: Copy, paste on LinkedIn, tick it done. */
export function PasteStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="Copy a fix, paste it into LinkedIn, then tick Done on LinkedIn." className="kp w-full max-w-[17rem]">
      <Panel title="Headline" meta={`${HEADLINE_AFTER.length}/220 characters`}>
        <div className="space-y-2.5 p-3">
          <p className="rounded-lg bg-emerald-500/5 px-2 py-1.5 text-[0.75rem] leading-snug text-zinc-800 ring-1 ring-inset ring-emerald-500/20 dark:text-zinc-100">{HEADLINE_AFTER}</p>
          <div className="flex items-center justify-between">
            <FakeButton>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
            </FakeButton>
            <span className="inline-flex items-center gap-2 text-[0.75rem] text-zinc-800 dark:text-zinc-100">
              <span className="grid h-4 w-4 place-items-center rounded border border-indigo-600 bg-indigo-600 text-white">
                <Check className="kp-pop h-3 w-3" strokeWidth={3} aria-hidden="true" style={at(700)} />
              </span>
              Done on LinkedIn
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
