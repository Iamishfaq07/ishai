import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  CircleAlert,
  CircleCheck,
  Code2,
  GraduationCap,
  Headphones,
  Info,
  Mic,
  OrbitWordmark,
  Redo2,
  Sparkles,
  Square,
  Target,
  UserRound,
  type LucideIcon,
  cx,
  buttonClass,
  focusRing,
  speechLang,
  safeSession,
} from "@orbit/ui";
import { Button, Card, Textarea } from "../components/ui";
import { SiteMenu } from "../components/SiteMenu";
import { useAuth } from "../lib/auth";
import { pickRound, trackById, tracksFor, type Track, type TrackId, type WarmupQuestion } from "../lib/warmup/bank";
import { useCountry } from "../lib/country";
import { MIN_WORDS, checkAnswer, spokenTime, summarise, words, type Check, type Verdict } from "../lib/warmup/checks";
import { logWarmupAnswer } from "../lib/weeklyGoal";

/**
 * The Interview Warm-up (`/warmup`, public: no sign-in, no AI, no minutes). Pick a track, answer five questions by
 * typing or (where the browser has speech-to-text) by voice, and get instant tips from rule-based checks
 * (lib/warmup/checks.ts): length, structure (STAR, or now / before / next), numbers, fillers, "I" against "we".
 * Typed answers never leave the page; the round is kept in this tab (sessionStorage) so a phone that reloads the tab
 * doesn't lose it. Signed in or out, it works the same; only the next step it offers differs.
 */
export function WarmupPage() {
  const { user } = useAuth();
  const [state, setState] = useState<RoundState | null>(loadRound);
  useEffect(() => saveRound(state), [state]);

  const start = (track: Track, recent: string[] = []) =>
    setState({ track: track.id, ids: pickRound(track, recent).map((q) => q.id), index: 0, answers: {}, spoken: {}, checked: {}, done: false });

  const country = useCountry();
  const track = state ? trackById(state.track, country) : undefined;
  const questions = track && state ? state.ids.map((id) => track.questions.find((q) => q.id === id)).filter((q): q is WarmupQuestion => Boolean(q)) : [];

  return (
    <div className="min-h-full overflow-x-clip">
      <header className="relative mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit">
          <OrbitWordmark size={26} />
        </Link>
        <span className="hidden h-5 w-px bg-zinc-300 sm:block dark:bg-white/15" aria-hidden="true" />
        <span className="hidden font-display text-sm font-semibold sm:inline">Interview warm-up</span>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <SiteMenu />
          {user ? (
            <Link to="/mock" className={cx(navButton("secondary"))}>
              Back to Practice
            </Link>
          ) : (
            <>
              <Link to="/login" state={{ from: "/mock" }} className={cx(navButton("secondary"), "hidden sm:inline-flex")}>
                Sign in
              </Link>
              <Link to="/register" state={{ from: "/mock" }} className={navButton("primary")}>
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        {!state || !track || questions.length === 0 ? (
          <PickTrack onPick={(t) => start(t)} />
        ) : state.done ? (
          <Summary
            track={track}
            questions={questions}
            state={state}
            signedIn={Boolean(user)}
            onAgain={() => start(track, state.ids)}
            onPick={() => setState(null)}
          />
        ) : (
          <Question
            key={`${state.track}-${state.ids.join()}-${state.index}`}
            track={track}
            question={questions[state.index]!}
            index={state.index}
            total={questions.length}
            state={state}
            onChange={setState}
            onPick={() => setState(null)}
          />
        )}
        <p className="mt-12 text-center text-xs text-zinc-500 dark:text-zinc-400">
          For practice. In a real interview, use notes or AI help only where it's allowed.{" "}
          <a href="/privacy.html" className={cx("underline-offset-2 hover:underline", focusRing)}>
            Privacy
          </a>
        </p>
      </main>
    </div>
  );
}

export default WarmupPage;

// ---- the round, kept in this tab ---------------------------------------------------------------------------------

interface RoundState {
  track: TrackId;
  ids: string[];
  index: number;
  answers: Record<string, string>;
  /** The answer came (partly) from speech-to-text. */
  spoken: Record<string, boolean>;
  /** Checked at least once (counted once toward the weekly goal). */
  checked: Record<string, boolean>;
  done: boolean;
}

const ROUND_KEY = "orbit.warmupRound";

function loadRound(): RoundState | null {
  try {
    const raw = safeSession.getItem(ROUND_KEY);
    const s = raw ? (JSON.parse(raw) as RoundState) : null;
    return s && trackById(s.track) && Array.isArray(s.ids) ? s : null;
  } catch {
    return null;
  }
}

function saveRound(s: RoundState | null): void {
  try {
    if (s) safeSession.setItem(ROUND_KEY, JSON.stringify(s));
    else safeSession.removeItem(ROUND_KEY);
  } catch {
    // no storage: the round just isn't kept across a reload
  }
}

function navButton(variant: "primary" | "secondary"): string {
  return buttonClass(variant, "md", "min-h-10");
}

// ---- picking a track ---------------------------------------------------------------------------------------------

const TRACK_ICON: Record<TrackId, LucideIcon> = {
  campus_hr: GraduationCap,
  intro: UserRound,
  sde: Code2,
  data: BookOpen,
  support: Headphones,
  sales: Target,
  mba: Briefcase,
};

function PickTrack({ onPick }: { onPick: (track: Track) => void }) {
  const country = useCountry();
  return (
    <>
      <section aria-labelledby="warmup-title" className="pb-8 pt-4 sm:pt-8">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Free · no sign-up
        </p>
        <h1 id="warmup-title" className="mt-4 text-balance font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Interview warm-up
        </h1>
        <p className="mt-3 max-w-xl text-base text-zinc-600 dark:text-zinc-300">
          Five real interview questions. Answer by typing or speaking, and get instant tips on length, structure, numbers and filler words.
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li className="flex items-center gap-1.5">
            <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> No account needed
          </li>
          <li className="flex items-center gap-1.5">
            <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Typed answers never leave this page
          </li>
          <li className="flex items-center gap-1.5">
            <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> About 10 minutes
          </li>
        </ul>
      </section>

      <section aria-labelledby="tracks-title">
        <h2 id="tracks-title" className="font-display text-lg font-semibold">
          Pick your interview
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {tracksFor(country).map((t) => {
            const Icon = TRACK_ICON[t.id];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className={cx("glass-panel lift flex h-full w-full items-start gap-3 rounded-2xl p-4 text-left hover:border-indigo-400/40 dark:hover:border-indigo-400/30", focusRing)}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-aurora-400/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-300">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-semibold">{t.name}</span>
                    <span className="mt-0.5 block text-sm text-zinc-600 dark:text-zinc-400">{t.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

// ---- one question ------------------------------------------------------------------------------------------------

const VERDICT: Record<Verdict, { icon: LucideIcon; tone: string; word: string }> = {
  good: { icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-300", word: "Good" },
  ok: { icon: Info, tone: "text-amber-800 dark:text-amber-200", word: "Nearly" },
  improve: { icon: CircleAlert, tone: "text-rose-700 dark:text-rose-300", word: "Work on it" },
};

function Question({
  track,
  question,
  index,
  total,
  state,
  onChange,
  onPick,
}: {
  track: Track;
  question: WarmupQuestion;
  index: number;
  total: number;
  state: RoundState;
  onChange: (s: RoundState) => void;
  onPick: () => void;
}) {
  const { user } = useAuth();
  const answer = state.answers[question.id] ?? "";
  const spoken = Boolean(state.spoken[question.id]);
  const [checks, setChecks] = useState<Check[] | null>(() => (state.checked[question.id] && answer ? checkAnswer(answer, question, spoken) : null));
  const count = words(answer).length;
  const last = index === total - 1;
  const feedback = useRef<HTMLDivElement>(null);
  // The tips come in below the answer: bring them into view (on a phone they'd be off-screen).
  useEffect(() => {
    if (checks) feedback.current?.scrollIntoView({ block: "start" });
  }, [checks]);

  const setAnswer = useCallback(
    (text: string, fromVoice = false) =>
      onChange({
        ...state,
        answers: { ...state.answers, [question.id]: text },
        spoken: fromVoice ? { ...state.spoken, [question.id]: true } : state.spoken,
      }),
    [onChange, state, question.id],
  );
  const dictation = useDictation(answer, (text) => setAnswer(text, true));

  const check = () => {
    dictation.stop();
    setChecks(checkAnswer(answer, question, spoken));
    if (!state.checked[question.id]) {
      logWarmupAnswer(Date.now(), user?.id);
      onChange({ ...state, checked: { ...state.checked, [question.id]: true } });
    }
  };
  const next = () => {
    dictation.stop();
    onChange(last ? { ...state, done: true } : { ...state, index: index + 1 });
  };

  return (
    <section aria-labelledby="question-text" className="pt-4 sm:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <p>
          <span className="font-medium text-zinc-700 dark:text-zinc-200">{track.name}</span> · Question {index + 1} of {total}
        </p>
        <button type="button" onClick={onPick} className={cx("inline-flex items-center gap-1 rounded-lg py-1 font-medium hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Change interview
        </button>
      </div>
      <div className="mt-2 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", i < index ? "bg-indigo-500" : i === index ? "bg-indigo-400/70" : "bg-zinc-500/20")} />
        ))}
      </div>

      <h1 id="question-text" className="mt-6 text-balance font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
        {question.text}
      </h1>
      <p className="mt-2 flex items-start gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
        <span>
          <span className="font-medium">What they listen for:</span> {question.tip}
        </span>
      </p>

      <div className="mt-5 space-y-2">
        <label htmlFor="warmup-answer" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Your answer
        </label>
        <Textarea
          id="warmup-answer"
          rows={7}
          value={answer}
          maxLength={6000}
          onChange={(e) => {
            setAnswer(e.target.value);
            if (checks) setChecks(null);
          }}
          readOnly={dictation.listening}
          placeholder={dictation.supported ? "Type your answer, or press Speak and say it out loud…" : "Type your answer as you'd say it…"}
          className="!text-base"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="tabular-nums" aria-live="off">
            {count} {count === 1 ? "word" : "words"}
            {count >= MIN_WORDS ? ` · ${spokenTime(count)} to say` : ""}
          </span>
          {dictation.supported ? (
            <Button
              size="sm"
              variant={dictation.listening ? "primary" : "secondary"}
              aria-pressed={dictation.listening}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              className="ml-auto"
            >
              {dictation.listening ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
              {dictation.listening ? "Stop" : answer ? "Speak more" : "Speak"}
            </Button>
          ) : (
            <span className="ml-auto">Voice answers need Chrome, Edge or Safari: type it here.</span>
          )}
        </div>
        <div aria-live="polite" className="empty:hidden">
          {dictation.listening && (
            <p className="flex items-center gap-2 text-sm text-indigo-700 dark:text-indigo-300">
              <span className="h-2 w-2 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden /> Listening… speak at your own pace, then press Stop.
            </p>
          )}
          {dictation.error && <p className="text-sm text-rose-700 dark:text-rose-300">{dictation.error}</p>}
        </div>
        {dictation.supported && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Voice uses your browser's own speech-to-text, which may send the audio to its maker (Google, in Chrome). Typed answers stay on this page.
          </p>
        )}
      </div>

      {!checks && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={check} disabled={count < MIN_WORDS}>
            <Sparkles className="h-4 w-4" aria-hidden /> Check my answer
          </Button>
          {count < MIN_WORDS && (
            <Button variant="ghost" onClick={next}>
              Skip this question
            </Button>
          )}
          {count > 0 && count < MIN_WORDS && <span className="text-xs text-zinc-500 dark:text-zinc-400">A few more words to check it.</span>}
        </div>
      )}

      <div aria-live="polite" ref={feedback} className="scroll-mt-4">
        {checks && (
          <Card className="mt-6 motion-safe:animate-fade-up">
            <h2 className="font-display text-base font-semibold">How it came across</h2>
            <ul className="mt-3 space-y-3">
              {checks.map((c) => {
                const v = VERDICT[c.verdict];
                const Icon = v.icon;
                return (
                  <li key={c.id} className="flex gap-3">
                    <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", v.tone)} aria-hidden />
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">
                        {c.label} <span className={cx("font-normal", v.tone)}>· {v.word}</span>
                      </span>
                      <span className="block text-zinc-600 dark:text-zinc-300">{c.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              Rule-based tips, not an AI score: they look for patterns, so use your judgement.
            </p>
          </Card>
        )}
      </div>
      {checks && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={next}>
            {last ? "See my summary" : "Next question"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="secondary" onClick={() => setChecks(null)}>
            <Redo2 className="h-4 w-4" aria-hidden /> Improve this answer
          </Button>
        </div>
      )}
    </section>
  );
}

// ---- the summary ---------------------------------------------------------------------------------------------------

function Summary({
  track,
  questions,
  state,
  signedIn,
  onAgain,
  onPick,
}: {
  track: Track;
  questions: WarmupQuestion[];
  state: RoundState;
  signedIn: boolean;
  onAgain: () => void;
  onPick: () => void;
}) {
  const results = useMemo(
    () => questions.map((q) => (state.checked[q.id] ? checkAnswer(state.answers[q.id] ?? "", q, Boolean(state.spoken[q.id])) : [])),
    [questions, state],
  );
  const s = summarise(results);
  const name = (id: string) => (s.labels[id as keyof typeof s.labels] ?? id).toLowerCase();
  return (
    <section aria-labelledby="summary-title" className="pt-4 sm:pt-8">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{track.name}</p>
      <h1 id="summary-title" className="mt-1 font-display text-3xl font-semibold tracking-tight">
        {s.answered ? `You answered ${s.answered} of ${questions.length}` : "Warm-up done"}
      </h1>
      {s.answered > 0 && (
        <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-300">
          {s.strengths.length ? `Strong on ${s.strengths.map(name).join(", ")}. ` : ""}
          {s.focus ? `Work on ${name(s.focus)} next: it's where most answers lost marks.` : "Nothing big to fix. Try it out loud next."}
        </p>
      )}

      <ol className="mt-6 space-y-2">
        {questions.map((q, i) => {
          const checks = results[i] ?? [];
          const good = checks.filter((c) => c.verdict === "good").length;
          return (
            <li key={q.id} className="glass-panel flex items-start gap-3 rounded-2xl p-3.5">
              <span className="mt-0.5 text-xs font-semibold tabular-nums text-zinc-400">{i + 1}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">{q.text}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {checks.length ? `${good} of ${checks.length} checks look good` : "Skipped"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={onAgain}>
          <Redo2 className="h-4 w-4" aria-hidden /> Five more questions
        </Button>
        <Button variant="secondary" onClick={onPick}>
          Pick another interview
        </Button>
      </div>

      <Card className="gradient-border mt-8">
        {signedIn ? (
          <>
            <h2 className="font-display text-lg font-semibold">Now say it out loud to an interviewer</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">A 5-minute HR round with Orbit's AI interviewer, then a report with a score.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/mock?preset=hr5" className={navButton("primary")}>
                Do a 5-minute HR round
              </Link>
              <Link to="/mock" className={navButton("secondary")}>
                Back to Practice
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold">Get an AI score and a mock interview: free account</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              An AI interviewer that asks, listens and follows up, a report on every answer, and the same account has Resume AI and Jobs AI.
              Nothing auto-renews.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/register" state={{ from: "/mock" }} className={navButton("primary")}>
                Create a free account
              </Link>
              <Link to="/login" state={{ from: "/mock" }} className={navButton("secondary")}>
                I have an account
              </Link>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

// ---- answering by voice --------------------------------------------------------------------------------------------

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in your browser's settings, or type your answer.",
  "service-not-allowed": "This browser won't do speech-to-text here. Type your answer instead.",
  "no-speech": "Didn't hear anything. Press Speak and try again a little closer to the mic, or type.",
  "audio-capture": "No microphone found. Type your answer instead.",
  network: "Voice needs the internet here: your browser does the speech-to-text online. Type instead.",
  "language-not-supported": "This browser can't do speech-to-text in your English here. Type your answer instead.",
};

/**
 * Speech-to-text into the answer box, with the browser's own SpeechRecognition (Chrome, Edge, Safari; not Firefox or
 * most in-app browsers, which get typing only), in the English of the country the user applies in (speechLang).
 * Android's continuous mode repeats itself, so there it
 * listens a phrase at a time and starts again until Stop.
 */
function useDictation(text: string, onText: (text: string) => void) {
  const Ctor = useMemo(recognitionCtor, []);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const base = useRef("");
  const lang = speechLang(useCountry());
  const latest = useRef({ text, onText, lang });
  latest.current = { text, onText, lang };

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    setError(null);
    const android = /android/i.test(navigator.userAgent);
    base.current = latest.current.text.trim();
    wanted.current = true;
    const listen = () => {
      const r = new Ctor();
      r.lang = latest.current.lang;
      r.continuous = !android;
      r.interimResults = true;
      let heard = "";
      r.onresult = (e) => {
        let final = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        heard = final;
        latest.current.onText([base.current, (final + interim).trim()].filter(Boolean).join(" "));
      };
      r.onerror = (e) => {
        if (e.error !== "aborted" && !(android && e.error === "no-speech" && heard)) {
          wanted.current = false;
          setError(VOICE_ERRORS[e.error] ?? "Voice stopped working. Type your answer instead.");
        }
      };
      r.onend = () => {
        base.current = [base.current, heard.trim()].filter(Boolean).join(" ");
        latest.current.onText(base.current);
        if (wanted.current && android) {
          listen(); // the next phrase
          return;
        }
        wanted.current = false;
        setListening(false);
      };
      rec.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        wanted.current = false;
        setListening(false);
        setError("Voice couldn't start. Type your answer instead.");
      }
    };
    listen();
  }, [Ctor]);

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { supported: Boolean(Ctor), listening, error, start, stop };
}
