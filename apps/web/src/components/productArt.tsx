import type { ReactNode } from "react";
import { Check, CircleAlert, Clock, MapPin, Reveal, cx, isIndia, useCountUp, useInView } from "@orbit/ui";
import { useCountry } from "../lib/country";

/**
 * Pictures of what each product gives you, drawn with HTML (not stock images, never real people's data): the front
 * page's product bands and the products' own pages use them. Decorative: the text beside each says what it shows.
 * Numbers count up the first time a picture scrolls into view (Full motion only; `useCountUp`).
 */

export function ScoreRing({ value, max = 100, size = 64, tone }: { value: number; max?: number; size?: number; tone: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-zinc-200 dark:stroke-white/10" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(value / max) * c} ${c}`} className={tone} />
    </svg>
  );
}

const STAGE: Record<"interview" | "resume" | "jobs", { glow: string; planet: string }> = {
  interview: { glow: "from-indigo-500/[0.16] via-indigo-400/[0.05]", planet: "fill-indigo-500 dark:fill-indigo-400" },
  resume: { glow: "from-emerald-500/[0.16] via-emerald-400/[0.05]", planet: "fill-emerald-500 dark:fill-emerald-400" },
  jobs: { glow: "from-sky-500/[0.16] via-sky-400/[0.05]", planet: "fill-sky-500 dark:fill-sky-400" },
};

/**
 * The product's picture sits on a small stage: its colour as a soft wash, with Orbit's hairline orbits and a planet
 * riding one of them, so the three read as one set. Purely decorative: the band's text says what it shows.
 */
export function Stage({ product, children }: { product: keyof typeof STAGE; children: ReactNode }) {
  const { glow, planet } = STAGE[product];
  return (
    <div aria-hidden="true" className={cx("relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br to-transparent p-5 ring-1 ring-zinc-200/80 sm:p-7 dark:ring-white/10", glow)}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 -z-10 h-full w-full" fill="none">
        <ellipse cx="200" cy="150" rx="190" ry="78" transform="rotate(-14 200 150)" className="stroke-zinc-300/70 dark:stroke-white/10" strokeDasharray="2 6" />
        <ellipse cx="200" cy="150" rx="130" ry="52" transform="rotate(-14 200 150)" className="stroke-zinc-300/50 dark:stroke-white/[0.07]" />
        <circle cx="384" cy="103" r="5" className={planet} />
        <circle cx="384" cy="103" r="10" className={cx(planet, "opacity-20")} />
        <circle cx="40" cy="44" r="1.4" className="fill-zinc-400/60 dark:fill-white/40" />
        <circle cx="356" cy="262" r="1.2" className="fill-zinc-400/60 dark:fill-white/40" />
        <circle cx="310" cy="30" r="1" className="fill-zinc-400/60 dark:fill-white/30" />
      </svg>
      {children}
    </div>
  );
}

/** The AI interviewer asking, then the round's scorecard (like the real session review); the score counts up. */
export function PracticeMock() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const score = useCountUp(7.5, seen);
  return (
    <Stage product="interview">
      <div ref={ref} className="relative">
        <div className="w-[86%] rounded-2xl bg-white p-3.5 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-aurora-400 text-xs font-semibold text-white">AI</span>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Interviewer</span>
            <span className="ml-auto flex h-4 items-end gap-0.5">
              {[0.5, 0.9, 0.6, 1, 0.4, 0.7].map((h, i) => (
                <span key={i} className="w-0.5 origin-bottom rounded-full bg-indigo-500 motion-ok:animate-wave dark:bg-indigo-300" style={{ height: `${h * 100}%`, animationDelay: `${i * 0.11}s` }} />
              ))}
            </span>
          </div>
          <p className="mt-2 font-display text-[0.9375rem] leading-snug">Why should we hire you for this role?</p>
        </div>
        <div className="relative -mt-2 ml-auto w-[88%] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <ScoreRing value={score} max={10} tone="stroke-indigo-500" />
              <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-semibold tabular-nums">{score.toFixed(1)}</span>
            </div>
            <div>
              <p className="text-sm font-semibold">HR round, 5 minutes</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Score out of 10</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs">
            {(
              [
                [Check, "text-emerald-600 dark:text-emerald-400", "Clear structure in “Tell me about yourself”"],
                [CircleAlert, "text-amber-600 dark:text-amber-400", "Redo: say what the result was"],
                [Clock, "text-zinc-500", "138 words a minute, a good pace"],
              ] as const
            ).map(([Icon, tone, text], i) => (
              <Reveal as="li" key={text} delay={250 + i * 120} className="flex items-center gap-2">
                <Icon className={cx("h-3.5 w-3.5", tone)} /> {text}
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </Stage>
  );
}

/** A resume page with its ATS score going up as the fixes go in. */
export function ResumeMock() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const score = useCountUp(82, seen, { from: 54 });
  const bar = "rounded-full bg-zinc-200 dark:bg-white/10";
  return (
    <Stage product="resume">
      <div ref={ref} className="relative pb-28">
        <div className="ml-auto w-[78%] -rotate-2 rounded-xl bg-white p-4 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <p className="font-display text-sm font-semibold text-emerald-700 dark:text-emerald-300">Ananya Iyer</p>
          <p className="text-[0.625rem] text-zinc-500 dark:text-zinc-400">Data Analyst · SQL, Python, Power BI</p>
          <div className="mt-3 space-y-1.5">
            <div className={cx("h-1.5 w-1/3", "rounded-full bg-emerald-500/40")} />
            <div className={cx("h-1.5 w-full", bar)} />
            <div className={cx("h-1.5 w-11/12", bar)} />
            <div className={cx("h-1.5 w-4/5", bar)} />
            <div className={cx("mt-3 h-1.5 w-1/4", "rounded-full bg-emerald-500/40")} />
            <div className={cx("h-1.5 w-full", bar)} />
            <div className={cx("h-1.5 w-10/12", bar)} />
            <div className={cx("h-1.5 w-9/12", bar)} />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 w-[70%] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <ScoreRing value={score} tone="stroke-emerald-500" />
              <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-semibold tabular-nums">{Math.round(score)}</span>
            </div>
            <div>
              <p className="text-sm font-semibold">ATS score</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Up from <span className="tabular-nums">54</span> after 3 fixes
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs">
            {["Skills match the job post", "Each project says what you did", "One page, easy to scan"].map((t, i) => (
              <Reveal as="li" key={t} delay={300 + i * 140} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {t}
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </Stage>
  );
}

/** Jobs AI's feed: the best match on top of the others (labelled an example); its match counts up. */
// The example job's city, where the visitor applies (India's tech capital first).
const SAMPLE_CITY: Record<string, string> = {
  IN: "Bengaluru", US: "Austin", GB: "London", CA: "Toronto", AU: "Sydney", DE: "Berlin", IE: "Dublin", NL: "Amsterdam",
  AE: "Dubai", SG: "Singapore", FR: "Paris", NZ: "Auckland", ZA: "Cape Town", PH: "Manila", PK: "Lahore", NG: "Lagos",
};

export function JobMock() {
  const country = useCountry();
  const [ref, seen] = useInView<HTMLDivElement>();
  const match = useCountUp(78, seen);
  const ghost = "absolute inset-x-6 rounded-2xl bg-white/80 ring-1 ring-zinc-200 dark:bg-zinc-900/80 dark:ring-white/10";
  return (
    <Stage product="jobs">
      <div ref={ref} className="relative pt-7">
        <div className={cx(ghost, "top-0 h-16 rotate-[2.5deg]")} />
        <div className={cx(ghost, "top-3 h-16 -rotate-[1.5deg]")} />
        <div className="relative rounded-2xl bg-white p-4 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Data Analyst, {isIndia(country) ? "fresher" : "entry level"}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">An example company</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <MapPin className="h-3.5 w-3.5" /> {SAMPLE_CITY[country] ?? "Remote"}, hybrid
              </p>
            </div>
            <div className="relative">
              <ScoreRing value={match} size={56} tone="stroke-sky-500" />
              <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                <span className="font-display text-sm font-semibold tabular-nums text-sky-800 dark:text-sky-200">{Math.round(match)}%</span>
                <span className="text-[0.5625rem] text-sky-800 dark:text-sky-200">match</span>
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-200">Posted 6 hours ago</span>
            <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 font-medium text-zinc-700 dark:text-zinc-300">From the company's careers page</span>
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            You have: SQL, Excel, Python. <span className="text-zinc-500 dark:text-zinc-400">It also asks for: Tableau.</span>
          </p>
        </div>
      </div>
    </Stage>
  );
}
