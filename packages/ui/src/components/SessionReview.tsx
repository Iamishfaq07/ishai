import { useState } from "react";
import type { ReviewItem, SessionReview as Review } from "@orbit/types";
import { cx } from "./cx";
import { Button, Card, ErrorNote } from "./ui";

export interface SessionReviewProps {
  review: Review | null | undefined;
  /** Reviews cover finished sessions only. */
  ended: boolean;
  /** Nothing was heard or asked (no transcript, no questions): there is nothing to review. */
  empty?: boolean;
  /** Generates (or regenerates) the review, then the caller reloads the session. */
  onGenerate: () => Promise<void>;
  /** Re-drill: start a practice round on the weak questions (the caller creates the session and opens it). */
  onDrill?: () => Promise<void>;
}

/** Scores of 3/5 or lower, or unanswered, are what a drill practises (matches the server's drill_plan). */
export function weakQuestions(review: Review): number {
  return review.items.filter((i) => !i.you_said.trim() || (i.score !== null && i.score <= 3)).length;
}

const SCORE_WORD: Record<number, string> = { 1: "Needs work", 2: "Developing", 3: "Solid start", 4: "Strong", 5: "Excellent" };

/** Post-call scorecard: overall score, strengths/improvements/practice, and each question graded on what
 * the candidate actually said. Shared by the web session page and the desktop History screen. */
export function SessionReview({ review, ended, empty = false, onGenerate, onDrill }: SessionReviewProps) {
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
      <Card className="animate-fade-up text-center">
        <p className="font-semibold">Nothing was captured</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          No speech was heard and no questions were asked in this session, so there's nothing to review. If audio was on,
          check your microphone and interviewer audio with the tests on the start screen next time.
        </p>
      </Card>
    );
  }

  if (!review) {
    return (
      <Card className="animate-fade-up text-center">
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
          {onDrill && weak > 0 && (
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

      <div className="grid gap-4 md:grid-cols-3">
        <Bullets title="What went well" tone="emerald" items={review.strengths} />
        <Bullets title="To improve" tone="amber" items={review.improvements} />
        <Bullets title="Practice next" tone="indigo" items={review.practice} />
      </div>

      <div className="space-y-3">
        {review.items.map((item, i) => (
          <QuestionReview key={i} index={i + 1} item={item} />
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const frac = score ? score / 5 : 0;
  return (
    <span role="img" className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center" aria-label={score ? `Overall ${score} out of 5` : "No overall score"}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-indigo-500 transition-[stroke-dashoffset] duration-700"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
        />
      </svg>
      <span className="text-lg font-semibold tabular-nums">{score ?? "–"}</span>
    </span>
  );
}

const TONE: Record<"emerald" | "amber" | "indigo", string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  indigo: "bg-indigo-500",
};

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: keyof typeof TONE }) {
  if (items.length === 0) return null;
  return (
    <Card className="animate-fade-up">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={cx("mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full", TONE[tone])} aria-hidden="true" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pips({ score }: { score: number | null }) {
  return (
    <span role="img" className="flex items-center gap-1" aria-label={score ? `${score} out of 5` : "Not scored"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={cx("h-2 w-2 rounded-full", score && n <= score ? "bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-700")}
        />
      ))}
    </span>
  );
}

function QuestionReview({ index, item }: { index: number; item: ReviewItem }) {
  return (
    <Card className="animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          <span className="mr-2 text-zinc-400">Q{index}</span>
          {item.question}
        </p>
        <Pips score={item.score} />
      </div>
      {item.you_said ? (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
            You said
          </summary>
          <p className="mt-1 rounded-lg bg-zinc-50 p-2.5 text-sm italic leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            “{item.you_said}”
          </p>
        </details>
      ) : (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No answer was captured for this question.</p>
      )}
      {item.feedback && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{item.feedback}</p>}
      {item.better && (
        <div className="mt-3 rounded-lg border-l-2 border-indigo-500 bg-indigo-500/5 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Try saying</p>
          <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{item.better}</p>
        </div>
      )}
    </Card>
  );
}
