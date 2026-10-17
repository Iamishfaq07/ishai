import { useEffect, useRef, useState } from "react";
import { Check, Circle, Copy, Feather, Maximize2, Minimize2, OrbitLogo, RefreshCw, cx, focusRing, useMotion } from "@orbit/ui";

/**
 * The front page's hero picture: Orbit's live session as it looks in the app (the interviewer's words, the question it
 * detected, an answer drawn from the resume with its key points and sources), drawn in HTML so it's crisp at any size,
 * in both themes and every accent. At Full motion it plays once when it's on screen: the question arrives word by word,
 * Orbit marks it, the answer streams in. Gentle, Off and data saver show the finished card. Screen readers get one
 * plain description; the picture itself is hidden from them. Sample data: a fictional candidate and company.
 */

const QUESTION = "Tell me about a time you used data to change a product decision.";
const ANSWER =
  "At Lumen Analytics, I saw that most trial users left before connecting their first data source. I split the funnel " +
  "by device and found setup took six screens on mobile. I made the case to cut it to two, and we tested the short flow " +
  "against the old one. Trial-to-paid went up 12% that quarter, and the short flow became the default.";
const POINTS = ["Spotted the drop-off", "Found the cause", "Tested a fix", "The result"];
const SOURCES = [
  "Resume · Lumen Analytics: Product analyst, 2023 to now",
  "Resume: Cut mobile onboarding from 6 screens to 2, +12% trial-to-paid",
];

const Q_WORDS = QUESTION.split(" ");
const A_WORDS = ANSWER.split(" ");
// Ticks of 55 ms: the question at one word every 2 ticks, a pause while Orbit marks it, then one answer word a tick.
const Q_END = Q_WORDS.length * 2;
const DETECTED = Q_END + 4;
const A_START = DETECTED + 8;
const A_END = A_START + A_WORDS.length;
const END = A_END + 6;

function useSaveData(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);
}

export function LiveAnswerDemo({ className }: { className?: string }) {
  const motion = useMotion();
  const saveData = useSaveData();
  const play = motion === "full" && !saveData;
  const box = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(() => (play ? 0 : END));
  const [run, setRun] = useState(0);

  // A setting changed to Gentle or Off mid-play: show the finished card.
  useEffect(() => {
    if (!play) setTick(END);
  }, [play]);

  useEffect(() => {
    if (!play) return;
    const el = box.current;
    let timer = 0;
    let n = 0;
    const start = () => {
      timer = window.setInterval(() => {
        n += 1;
        setTick(n);
        if (n >= END) window.clearInterval(timer);
      }, 55);
    };
    // Starts when most of it is in view (the hero on a laptop; further down on a phone), and pauses with the tab.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          io.disconnect();
          start();
        }
      },
      { threshold: 0.45 },
    );
    if (el) io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
    // Only "Play again" (run) restarts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const qShown = Math.min(Q_WORDS.length, Math.ceil(tick / 2));
  const detected = tick >= DETECTED;
  const aShown = Math.max(0, Math.min(A_WORDS.length, tick - A_START));
  const streaming = tick >= A_START && tick < A_END;
  const done = tick >= END;
  const listening = !detected;
  // The candidate has said the first points by the time the answer is complete (the app ticks them off as you speak).
  const said = done ? 2 : 0;

  return (
    <figure className={cx("relative w-full", className)}>
      <div ref={box} aria-hidden="true" className="mk-float relative overflow-hidden rounded-2xl mk-surface">
        {/* Title bar: the session, whether Orbit is listening, the clock. */}
        <div className="flex items-center gap-2.5 border-b mk-line px-4 py-2.5">
          <OrbitLogo size={18} animated={false} />
          <span className="truncate text-[0.8125rem] font-medium text-zinc-900 dark:text-zinc-100">Live session</span>
          <span className="hidden truncate text-[0.8125rem] text-zinc-500 sm:inline dark:text-zinc-400">· Product analyst, final round</span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-200">
            <span className="flex h-2.5 items-end gap-[2px]">
              {[0.5, 1, 0.7].map((h, i) => (
                <span
                  key={i}
                  className={cx("w-[2px] origin-bottom rounded-full bg-current", listening && play && !done && "mk-listen")}
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            Listening
          </span>
          <span className="text-[0.75rem] tabular-nums text-zinc-500 dark:text-zinc-400">12:40</span>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {/* The interviewer's words, as the transcript shows them. */}
          <div className="flex gap-3">
            <span className="mt-0.5 w-[4.5rem] shrink-0 text-[0.6875rem] font-medium text-zinc-500 dark:text-zinc-400">Interviewer</span>
            <p className="min-h-[2.5rem] text-[0.8125rem] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {Q_WORDS.slice(0, qShown).join(" ")}
              {!detected && <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-zinc-400" />}
            </p>
          </div>

          {/* The detected question. */}
          <div className={cx("rounded-xl border mk-line px-3.5 py-3 transition-opacity duration-panel", detected ? "opacity-100" : "opacity-0")}>
            <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-zinc-500 dark:text-zinc-400">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} /> Question · Behavioural
            </p>
            <p className="mt-1 text-[0.875rem] font-medium leading-snug text-zinc-950 dark:text-white">{QUESTION}</p>
          </div>

          {/* The answer, from the resume. */}
          <div className="rounded-xl bg-indigo-500/[0.045] px-3.5 py-3 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15">
            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] font-medium text-indigo-700 dark:text-indigo-300">Answer</span>
              <span className="rounded-full bg-white px-1.5 py-px text-[0.625rem] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
                Medium answer
              </span>
              <span className="ml-auto flex items-center gap-0.5 text-zinc-400 dark:text-zinc-500">
                {[Minimize2, Maximize2, Feather, Copy].map((Icon, i) => (
                  <span key={i} className="grid h-6 w-6 place-items-center rounded-md">
                    <Icon className="h-3 w-3" />
                  </span>
                ))}
              </span>
            </div>
            <p className="mt-1.5 min-h-[7.5rem] text-[0.8125rem] leading-relaxed text-zinc-800 sm:min-h-[6.5rem] sm:text-[0.875rem] dark:text-zinc-100">
              {play && !done
                ? A_WORDS.slice(0, aShown).map((w, i) => (
                    <span key={`${run}-${i}`} className="mk-word">
                      {w}{" "}
                    </span>
                  ))
                : ANSWER}
              {streaming && <span className="mk-caret" />}
            </p>
            <div className={cx("transition-opacity duration-panel", done ? "opacity-100" : "opacity-0")}>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {POINTS.map((p, i) => (
                  <li
                    key={p}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset",
                      i < said
                        ? "bg-emerald-500/10 text-emerald-800 ring-emerald-600/20 dark:text-emerald-200"
                        : "bg-white text-zinc-600 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
                    )}
                  >
                    {i < said ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Circle className="h-2 w-2" />}
                    {p}
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-0.5 border-t border-indigo-500/10 pt-2.5 text-[0.6875rem] text-zinc-500 dark:border-indigo-300/10 dark:text-zinc-400">
                {SOURCES.map((s) => (
                  <li key={s} className="flex min-w-0 items-center gap-1.5">
                    <Check className="h-3 w-3 flex-none text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                    <span className="truncate">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 flex min-h-8 items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          <span className="sr-only">
            An example of Orbit's live session with sample data. The interviewer asks: “{QUESTION}” Orbit marks it as a
            behavioural question and suggests an answer from the candidate's resume: “{ANSWER}” It lists the answer's
            key points, ticks off the ones already said, and shows the two resume lines it used.
          </span>
          <span aria-hidden="true">Live session, with sample data.</span>
        </span>
        {done && play && (
          <button
            type="button"
            onClick={() => {
              setTick(0);
              setRun((r) => r + 1);
            }}
            className={cx("inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 font-medium text-zinc-600 hover:bg-zinc-900/[0.04] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Play again
          </button>
        )}
      </figcaption>
    </figure>
  );
}
