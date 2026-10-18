import { Fragment } from "react";
import type { JobStatus } from "@orbit/types";
import { ArrowUpRight, Building2, CalendarCheck, Check, CircleAlert, Clock, Copy, MapPin, Sparkles, cx, sampleCity } from "@orbit/ui";
import { useCountry } from "../../lib/country";
import { Bubble, Chips, FakeButton, Panel, Ring, SampleTag, TickRows, Typed, at, typedWords, useClock, usePlay } from "../../marketing/kit";
import { STATUS_MARK } from "./model";
import { StagePill } from "./StagePill";

/**
 * Jobs AI's public page, drawn with Jobs AI's own pieces (DECISIONS D79): the match card, the fit check, the tracker's
 * columns and stage marks (STATUS_MARK, StagePill), the Mission room's steps and its interview-day tasks. Employers and
 * people are made up and marked as examples; the sources and the tasks are the product's own.
 */

const JOB = { title: "Backend Engineer", company: "Kestrel Pay", match: 88, have: ["Python", "Go", "Kubernetes", "PostgreSQL"], missing: "Kafka" };

/** The hero: an example match whose score counts up and skills light up, then the AI fit check beside it. */
export function JobsHeroArt() {
  const city = sampleCity(useCountry());
  const p = usePlay<HTMLDivElement>();
  const solid = "mk-float rounded-2xl mk-surface";
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[30rem] lg:mr-0">
      <div
        ref={p.ref}
        {...p.attrs}
        role="img"
        aria-label={`An example match in Jobs AI: ${JOB.title} at ${JOB.company}, ${city ? `in ${city}` : "remote"}, an ${JOB.match} percent match with ${JOB.have.join(", ")} on the resume and ${JOB.missing} missing, then an AI fit check that says it's a strong fit.`}
        className="kp relative pb-28 sm:pb-32"
      >
        <div className={cx(solid, "relative p-5")}>
          <SampleTag className="absolute right-3 top-3">Example</SampleTag>
          <div className="pr-20">
            <p className="text-lg font-semibold leading-snug text-zinc-950 dark:text-white">{JOB.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> {JOB.company}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> {city ? `${city} · Hybrid` : "Remote"}
              </span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" /> 3h ago
              </span>
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">New</span>
              <span>· Full-time · 3-5 years</span>
            </p>
          </div>
          <span className="absolute right-4 top-11 flex flex-col items-center">
            <Ring value={JOB.match} start={p.shown} size={58} suffix="%" />
            <span className="mt-0.5 text-[0.625rem] text-zinc-500 dark:text-zinc-400">match</span>
          </span>
          <Chips className="mt-4" from={500} every={120} items={JOB.have.map((label) => ({ label, on: true }))} />
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Not on your resume:</span> {JOB.missing}
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">From {JOB.company}'s careers page</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <FakeButton primary>
              Apply <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </FakeButton>
            <FakeButton>Save</FakeButton>
            <FakeButton>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Check my fit
            </FakeButton>
          </div>
        </div>
        <div className={cx(solid, "kp-in absolute inset-x-3 bottom-0 p-3.5 sm:inset-x-auto sm:-left-10 sm:w-80")} style={at(1300, { y: 12 })}>
          <p className="flex items-center gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
            <span className="font-medium text-indigo-700 dark:text-indigo-300">Fit check</span>
            <span className="kp-grow rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300" style={at(1700)}>
              Strong fit
            </span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-200">
            <li className="kp-in flex gap-1.5" style={at(1900, { y: 4 })}>
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" /> Three years of Go and Python services, as the post asks.
            </li>
            <li className="kp-in flex gap-1.5" style={at(2100, { y: 4 })}>
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" /> It wants Kafka, which your resume doesn't show.
            </li>
          </ul>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">An example match, with made-up employers.</figcaption>
    </figure>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Step 1: the resume read into a search profile you can change. */
export function ProfileStepArt() {
  const p = usePlay<HTMLDivElement>();
  const groups: Array<[string, string[]]> = [
    ["Titles", ["Data Analyst", "Product Analyst"]],
    ["Skills", ["SQL", "Python", "Power BI", "A/B testing"]],
    ["Where", ["Bengaluru", "Remote"]],
  ];
  let n = 0;
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="A resume read into a search profile: the titles, skills and places to look for." className="kp w-full max-w-[17rem]">
      <Panel title="Your search profile" meta="from your resume">
        <div className="space-y-2 p-3">
          {groups.map(([label, items]) => (
            <div key={label}>
              <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{label}</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {items.map((x) => (
                  <span key={x} className="kp-pop rounded-full bg-zinc-900/[0.05] px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-800 dark:bg-white/10 dark:text-zinc-100" style={at(200 + n++ * 110)}>
                    {x}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

const MATCHES: Array<[string, string, number]> = [
  ["Product Analyst, Payments", "Kestrel Pay", 91],
  ["Senior Data Analyst", "Lumen Analytics", 84],
  ["Data Analyst, Growth", "Quillbook", 72],
];

/** Step 2: the matches, best first, each with its score. */
export function MatchesStepArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Matches, best first: ${MATCHES.map(([t, c, m]) => `${t} at ${c}, ${m} percent`).join("; ")}. Made-up employers.`} className="kp w-full max-w-[17rem] space-y-1.5">
      {MATCHES.map(([title, company, match], i) => (
        <div key={title} className="kp-in flex items-center gap-2.5 rounded-xl border mk-line mk-surface p-2.5" style={at(150 + i * 220, { y: 8 })}>
          <Ring value={match} start={p.shown} size={38} suffix="%" />
          <span className="min-w-0">
            <span className="block truncate text-[0.75rem] font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
            <span className="block truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{company} · careers page</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Step 3: an application moving along the tracker, where it lands marked. */
export function TrackStepArt() {
  return <TrackerArt compact />;
}

// ─── The tracker ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Example applications by stage; the one marked `moves` slides in from the column before and lands marked. */
const COLUMNS: Array<{ status: JobStatus; cards: Array<{ company: string; note: string; moves?: boolean }> }> = [
  { status: "saved", cards: [{ company: "Tessellate", note: "Saved Fri" }, { company: "Northwind Labs", note: "Saved Fri" }] },
  { status: "applied", cards: [{ company: "Lumen Analytics", note: "Applied Mon" }, { company: "Brightline Health", note: "Applied Fri" }] },
  { status: "interviewing", cards: [{ company: "Kestrel Pay", note: "Interview Mon", moves: true }] },
  { status: "offer", cards: [{ company: "Cobalt Commerce", note: "Offer in" }] },
];

/** The tracker's columns with their stage marks; one card slides in from Applied and wears the landing ring. `compact`
 *  (a step's small render): just Applied and Interviewing. */
export function TrackerArt({ compact = false }: { compact?: boolean }) {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 2400);
  const landed = p.shown && !p.attrs["data-still"] && t >= 1100;
  const columns = compact ? COLUMNS.slice(1, 3) : COLUMNS;
  return (
    <div
      ref={p.ref}
      {...p.attrs}
      role="img"
      aria-label={`The application tracker, by stage: ${columns.map((c) => c.status).join(", ")}. The Kestrel Pay application moves from applied to interviewing. Made-up employers.`}
      className={cx("kp grid w-full gap-1.5", compact ? "max-w-[17rem] grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}
    >
      {columns.map((col) => (
        <div key={col.status} className="min-w-0 rounded-lg bg-zinc-900/[0.03] p-1.5 dark:bg-white/[0.04]">
          <StagePill status={col.status} className="text-[0.6875rem]" />
          <div className="mt-1.5 space-y-1.5">
            {col.cards.map((c) => (
              <div key={c.company} className={cx("relative rounded-md border mk-line mk-surface p-2 pl-2.5", c.moves && "kp-in")} style={c.moves ? at(500, { x: -80 }) : undefined}>
                <span aria-hidden="true" className={cx("absolute inset-y-1.5 left-0 w-0.5 rounded-full", STATUS_MARK[col.status])} />
                {c.moves && landed && <span aria-hidden="true" className="moved-flash pointer-events-none absolute inset-0 rounded-[inherit]" />}
                <span className="block truncate text-[0.6875rem] font-medium text-zinc-900 dark:text-zinc-100">{c.company}</span>
                <span className="block truncate text-[0.625rem] text-zinc-500 dark:text-zinc-400">{c.note}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── The toolkit ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the jobs come from: the careers-page systems Jobs AI reads, then the remote boards, each ticking in. */
export function SourcesArt({ feeds }: { feeds: string[] }) {
  const p = usePlay<HTMLDivElement>();
  const boards = ["Greenhouse", "Lever", "Ashby", "SmartRecruiters"];
  const rows = [...boards.map((b) => ({ label: `${b} job boards`, note: "Companies' own careers pages" })), { label: feeds.join(", "), note: "Remote job boards that allow it" }];
  const times = rows.map((_, i) => 200 + i * 220);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Where the jobs come from: companies' careers pages on ${boards.join(", ")}, and the remote job boards ${feeds.join(", ")}.`} className="kp">
      <TickRows rows={rows} times={times} />
      <p className="kp-fade mt-3 flex items-center gap-1.5 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(1400)}>
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> Apply always opens the original post
      </p>
    </div>
  );
}

const STEPS = ["Discover", "Prove", "Prepare", "Apply", "Interview", "Negotiate"];

/** The Mission room's steps for one application, ticking along to the interview, and what's due before it. */
export function MissionArt() {
  const p = usePlay<HTMLDivElement>();
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="An application's Mission room: discover, prove, prepare and apply done, interview next, in 2 days." className="kp">
      <p className="text-[0.75rem] font-medium text-zinc-900 dark:text-white">Product Analyst, Payments</p>
      <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">Kestrel Pay · Example</p>
      <ol className="mt-3 grid grid-cols-3 gap-1.5">
        {STEPS.map((s, i) => {
          const done = i < 4;
          return (
            <li
              key={s}
              className={cx(
                "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[0.625rem] font-medium",
                done ? "kp-lit border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : i === 4 ? "border-indigo-500/40 text-zinc-800 dark:text-zinc-100" : "mk-line text-zinc-500 dark:text-zinc-400",
              )}
              style={done ? at(200 + i * 200) : undefined}
            >
              {done ? <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : <span className="tabular-nums">{i + 1}</span>}
              <span className="truncate">{s}</span>
            </li>
          );
        })}
      </ol>
      <div className="kp-in mt-3 flex items-baseline gap-4 rounded-lg border mk-line mk-surface px-3 py-2" style={at(1100, { y: 6 })}>
        <span>
          <span className="block text-[0.625rem] text-zinc-500 dark:text-zinc-400">Interview</span>
          <span className="stat-value text-base font-semibold text-zinc-950 dark:text-white">In 2 days</span>
        </span>
        <span>
          <span className="block text-[0.625rem] text-zinc-500 dark:text-zinc-400">Tasks ticked</span>
          <span className="stat-value text-base font-semibold text-zinc-950 dark:text-white">3 of 9</span>
        </span>
      </div>
    </div>
  );
}

const MESSAGE =
  "Hi Meera, I saw Kestrel Pay is hiring a Product Analyst for Payments. I've spent two years on checkout and payments data at Fernway, including the A/B tests behind our new booking flow. Would you be open to referring me? Happy to send my resume.";

/** Outreach: a referral request written from the resume, typed in, with Copy. Orbit never sends it. */
export function OutreachArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 4200);
  const typed = typedWords(MESSAGE, t, 300, 75);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="A referral request to someone at the company, written from the resume, ready to copy and send yourself. Made-up people." className="kp">
      <Panel title="Referral request" meta={<SampleTag />}>
        <div className="p-3">
          <Bubble from="ai">
            <Typed text={MESSAGE} shown={typed.shown} typing={typed.typing} />
          </Bubble>
          <div className="kp-fade mt-2.5 flex items-center gap-2" style={at(3600)}>
            <FakeButton>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
            </FakeButton>
            <span className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">You send it, from your own account</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

const DAY_TASKS = [
  { label: "Read the job post and the company again", note: "Note three things they care about" },
  { label: "Write one STAR story", note: "Situation, task, action, result" },
  { label: "A mock interview on this job post", note: "Then read the review" },
];

/** Interview day: the date ringed and the day-before tasks ticking off (the Mission room's prep plan). */
export function InterviewDayArt() {
  const p = usePlay<HTMLDivElement>();
  const times = DAY_TASKS.map((_, i) => 500 + i * 450);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Interview day: the date marked on a calendar, and the tasks before it: ${DAY_TASKS.map((d) => d.label).join("; ")}.`} className="kp space-y-3">
      <div className="rounded-lg border mk-line mk-surface p-2">
        <p className="flex items-center gap-1 text-[0.6875rem] font-medium text-zinc-800 dark:text-zinc-100">
          <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" /> This week
        </p>
        <div className="mt-1.5 grid grid-cols-7 gap-0.5 text-center text-[0.625rem] text-zinc-500 dark:text-zinc-400">
          {days.map((d, i) => (
            <Fragment key={i}>
              <span>{d}</span>
            </Fragment>
          ))}
          {days.map((_, i) => (
            <span key={`n${i}`} className="relative grid h-5 w-5 place-items-center tabular-nums text-zinc-700 dark:text-zinc-200">
              {19 + i}
              {i === 2 && <span aria-hidden="true" className="kp-pop absolute inset-0 rounded-full ring-2 ring-indigo-500" style={at(200)} />}
            </span>
          ))}
        </div>
      </div>
      <TickRows rows={DAY_TASKS} times={times} />
    </div>
  );
}
