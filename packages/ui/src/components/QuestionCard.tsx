import type { QuestionType } from "@orbit/types";
import type { QuestionView, TurnView } from "../live/reducer";
import { cx } from "./cx";

const TYPE_LABEL: Partial<Record<QuestionType, string>> = {
  behavioral: "Behavioral",
  technical: "Technical",
  coding: "Coding",
  system_design: "System design",
  resume: "Experience",
  leadership: "Leadership",
  salary: "Compensation",
  culture: "Culture fit",
  clarification: "Clarification",
  follow_up: "Follow-up",
};

export interface QuestionCardProps {
  question: QuestionView | null;
  /** Live interviewer partial shown before a question is finalized. */
  liveTurn: TurnView | null;
  compact?: boolean;
}

export function QuestionCard({ question, liveTurn, compact = false }: QuestionCardProps) {
  const showLive = liveTurn && !liveTurn.final && (!question || liveTurn.turn_id !== question.turn_id);
  const typeLabel = question ? (question.is_follow_up ? "Follow-up" : TYPE_LABEL[question.type]) : undefined;

  return (
    <section aria-label="Interviewer question" className={cx("px-4", compact ? "py-2.5" : "py-3")}>
      {!compact && (
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            Interviewer
          </h2>
          {typeLabel && (
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
              {typeLabel}
            </span>
          )}
        </div>
      )}
      {question ? (
        <p className={cx("font-medium leading-snug text-zinc-900 dark:text-zinc-50", compact ? "text-sm" : "text-[15px]")}>
          {question.text}
        </p>
      ) : !showLive ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Waiting for the interviewer’s question…</p>
      ) : null}
      {showLive && liveTurn && (
        // Partial text is visually secondary and never reflows the finalized question above it.
        <p className="mt-1 line-clamp-2 text-sm italic text-zinc-500 dark:text-zinc-400" aria-live="off">
          {liveTurn.text}
        </p>
      )}
    </section>
  );
}
