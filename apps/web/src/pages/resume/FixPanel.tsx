import { useState } from "react";
import type { AtsCheck, AtsReport, ResumeData, ResumeFixResponse, ResumeSuggestion } from "@orbit/types";
import { Check, CircleAlert, CircleCheck, InlineResumeDiff, PenLine, Plus, Sparkles, Undo2, Wand2, X, cx, focusRing } from "@orbit/ui";
import { Button, Input } from "../../components/ui";
import { AiErrorNote } from "./allowance";
import { getAt, isStillApplied, suggestedSkills } from "./model";

/** What the button says for something only the candidate can add. */
const ADD_LABEL: Record<string, string> = {
  name: "Add your name",
  phone: "Add your phone",
  link: "Add a link",
  location: "Add your city",
  has_experience: "Add a role",
  has_education: "Add education",
  roles_complete: "Fill in the role",
  date_order: "Check the dates",
  dates: "Fix the dates",
  bullets_per_role: "Edit the bullets",
};

/** A fresher's roles_complete points at a project, not a role. */
const addLabel = (c: AtsCheck): string =>
  c.id === "roles_complete" && c.target?.startsWith("projects.") ? "Fill in the project" : (ADD_LABEL[c.id] ?? "Add it");

/** While a fix runs: what it's doing, so a minute-long "fix everything" doesn't look stuck. */
export function fixBusyText(check: string): string {
  if (check === "all") return "Fixing everything: rewriting the flagged lines, then checking the result again…";
  if (check === "quantified") return "Working your numbers in…";
  return "Fixing it, then checking the result…";
}

export type FixKind = "ai" | "auto" | "you";

export function fixKind(c: AtsCheck): FixKind {
  return c.fix_kind ?? (c.ai_fixable ? "ai" : "you");
}

/** The buttons on one failing check: the AI fixes it, it's fixed for free, or it shows where to add what's missing. */
export function FixActions({ check: c, report, busy, onFix, onShow }: {
  check: AtsCheck;
  report: AtsReport;
  busy: boolean;
  onFix: (check: string) => void;
  onShow: (target: string | null) => void;
}) {
  const kind = fixKind(c);
  if (c.category === "keywords" && !report.has_job) {
    return (
      <Button size="sm" variant="secondary" onClick={() => document.getElementById("job")?.focus()}>
        Add the job post
      </Button>
    );
  }
  return (
    <>
      {kind === "ai" && (
        <Button size="sm" disabled={busy} onClick={() => onFix(c.id)}>
          <Sparkles className="h-3.5 w-3.5" /> Fix with AI
        </Button>
      )}
      {kind === "auto" && (
        <Button size="sm" disabled={busy} onClick={() => onFix(c.id)}>
          <Wand2 className="h-3.5 w-3.5" /> Fix it
        </Button>
      )}
      {kind === "you" && c.target && (
        <Button size="sm" variant="secondary" onClick={() => onShow(c.target)}>
          <PenLine className="h-3.5 w-3.5" /> {addLabel(c)}
        </Button>
      )}
      {kind !== "you" && c.target && (
        <Button size="sm" variant="ghost" onClick={() => onShow(c.target)}>
          Show me
        </Button>
      )}
    </>
  );
}

/** What the last fix did, and what it needs from the candidate to finish: claims to confirm, numbers to give. */
export function FixResult({ result, report, busy, error, onUndo, onKeep, onSkip, onAnswer, onShow, onPoint, onDismiss, data, onRevert }: {
  result: ResumeFixResponse | null;
  /** The resume as it is now: which of the fix's changes are still in it. */
  data?: ResumeData;
  /** Take back one change (the line reads as before, or the added bullet goes). */
  onRevert?: (s: ResumeSuggestion) => void;
  report: AtsReport | null;
  busy: string | null;
  error: { text: string; upgrade: boolean } | null;
  onUndo: () => void;
  onKeep: (s: ResumeSuggestion, picked?: string[]) => void;
  onSkip: (s: ResumeSuggestion) => void;
  onAnswer: (facts: Record<string, string>) => void;
  onShow: (target: string | null) => void;
  /** The line something here is about, for the preview to mark. */
  onPoint: (paths: string[]) => void;
  onDismiss: () => void;
}) {
  if (busy) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 ring-1 ring-indigo-500/20 dark:text-indigo-100">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse" aria-hidden />
        {fixBusyText(busy)}
      </div>
    );
  }
  if (!result && !error) return null;
  const changed = result ? result.suggestions.length + Object.keys(result.design).length + (result.order ? 1 : 0) : 0;
  // Live: what's still failing now (the candidate may have kept or skipped things since), of what the fix was for.
  const asked = new Set(result?.remaining.map((c) => c.id) ?? []);
  const left = (report?.checks ?? []).filter((c) => !c.passed && asked.has(c.id));
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 dark:border-emerald-400/20">
      {result && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CircleCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            {changed > 0 ? (
              <>
                <strong>
                  Score {result.score_before} → {report?.score ?? result.score_after}.
                </strong>{" "}
                {changed} change{changed === 1 ? "" : "s"} made{left.length ? "." : ", and every check you asked about now passes."}
              </>
            ) : (
              "Nothing could be changed automatically here: see what's left below."
            )}
          </p>
          {changed > 0 && (
            <Button size="sm" variant="secondary" onClick={onUndo}>
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </Button>
          )}
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cx("rounded p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <AiErrorNote error={error.text} upgrade={error.upgrade} />}
      {result && data && onRevert && <Changes result={result} data={data} onRevert={onRevert} onPoint={onPoint} />}
      {result && result.questions.length > 0 && <Questions key={result.questions.map((q) => q.path).join()} result={result} onAnswer={onAnswer} onPoint={onPoint} />}
      {result && result.review.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Keep what's true: these aren't in your resume yet</p>
          {result.review.map((s) => (
            <ReviewItem key={s.id} s={s} onKeep={onKeep} onSkip={onSkip} onPoint={onPoint} />
          ))}
        </div>
      )}
      {left.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {left.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.label}:</span> {stillToDo(c, result)}
              </span>
              {fixKind(c) === "you" && c.target && (
                <Button size="sm" variant="secondary" onClick={() => onShow(c.target)}>
                  <PenLine className="h-3.5 w-3.5" /> {addLabel(c)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the fix changed, line by line, before and after: each one can be taken back on its own while it still reads as
 * the fix left it (Undo takes back all of them at once). Closed until asked for.
 */
function Changes({ result, data, onRevert, onPoint }: {
  result: ResumeFixResponse;
  data: ResumeData;
  onRevert: (s: ResumeSuggestion) => void;
  onPoint: (paths: string[]) => void;
}) {
  const lines = result.suggestions.filter((s) => s.kind !== "add_skill");
  const skills = result.suggestions.filter((s) => s.kind === "add_skill").flatMap((s) => suggestedSkills(s));
  if (!lines.length && !skills.length) return null;
  const count = lines.length + (skills.length ? 1 : 0);
  return (
    <details className="group text-sm">
      <summary className={cx("cursor-pointer select-none font-medium text-emerald-800 hover:underline dark:text-emerald-300", focusRing)}>
        See {count === 1 ? "the change" : `the ${count} changes`}
      </summary>
      <ul className="mt-2 space-y-2">
        {lines.map((s) => {
          const kept = isStillApplied(data, s);
          const now = s.kind === "add_bullet" ? null : getAt(data, s.path);
          const status = kept ? null : s.kind === "add_bullet" ? "Removed" : now === s.before ? "Put back" : "You've edited this line since";
          return (
            <li
              key={s.id}
              onMouseEnter={() => onPoint([s.path])}
              onMouseLeave={() => onPoint([])}
              className={cx("rounded-lg bg-white/60 p-2 dark:bg-white/[0.03]", !kept && "opacity-70")}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.label}</p>
              {s.kind === "add_bullet" ? (
                <p className="mt-1 text-zinc-800 dark:text-zinc-200">
                  <span className="text-emerald-700 dark:text-emerald-300">Added: </span>
                  {s.after}
                </p>
              ) : (
                <div className="mt-1">
                  <InlineResumeDiff before={s.before} after={s.after} />
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                {kept ? (
                  <Button size="sm" variant="ghost" onClick={() => onRevert(s)}>
                    <Undo2 className="h-3.5 w-3.5" /> {s.kind === "add_bullet" ? "Remove it" : "Put it back"}
                  </Button>
                ) : (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{status}</span>
                )}
              </div>
            </li>
          );
        })}
        {skills.length > 0 && (
          <li className="rounded-lg bg-white/60 p-2 text-zinc-800 dark:bg-white/[0.03] dark:text-zinc-200">
            <span className="text-emerald-700 dark:text-emerald-300">Skills added: </span>
            {skills.join(", ")}
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Remove any in Skills, or Undo takes back the whole fix.</span>
          </li>
        )}
      </ul>
    </details>
  );
}

function stillToDo(c: AtsCheck, result: ResumeFixResponse | null): string {
  if (fixKind(c) === "you") return "only you know this one.";
  if (c.id === "quantified" && result?.questions.length) return "answer the questions above to add your real numbers.";
  if (result?.review.length && ["bullets_per_role", "skills_count", "has_skills", "keywords", "length"].includes(c.id)) {
    return "keep the ones above that are true to finish it.";
  }
  return c.fix ?? "edit it yourself, or try Fix with AI again.";
}

/** The numbers only the candidate knows: one question per line; the answers are written into those lines. */
function Questions({ result, onAnswer, onPoint }: {
  result: ResumeFixResponse;
  onAnswer: (facts: Record<string, string>) => void;
  onPoint: (paths: string[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const given = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()));
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(given).length) onAnswer(given);
      }}
    >
      <p className="text-sm font-medium">Add your real numbers</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        The AI never makes numbers up. Answer the ones you know (a rough figure is fine), and it writes them in.
      </p>
      {result.questions.map((q, i) => (
        <div
          key={q.path}
          onMouseEnter={() => onPoint([q.path])}
          onMouseLeave={() => onPoint([])}
          onFocus={() => onPoint([q.path])}
          onBlur={() => onPoint([])}
          className="rounded-lg bg-white/60 p-2 dark:bg-white/[0.03]"
        >
          <label htmlFor={`fix-q-${i}`} className="block text-sm">
            {q.question}
          </label>
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">“{q.text}”</p>
          <Input
            id={`fix-q-${i}`}
            className="mt-1.5"
            maxLength={120}
            placeholder="e.g. about 40 a week"
            value={answers[q.path] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.path]: e.target.value }))}
          />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={!Object.keys(given).length}>
        <Sparkles className="h-3.5 w-3.5" /> Add my numbers
      </Button>
    </form>
  );
}

/** One claim to keep or skip: skills to tick, or a bullet drafted from the job title. */
function ReviewItem({ s, onKeep, onSkip, onPoint }: {
  s: ResumeSuggestion;
  onKeep: (s: ResumeSuggestion, picked?: string[]) => void;
  onSkip: (s: ResumeSuggestion) => void;
  onPoint: (paths: string[]) => void;
}) {
  const skills = s.kind === "add_skill" ? suggestedSkills(s) : [];
  const [off, setOff] = useState<Set<string>>(new Set());
  const picked = skills.filter((x) => !off.has(x));
  return (
    <div
      onMouseEnter={() => onPoint([s.path])}
      onMouseLeave={() => onPoint([])}
      className="rounded-lg bg-white/60 p-2 text-sm dark:bg-white/[0.03]"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.label}</p>
      {s.kind === "add_skill" ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Skills to add">
          {skills.map((skill) => (
            <button
              key={skill}
              type="button"
              aria-pressed={!off.has(skill)}
              onClick={() =>
                setOff((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(skill)) next.add(skill);
                  return next;
                })
              }
              className={cx(
                "rounded-full border px-2.5 py-0.5 text-sm",
                off.has(skill) ? "border-zinc-200 text-zinc-400 line-through dark:border-white/10" : "border-emerald-500/40 bg-emerald-500/10",
                focusRing,
              )}
            >
              {off.has(skill) ? <X className="mr-1 inline h-3 w-3" aria-hidden /> : <Plus className="mr-1 inline h-3 w-3" aria-hidden />}
              {skill}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1">{s.after}</p>
      )}
      {s.confirm && <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{s.confirm}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={s.kind === "add_skill" && !picked.length} onClick={() => onKeep(s, s.kind === "add_skill" ? picked : undefined)}>
          <Check className="h-3.5 w-3.5" /> {s.kind === "add_skill" ? `Add ${picked.length === skills.length ? "all" : picked.length}` : "Keep"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onSkip(s)}>
          Skip
        </Button>
      </div>
    </div>
  );
}
