import { useMemo, useState } from "react";
import { Brain, Check, RotateCcw, Sparkles, X, cx } from "@orbit/ui";
import { Button, Card, ErrorNote, PageHeader, Textarea } from "../../components/ui";
import { SpotArt } from "../../components/SpotArt";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { STEPS, checkSteps, pickQuestion, type Question, type StepId } from "./guesstimate";

interface Review {
  scores: { clarify: number; structure: number; assumptions: number; math: number; sanity: number };
  total: number; summary: string;
  assumptions: Array<{ quote: string; verdict: "reasonable" | "too high" | "too low" | "needs a reason"; note: string }>;
  math_ok: boolean; math_note: string; missed: string[]; follow_ups: string[];
}
const SCORE_LABELS: Array<[keyof Review["scores"], string]> = [["clarify", "Clarify"], ["structure", "Structure"], ["assumptions", "Assumptions"], ["math", "Maths"], ["sanity", "Sanity check"]];
const VERDICT = { reasonable: "text-emerald-800 dark:text-emerald-300", "too high": "text-amber-800 dark:text-amber-300", "too low": "text-amber-800 dark:text-amber-300", "needs a reason": "text-zinc-700 dark:text-zinc-300" } as const;
const EMPTY: Record<StepId, string> = { clarify: "", approach: "", assumptions: "", calculation: "", answer: "", sanity: "" };

/**
 * Prepare → Guesstimates (pages/kit/guesstimate.ts): an estimation question worked in the five steps interviewers
 * look for, with instant step checks and an AI review of the reasoning (POST /v1/practice/guesstimate-review).
 */
export function GuesstimatePage() {
  const [question, setQuestion] = useState<Question>(() => pickQuestion(null));
  const [steps, setSteps] = useState<Record<StepId, string>>(EMPTY);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);
  const checks = useMemo(() => checkSteps(steps), [steps]);
  const filled = Object.values(steps).filter((s) => s.trim()).length;

  const another = () => { setQuestion(pickQuestion(question.id)); setSteps(EMPTY); setReview(null); setError(null); setShowHints(false); };
  const submit = async () => {
    setBusy(true); setError(null);
    try { setReview(await api.call<Review>("/v1/practice/guesstimate-review", { method: "POST", body: JSON.stringify({ question: question.text, ...steps }) })); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return <div>
    <PageHeader art={<SpotArt kind="plan" />} eyebrow="Interview preparation" icon={Brain} title="Guesstimate practice"
      subtitle="Estimation questions from consulting, product and analyst interviews. Work it in five steps, then get a review of your reasoning: interviewers care how you get there more than the number." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Your question</p>
          <h2 className="text-lg font-semibold leading-snug">{question.text}</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={another}><RotateCcw className="h-4 w-4" aria-hidden /> Another question</Button>
            <Button variant="ghost" size="sm" aria-expanded={showHints} onClick={() => setShowHints(!showHints)}>{showHints ? "Hide angles" : "Stuck? Angles to consider"}</Button>
          </div>
          {showHints && <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">{question.consider.map((c) => <li key={c}>{c}</li>)}</ul>}
        </Card>

        <Card className="space-y-5">
          {STEPS.map((s, i) => <div key={s.id} className="space-y-1.5">
            <label htmlFor={`g-${s.id}`} className="block text-sm font-semibold">{i + 1}. {s.name}</label>
            <p id={`g-${s.id}-hint`} className="text-xs text-zinc-600 dark:text-zinc-400">{s.hint}</p>
            <Textarea id={`g-${s.id}`} aria-describedby={`g-${s.id}-hint`} rows={s.rows} value={steps[s.id]} readOnly={Boolean(review)}
              onChange={(e) => setSteps({ ...steps, [s.id]: e.target.value })} />
          </div>)}
          <div className="flex flex-wrap gap-2">
            {!review ? <Button loading={busy} disabled={filled < 3} onClick={() => void submit()}><Sparkles className="h-4 w-4" aria-hidden /> Review my reasoning</Button>
              : <><Button variant="secondary" onClick={() => setReview(null)}>Edit and review again</Button><Button variant="ghost" onClick={another}>Next question</Button></>}
          </div>
          {filled < 3 && !review && <p className="text-xs text-zinc-600 dark:text-zinc-400">Fill at least three steps to get a review.</p>}
          <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
        </Card>

        {review && <Card className="space-y-4">
          <div aria-live="polite"><h2 className="text-lg font-semibold">Score: {review.total} / 25</h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{review.summary}</p></div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{SCORE_LABELS.map(([k, label]) =>
            <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt><dd className="text-lg font-semibold tabular-nums">{review.scores[k]} / 5</dd></div>)}</dl>
          <p className="flex gap-2 text-sm">{review.math_ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />}
            <span><span className="font-medium">{review.math_ok ? "The maths adds up." : "Check the maths."}</span> {review.math_note}</span></p>
          {review.assumptions.length > 0 && <div><h3 className="text-sm font-semibold">Your assumptions</h3>
            <ul className="mt-2 space-y-2">{review.assumptions.map((a) => <li key={a.quote} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
              <p>“{a.quote}” <span className={cx("font-medium", VERDICT[a.verdict])}>· {a.verdict}</span></p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{a.note}</p></li>)}</ul></div>}
          {review.missed.length > 0 && <div><h3 className="text-sm font-semibold">Also worth considering</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{review.missed.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          {review.follow_ups.length > 0 && <div><h3 className="text-sm font-semibold">An interviewer might ask next</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{review.follow_ups.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">The review judges reasoning and arithmetic. It doesn't give a "right answer": check any real figure you rely on.</p>
        </Card>}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">Step checks</h2>
          <ul className="space-y-2 text-sm">{checks.map((c) => <li key={c.id} className="flex gap-2">
            {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />}
            <span><span className="font-medium">{STEPS.find((s) => s.id === c.id)!.name}{c.ok ? "" : " (to do)"}.</span> <span className="text-zinc-600 dark:text-zinc-400">{c.note}</span></span></li>)}</ul>
        </Card>
        <Card className="space-y-2">
          <h2 className="font-semibold">Say it out loud too</h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">In the room you'll talk it through. Once it's written, explain it aloud in two minutes, as if to an interviewer.</p>
        </Card>
      </aside>
    </div>
  </div>;
}
