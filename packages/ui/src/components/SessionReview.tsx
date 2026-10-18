import { useState } from "react";
import type { AnswerSpeaking, DepthDimension, DepthScores, ReviewItem, SessionReview as Review } from "@orbit/types";
import { ArrowUpRight, Bookmark, BookmarkCheck, ChevronDown, CircleCheck, RotateCcw, Target, type LucideIcon } from "../icons";
import { clock, reviewLength } from "../live/answerPace";
import { cx, focusRing } from "./cx";
import { useCountUp } from "./Reveal";
import { paceNote, rubricRows, splitPlaceholders, topPractice } from "./reviewText";
import { CopilotScene } from "./scenes/CopilotScene";
import { PracticeScene } from "./scenes/PracticeScene";
import { WorkingScene } from "./scenes/WorkingScene";
import { Badge, Button, Card, EmptyState, ErrorNote, Textarea } from "./ui";

export interface SessionReviewProps {
  review: Review | null | undefined;
  /** Reviews cover finished sessions only. */
  ended: boolean;
  /** Nothing was heard or asked (no transcript, no questions): there is nothing to review. */
  empty?: boolean;
  /** Answers kept from a session with nothing said (asked in chat): an empty review mustn't say nothing happened. */
  answers?: number;
  /** Generates (or regenerates) the review, then the caller reloads the session. */
  onGenerate: () => Promise<void>;
  /** Re-drill: start a practice round on the weak questions (the caller creates the session and opens it). */
  onDrill?: () => Promise<void>;
  /** "Try this one again": a practice round on one question of the review (1-based), opened by the caller. */
  onRetry?: (question: number) => Promise<void>;
  /** "Save as my answer": keeps an answer to the question in the answer bank, which live sessions draw on. */
  onSaveAnswer?: (question: string, answer: string) => Promise<void>;
  /** Whether weak answers here join the practice queue (not for salary practice). Default true. */
  practiceQueue?: boolean;
}

/** Scores of 3/5 or lower, or unanswered, are what a drill practises (matches the server's drill_plan). */
export function weakQuestions(review: Review): number {
  return review.items.filter((i) => !i.you_said.trim() || (i.score !== null && i.score <= 3)).length;
}

const SCORE_WORD: Record<number, string> = { 1: "Needs work", 2: "Developing", 3: "Solid start", 4: "Strong", 5: "Excellent" };

/** Post-call scorecard: overall score, strengths/improvements/practice, and each question graded on what
 * the candidate actually said. Shared by the web session page and the desktop History screen. */
export function SessionReview({ review, ended, empty = false, answers = 0, onGenerate, onDrill, onRetry, onSaveAnswer, practiceQueue = true }: SessionReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the review.");
    } finally {
      setBusy(false);
    }
  };

  if (!review && ended && empty) {
    return (
      <EmptyState
        className="scene-host animate-fade-up"
        art={<CopilotScene quiet className="w-44 sm:w-52" />}
        title={answers ? "Nothing was said out loud" : "Nothing was captured"}
        body={
          answers
            ? `There's no speech to score, so there's no scorecard. The ${answers === 1 ? "answer" : `${answers} answers`} from this session ${answers === 1 ? "is" : "are"} on the Questions & answers tab.`
            : "No speech was heard and no questions were asked in this session, so there's nothing to review. If audio was on, check your microphone and interviewer audio with the tests on the start screen next time."
        }
      />
    );
  }

  if (!review) {
    return (
      <Card className="animate-fade-up text-center">
        {/* What a review gives you; while it's being written, the pen at work (the same size, so nothing moves). */}
        {ended && (busy ? <WorkingScene kind="writing" className="mx-auto mb-3 w-36" /> : <PracticeScene className="mx-auto mb-3 w-36" />)}
        <p className="font-semibold">No review yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          {ended
            ? "Get a scorecard of how you answered each question — what landed, what was missing, and a stronger way to say it."
            : "Reviews are available once the session has ended."}
        </p>
        {ended && (
          <Button className="mt-4" onClick={() => void generate()} disabled={busy}>
            {busy ? "Reviewing your answers…" : "Generate review"}
          </Button>
        )}
        {error && (
          <div className="mt-3 text-left">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>
    );
  }

  const answered = review.items.filter((i) => i.score !== null).length;
  const weak = weakQuestions(review);
  const drill = async () => {
    if (!onDrill) return;
    setBusy(true);
    setError(null);
    try {
      await onDrill();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the drill.");
      setBusy(false);
    }
  };
  const retry = async (question: number) => {
    if (!onRetry) return;
    setBusy(true);
    setError(null);
    try {
      await onRetry(question);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the practice round.");
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="animate-fade-up">
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing score={review.overall_score} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">
              {review.overall_score ? SCORE_WORD[review.overall_score] : "Not enough to score"}
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {answered} of {review.items.length} question{review.items.length === 1 ? "" : "s"} answered and scored
            </p>
          </div>
          {/* The drill lives with the top three to practise; here only when there's no such list to put it in. */}
          {onDrill && weak > 0 && topPractice(review).length === 0 && (
            <Button size="sm" onClick={() => void drill()} disabled={busy}
                    title="A short mock round: your weakest questions again, with follow-ups, then a 30-second version">
              Drill {weak} weak question{weak === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void generate()} disabled={busy}>
            {busy ? "Working…" : "Regenerate"}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Bullets title="What went well" tone="emerald" items={review.strengths} />
        <Bullets title="To improve" tone="amber" items={review.improvements} />
      </div>

      <TopPractice review={review} weak={weak} busy={busy} onDrill={onDrill ? () => void drill() : undefined} />

      <div className="space-y-3">
        {review.items.map((item, i) => (
          <QuestionReview key={i} index={i + 1} item={item} busy={busy} queue={practiceQueue} onRetry={onRetry ? () => void retry(i + 1) : undefined}
                          onSaveAnswer={onSaveAnswer} />
        ))}
      </div>
    </div>
  );
}

/**
 * The top three things to practise, most useful first, each with the questions that showed it (links to their
 * cards), and "Practise these again": the re-drill of the weak questions (a short mock round with follow-ups).
 */
function TopPractice({ review, weak, busy, onDrill }: { review: Review; weak: number; busy: boolean; onDrill: (() => void) | undefined }) {
  const items = topPractice(review);
  if (!items.length) return null;
  const t = TONE.indigo;
  const Icon = t.icon;
  return (
    <Card className={cx("relative animate-fade-up overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-0.5", t.edge)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg ring-1", t.chip)} aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
          {review.top_practice?.length ? "Top 3 to practise" : "Practice next"}
        </h2>
        {onDrill && weak > 0 && (
          <Button size="sm" onClick={onDrill} disabled={busy}
                  title="A short mock round: your weakest questions again, with follow-ups, then a 30-second version">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Practise these again
          </Button>
        )}
      </div>
      <ol className="mt-3 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold tabular-nums text-white" aria-hidden="true">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200">
              {it.practice}
              {it.questions.length > 0 && (
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {it.questions.map((q) => (
                    <a key={q} href={`#review-q${q}`}
                       className={cx("rounded-md bg-zinc-100 px-1.5 py-px text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15", focusRing)}>
                      Q{q}
                      <span className="sr-only"> (go to question {q})</span>
                    </a>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {onDrill && weak > 0 && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Practise these again: {weak} weak question{weak === 1 ? "" : "s"} out loud, with a follow-up on what was missing.
        </p>
      )}
    </Card>
  );
}

/** The overall score as a ring that fills on arrival (Full motion), coloured by how it went, with its scale shown. */
function ScoreRing({ score }: { score: number | null }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const shown = useCountUp(score ?? 0, true, { duration: 900 });
  const tone = !score ? "stroke-zinc-300" : score >= 4 ? "stroke-emerald-500" : score === 3 ? "stroke-indigo-500" : "stroke-amber-500";
  return (
    <span role="img" className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center" aria-label={score ? `Overall ${score} out of 5` : "No overall score"}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className={tone}
                strokeDasharray={circ} strokeDashoffset={circ * (1 - shown / 5)} />
      </svg>
      <span className="flex items-baseline font-display tabular-nums" aria-hidden="true">
        <span className="text-xl font-semibold">{score ?? "–"}</span>
        {score ? <span className="text-xs text-zinc-500 dark:text-zinc-400">/5</span> : null}
      </span>
    </span>
  );
}

const TONE: Record<"emerald" | "amber" | "indigo", { dot: string; chip: string; edge: string; icon: LucideIcon }> = {
  emerald: { dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300", edge: "before:bg-emerald-500", icon: CircleCheck },
  amber: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 ring-amber-600/20 dark:text-amber-300", edge: "before:bg-amber-500", icon: ArrowUpRight },
  indigo: { dot: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300", edge: "before:bg-indigo-500", icon: Target },
};

/** One of the three takeaways (went well / to improve / practise next): its own colour, icon and top edge. */
function Bullets({ title, items, tone }: { title: string; items: string[]; tone: keyof typeof TONE }) {
  if (items.length === 0) return null;
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <Card className={cx("relative animate-fade-up overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-0.5", t.edge)}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg ring-1", t.chip)} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </h2>
      <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={cx("mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} aria-hidden="true" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pips({ score, small = false }: { score: number | null; small?: boolean }) {
  return (
    <span role="img" className={cx("flex items-center", small ? "gap-0.5" : "gap-1")} aria-label={score ? `${score} out of 5` : "Not scored"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={cx("rounded-full", small ? "h-1.5 w-1.5" : "h-2 w-2", score && n <= score ? "bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-700")}
        />
      ))}
    </span>
  );
}

/**
 * How the answer was given, criterion by criterion (structure, specifics, relevance, clarity, conciseness): each a
 * 1–5 mark. Open one for the reason and the candidate's own words that show it (readable on a phone: no tooltips).
 */
function AnswerRubric({ item }: { item: ReviewItem }) {
  const rows = rubricRows(item.rubric);
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">How you answered</p>
      <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
        {rows.map(([label, mark]) => {
          const head = (
            <>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
              <span className="ml-auto flex items-center gap-2">
                <Pips score={mark.score} small />
                <span className="w-7 text-right tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden="true">
                  {mark.score ? `${mark.score}/5` : "–"}
                </span>
              </span>
            </>
          );
          return (
            <li key={label} className="border-b border-zinc-100 dark:border-white/5">
              {mark.reason || mark.quote ? (
                <details className="group">
                  <summary className={cx("flex cursor-pointer list-none items-center gap-2 rounded py-1.5 text-xs [&::-webkit-details-marker]:hidden", focusRing)}>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-quick group-open:rotate-180" aria-hidden />
                    {head}
                  </summary>
                  <div className="pb-2 pl-5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {mark.reason}
                    {mark.quote && <q className="mt-0.5 block italic text-zinc-700 dark:text-zinc-200">{mark.quote}</q>}
                  </div>
                </details>
              ) : (
                <div className="flex items-center gap-2 py-1.5 pl-5 text-xs">{head}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The stronger answer, with its [placeholders] (facts the candidate fills in) marked, and a word on where it came from. */
function StrongerAnswer({ text }: { text: string }) {
  const parts = splitPlaceholders(text);
  const gaps = parts.some((p) => p.placeholder);
  return (
    <div className="mt-3 rounded-lg border-l-2 border-indigo-500 bg-indigo-500/5 px-3 py-2">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Try saying</p>
      <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">
        {parts.map((p, i) =>
          p.placeholder ? (
            <mark key={i} className="rounded bg-amber-500/15 px-1 font-medium text-amber-900 dark:text-amber-200">
              {p.text}
              <span className="sr-only"> (fill in)</span>
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      {gaps && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Built only from what you said and your documents: fill in the highlighted parts with your own facts.
        </p>
      )}
    </div>
  );
}

/** This answer's pace, fillers and long pauses (from its transcript timings), flagged when the pace was off. */
function SpeakingLine({ speaking }: { speaking: AnswerSpeaking }) {
  const pace = paceNote(speaking.words_per_minute);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {speaking.words_per_minute} words a minute
        {pace && <Badge tone="warning">{pace === "fast" ? "Fast" : "Slow"}</Badge>}
      </span>
      <span className="tabular-nums">
        {plural(speaking.fillers, "filler")}
        {speaking.top_fillers.length > 0 && ` (${speaking.top_fillers.map((w) => `“${w}”`).join(", ")})`}
      </span>
      <span className="tabular-nums">{plural(speaking.long_pauses, "long pause")}</span>
    </p>
  );
}

function QuestionReview({ index, item, busy = false, queue = true, onRetry, onSaveAnswer }: {
  index: number;
  item: ReviewItem;
  queue?: boolean;
  busy?: boolean;
  onRetry?: () => void;
  onSaveAnswer?: (question: string, answer: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState<"closed" | "open" | "saved">("closed");
  return (
    <Card id={`review-q${index}`} className="animate-fade-up scroll-mt-24">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          <span className="mr-2 text-zinc-400">Q{index}</span>
          {item.question}
        </p>
        <Pips score={item.score} />
      </div>
      {queue && queued(item) && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-300"
           title="Answers scored 3 out of 5 or lower come back on a spaced schedule until you answer them well">
          <RotateCcw className="h-3 w-3" aria-hidden /> In your practice queue
        </p>
      )}
      {item.you_said ? (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
            You said
            <AnswerLength item={item} />
          </summary>
          <p className="mt-1 rounded-lg bg-zinc-50 p-2.5 text-sm italic leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            “{item.you_said}”
          </p>
        </details>
      ) : (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No answer was captured for this question.</p>
      )}
      {item.speaking && <SpeakingLine speaking={item.speaking} />}
      {item.feedback && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{item.feedback}</p>}
      <AnswerRubric item={item} />
      {item.improvement && (
        <p className="mt-3 flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
          <span>
            <span className="font-semibold">Next time: </span>
            {item.improvement}
          </span>
        </p>
      )}
      {(item.missing_points?.length ?? 0) > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">What it missed</p>
          <ul className="mt-1 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            {item.missing_points!.map((m) => (
              <li key={m} className="flex gap-2">
                <span className="text-amber-500" aria-hidden="true">•</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Rubric scores={item.dimensions} />
      {item.better && <StrongerAnswer text={item.better} />}
      {(onRetry || onSaveAnswer) && saving !== "open" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}
                    title="A short mock round: this question again, out loud, with a follow-up on what was missing"
                    aria-label={`Try this one again (question ${index})`}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try this one again
            </Button>
          )}
          {onSaveAnswer && saving === "closed" && (
            <Button variant="ghost" size="sm" onClick={() => setSaving("open")}
                    title="Keep your answer to this question: the copilot starts from it when it comes up in an interview"
                    aria-label={`Save as my answer (question ${index})`}>
              <Bookmark className="h-3.5 w-3.5" aria-hidden /> Save as my answer
            </Button>
          )}
          {saving === "saved" && (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <BookmarkCheck className="h-3.5 w-3.5" aria-hidden /> Saved to your answers
            </span>
          )}
        </div>
      )}
      {onSaveAnswer && saving === "open" && (
        <SaveAnswer index={index} question={item.question} draft={item.better || item.you_said}
                    onSave={async (answer) => {
                      await onSaveAnswer(item.question, answer);
                      setSaving("saved");
                    }}
                    onCancel={() => setSaving("closed")} />
      )}
    </Card>
  );
}

/** Weak answers (3 of 5 or lower, or none) join the practice queue (sessions/practice_queue.py, WEAK_SCORE). */
const WEAK_SCORE = 3;
function queued(item: ReviewItem): boolean {
  return item.score === null || item.score <= WEAK_SCORE;
}

const DIMENSION_LABEL: Record<DepthDimension, string> = {
  problem_framing: "Framing",
  technical_depth: "Depth",
  scalability: "Scale",
  edge_case_rigor: "Edge cases",
  communication_clarity: "Clarity",
};

/** The scored rubric dimensions (1–5) as small bars; ones the question didn't test are left out. */
function Rubric({ scores }: { scores?: DepthScores }) {
  const shown = (Object.keys(DIMENSION_LABEL) as DepthDimension[]).filter((d) => typeof scores?.[d] === "number");
  if (!shown.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {shown.map((d) => {
        const v = scores![d] as number;
        return (
          <div key={d} className="text-xs">
            <dt className="flex justify-between text-zinc-500 dark:text-zinc-400">
              {DIMENSION_LABEL[d]} <span className="tabular-nums">{v}/5</span>
            </dt>
            <dd className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
              <span className={cx("block h-full rounded-full", v >= 4 ? "bg-emerald-500" : v === 3 ? "bg-amber-500" : "bg-rose-500")}
                    style={{ width: `${(v / 5) * 100}%` }} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The answer to keep, starting from the review's "Try saying" (or what was said), edited into the user's words. */
function SaveAnswer({ index, question, draft, onSave, onCancel }: {
  index: number;
  question: string;
  draft: string;
  onSave: (answer: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState(draft.replace(/^…|…$/g, "").trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `save-answer-${index}`;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(answer.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the answer.");
      setBusy(false);
    }
  };
  return (
    <form className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label htmlFor={id} className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        Your answer to “{question}”
      </label>
      <Textarea id={id} rows={5} value={answer} maxLength={3000} autoFocus
                onChange={(e) => setAnswer(e.target.value)} />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Make it sound like you. When this question comes up in an interview, the copilot starts from this answer.
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !answer.trim()}>
          {busy ? "Saving…" : "Save answer"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** "· 1:04 · 160 words", flagged when it ran long or was very short (live/answerPace.ts, as the mock's timer). */
function AnswerLength({ item }: { item: ReviewItem }) {
  if (item.answer_s == null) return null;
  const flag = reviewLength(item.answer_s);
  return (
    <span className="font-normal tabular-nums">
      {" "}· {clock(item.answer_s)}
      {item.words ? ` · ${item.words} word${item.words === 1 ? "" : "s"}` : ""}
      {flag && (
        <span
          className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-px font-medium text-amber-800 dark:text-amber-300"
          title={flag === "long" ? "Over 2 minutes: land the result sooner" : "Under 20 seconds: say more, with an example"}
        >
          {flag === "long" ? "Long" : "Short"}
        </span>
      )}
    </span>
  );
}
