// Orbit for Business: the "Orbit assistant" beside the job editor (D85). A few words in, every field of the form
// filled; then short instructions that change only what they name. Nothing here saves or publishes: the person
// reviews the form and clicks Save or Publish as always. Loaded on its own, with the editor.
import { useId, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { BizJobAssist, BizJobAssistCurrent } from "@orbit/types";
import { Button, Callout, Field, Input, Sparkles, Textarea, cx, focusRing } from "@orbit/ui";
import { biz } from "./api";
import { EXAMPLES, REFINES, SALARY_HINT, turnFrom, type Applied, type PanelState } from "./assist";
import { errorText } from "./ui";

const chip = cx(
  "rounded-full border border-zinc-200 bg-white px-3 py-1 text-left text-xs text-zinc-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-900",
  "dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-100",
  focusRing,
);

export interface JobAssistantProps {
  companyId: string;
  panel: PanelState;
  setPanel: Dispatch<SetStateAction<PanelState>>;
  /** The form as it is, for a refine. */
  getCurrent: () => BizJobAssistCurrent;
  /** Put an answer into the editor; returns what changed. */
  onAnswer: (a: BizJobAssist, kind: "fill" | "refine") => Applied;
  /** Fields still showing the AI mark (for "Undo fill"). */
  marked: number;
  onUndoAll: () => void;
  /** The salary is empty now (the hint asks for a range). */
  salaryMissing: boolean;
  disabled?: boolean;
  /** Collapse the panel (wide screens) or close the sheet (phones). */
  onClose?: () => void;
  closeLabel?: string;
}

export function JobAssistant({ companyId, panel, setPanel, getCurrent, onAnswer, marked, onUndoAll, salaryMissing, disabled, onClose, closeLabel = "Hide the assistant" }: JobAssistantProps) {
  const id = useId();
  const [busy, setBusy] = useState<"fill" | "refine" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(panel.turns.length);
  const set = <K extends keyof PanelState>(k: K, v: PanelState[K]) => setPanel((p) => ({ ...p, [k]: v }));
  const filled = panel.turns.some((t) => t.kind === "fill");
  const last = panel.turns[panel.turns.length - 1];

  const fill = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!panel.prompt.trim() && !panel.pasted.trim() && !panel.title.trim()) {
      setError("Describe the job in a few words first.");
      return;
    }
    setBusy("fill");
    setError(null);
    try {
      const a = await biz.assistJob(companyId, { prompt: panel.prompt, title: panel.title, location: panel.location, salary: panel.salary, experience: panel.experience, pasted: panel.pasted });
      const applied = onAnswer(a, "fill");
      const turn = turnFrom(++seq.current, "fill", panel.prompt || panel.title || "Your notes", a, applied);
      setPanel((p) => ({ ...p, turns: [...p.turns, turn] }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const refine = async (text: string) => {
    const instruction = text.trim();
    if (busy || !instruction) return;
    setBusy("refine");
    setError(null);
    try {
      const a = await biz.assistJob(companyId, { prompt: "", instruction, current: getCurrent() });
      const applied = onAnswer(a, "refine");
      const turn = turnFrom(++seq.current, "refine", instruction, a, applied);
      setPanel((p) => ({ ...p, instruction: "", turns: [...p.turns, turn] }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} className="overflow-hidden rounded-2xl border border-indigo-200/70 bg-white shadow-sm dark:border-indigo-400/20 dark:bg-zinc-900/70">
      <div className="flex items-center justify-between gap-2 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3 dark:border-indigo-400/15 dark:from-indigo-500/10 dark:to-transparent">
        <h2 id={`${id}-h`} className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white dark:bg-indigo-500" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </span>
          Orbit assistant
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} className={cx("rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/10", focusRing)}>
            {closeLabel}
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <form onSubmit={(e) => void fill(e)} className="space-y-3" noValidate>
          <Field label="Describe the job in a few words" htmlFor={`${id}-p`} hint="Role, place, pay, experience: whatever you know. Orbit fills the form; you review it.">
            <Textarea
              id={`${id}-p`}
              rows={3}
              maxLength={2000}
              value={panel.prompt}
              disabled={disabled}
              placeholder="Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ years"
              onChange={(e) => set("prompt", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void fill();
                }
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Examples">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className={chip} disabled={disabled} onClick={() => set("prompt", x)}>
                {x}
              </button>
            ))}
          </div>
          <div>
            <button type="button" aria-expanded={panel.more} aria-controls={`${id}-more`} onClick={() => set("more", !panel.more)} className={cx("rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
              {panel.more ? "Fewer details" : "Add details (optional)"}
            </button>
            {panel.more && (
              <div id={`${id}-more`} className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Title" htmlFor={`${id}-t`}>
                    <Input id={`${id}-t`} value={panel.title} maxLength={160} disabled={disabled} onChange={(e) => set("title", e.target.value)} />
                  </Field>
                  <Field label="Location" htmlFor={`${id}-l`}>
                    <Input id={`${id}-l`} value={panel.location} maxLength={160} placeholder="Pune, hybrid" disabled={disabled} onChange={(e) => set("location", e.target.value)} />
                  </Field>
                  <Field label="Salary" htmlFor={`${id}-s`}>
                    <Input id={`${id}-s`} value={panel.salary} maxLength={80} placeholder="12–18 LPA" disabled={disabled} onChange={(e) => set("salary", e.target.value)} />
                  </Field>
                  <Field label="Experience" htmlFor={`${id}-x`}>
                    <Input id={`${id}-x`} value={panel.experience} maxLength={60} placeholder="3+ years" disabled={disabled} onChange={(e) => set("experience", e.target.value)} />
                  </Field>
                </div>
                <Field label="Paste an old job post or notes" htmlFor={`${id}-o`}>
                  <Textarea id={`${id}-o`} rows={4} maxLength={12000} value={panel.pasted} disabled={disabled} onChange={(e) => set("pasted", e.target.value)} />
                </Field>
              </div>
            )}
          </div>
          <Button type="submit" className="w-full" loading={busy === "fill"} loadingText="Filling the job" disabled={disabled || busy === "refine"}>
            <Sparkles className="h-4 w-4" aria-hidden /> {filled ? "Fill again" : "Fill the job"}
          </Button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing is published: you check every field, then save or publish.</p>
        </form>

        {error && <Callout tone="error">{error}</Callout>}

        <div role="status" aria-live="polite" className="space-y-3">
          {last && (
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <p className="font-medium text-zinc-900 dark:text-white">{last.summary}</p>
              {last.template && <p className="text-amber-800 dark:text-amber-300">We couldn't reach the AI writer, so this is what you wrote, laid out. It's in the editor: fill in the rest there.</p>}
              {last.assumptions.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">What Orbit assumed</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-700 dark:text-zinc-300">
                    {last.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {last.notes.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Inclusive wording</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-700 dark:text-zinc-300">
                    {last.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {filled && salaryMissing && <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{SALARY_HINT}</p>}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Fields marked AI are new: edit any of them, or undo one from its mark.</p>
            </div>
          )}
        </div>
        {marked > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={onUndoAll} disabled={disabled || !!busy}>
            Undo fill ({marked} field{marked === 1 ? "" : "s"})
          </Button>
        )}

        {filled && (
          <form
            className="space-y-2 border-t border-zinc-200 pt-4 dark:border-white/10"
            onSubmit={(e) => {
              e.preventDefault();
              void refine(panel.instruction);
            }}
          >
            <Field label="Refine with a short instruction" htmlFor={`${id}-r`}>
              <div className="flex gap-2">
                <Input id={`${id}-r`} value={panel.instruction} maxLength={500} placeholder="Make it more junior" disabled={disabled} onChange={(e) => set("instruction", e.target.value)} />
                <Button type="submit" variant="secondary" loading={busy === "refine"} loadingText="Changing" disabled={disabled || busy === "fill" || !panel.instruction.trim()}>
                  Apply
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggestions">
              {REFINES.map((x) => (
                <button key={x} type="button" className={chip} disabled={disabled || !!busy} onClick={() => void refine(x)}>
                  {x}
                </button>
              ))}
            </div>
            {panel.turns.length > 1 && (
              <ol className="mt-2 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400" aria-label="Changes so far">
                {panel.turns
                  .slice(0, -1)
                  .reverse()
                  .map((t) => (
                    <li key={t.id} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{t.kind === "fill" ? "Filled" : `“${t.said}”`}</span> · {t.summary}
                    </li>
                  ))}
              </ol>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
