import { useEffect, useState, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import type { CodeAttemptRecord, CodeLanguage, CodeProblem, CodeReview } from "@orbit/types";
import { Badge, CircleAlert, CircleCheck, Lightbulb, Play, Sparkles, LoadGate, cx, focusRing } from "@orbit/ui";
import { BackLink } from "../../components/BackLink";
import { Button, Card, EmptyState, ErrorNote, Field, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { DIFFICULTY_TONE } from "./CodeHome";
import { CODE_HOME } from "./paths";
import { callText, failingText, runTests, type RunResult } from "./runner";

const LANGUAGES: Array<{ id: CodeLanguage; label: string }> = [
  { id: "javascript", label: "JavaScript (tests run here)" },
  { id: "python", label: "Python (reviewed, not run)" },
  { id: "java", label: "Java (reviewed, not run)" },
  { id: "cpp", label: "C++ (reviewed, not run)" },
];

function starter(p: CodeProblem, lang: CodeLanguage): string {
  return lang === "javascript" ? p.js : lang === "python" ? p.python : "";
}

/** One problem: the statement, an editor, tests run in the browser, hints, and the interviewer's review. */
export function CodeProblemPage() {
  const { problemId = "" } = useParams();
  const data = useAsync(() => api.codeProblem(problemId), [problemId], `code-${problemId}`);
  return (
    <>
      <BackLink to={CODE_HOME} className="mb-4">All problems</BackLink>
      <LoadGate loading={data.loading && !data.data} variant="card" count={2} label="Getting the problem">
        {data.error && !data.data ? (
          <ErrorNote onRetry={data.reload}>{errorText(data.error)}</ErrorNote>
        ) : data.data ? (
          <Workspace key={problemId} problem={data.data.problem} attempts={data.data.attempts} reviewsLeft={data.data.reviews_left}
                     onReviewed={(a) => data.setData((prev) => prev && { ...prev, attempts: [a, ...prev.attempts], reviews_left: prev.reviews_left === null ? null : Math.max(prev.reviews_left - 1, 0) })} />
        ) : (
          <EmptyState title="That problem isn't here" body="Pick one from the list." />
        )}
      </LoadGate>
    </>
  );
}

function Workspace({ problem: p, attempts, reviewsLeft, onReviewed }: { problem: CodeProblem; attempts: CodeAttemptRecord[]; reviewsLeft: number | null; onReviewed: (a: CodeAttemptRecord) => void }) {
  const last = attempts[0];
  const [lang, setLang] = useState<CodeLanguage>(last?.language ?? "javascript");
  const [code, setCode] = useState(last?.code ?? starter(p, "javascript"));
  const [approach, setApproach] = useState(last?.approach ?? "");
  const [hints, setHints] = useState(0);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<"run" | "review" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const review = last?.review ?? null;
  useEffect(() => setRun(null), [code, lang]);

  const changeLang = (next: CodeLanguage) => {
    if (code.trim() === starter(p, lang).trim() || !code.trim()) setCode(starter(p, next));
    setLang(next);
  };
  const runIt = async () => {
    setBusy("run");
    setRun(await runTests(code, p.function, p.tests, p.unordered));
    setBusy(null);
  };
  const reviewIt = async () => {
    setBusy("review");
    setError(null);
    try {
      const r = lang === "javascript" ? (run ?? (await runTests(code, p.function, p.tests, p.unordered))) : null;
      if (r) setRun(r);
      onReviewed(await api.reviewCode(p.id, {
        language: lang, code, approach,
        passed: r?.passed ?? 0, total: r && !r.error ? r.total : 0, failing: r ? (r.error ?? failingText(p.function, r)) : "",
      }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const tab = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const t = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = t;
    setCode(code.slice(0, s) + "  " + code.slice(end));
    requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4">
        <Card>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold">{p.title}</h1>
            <Badge tone={DIFFICULTY_TONE[p.difficulty]} className="capitalize">{p.difficulty}</Badge>
          </div>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{p.pattern}</p>
          <p className="text-sm leading-relaxed">{p.statement}</p>
          <h2 className="mt-3 text-sm font-semibold">Examples</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {p.examples.map((x) => <li key={x}><code className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-xs">{x}</code></li>)}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">A strong answer: {p.target}. Say it before you code.</p>
        </Card>
        <Card>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden /> Hints</h2>
          {hints === 0 && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Stuck? Each hint goes a little further. None gives you the code.</p>}
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            {p.hints.slice(0, hints).map((h) => <li key={h}>{h}</li>)}
          </ol>
          {hints < p.hints.length && (
            <Button className="mt-2" size="sm" variant="ghost" onClick={() => setHints((n) => n + 1)}>
              {hints === 0 ? "Show a hint" : "Next hint"} ({hints + 1} of {p.hints.length})
            </Button>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <Field label="Language" htmlFor="code-lang">
              <Select id="code-lang" value={lang} onChange={(e) => changeLang(e.target.value as CodeLanguage)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            </Field>
            {lang === "javascript" && (
              <Button variant="secondary" disabled={busy !== null || !code.trim()} onClick={() => void runIt()}>
                <Play className="h-4 w-4" /> {busy === "run" ? "Running…" : `Run ${p.tests.length} tests`}
              </Button>
            )}
          </div>
          <label htmlFor="code-editor" className="sr-only">Your code</label>
          <textarea id="code-editor" value={code} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={16} maxLength={12000}
                    onChange={(e) => setCode(e.target.value)} onKeyDown={tab}
                    className={cx("w-full resize-y rounded-xl border border-zinc-200 bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-100 dark:border-white/10", focusRing)} />
          {run && <RunView fn={p.function} run={run} />}
        </Card>
        <Card>
          <Field label="Explain your approach" htmlFor="code-approach" hint="As you would to the interviewer: the idea, why it works, its time and space, the edge cases. The review scores this.">
            <Textarea id="code-approach" rows={4} maxLength={3000} value={approach} onChange={(e) => setApproach(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button disabled={busy !== null || !code.trim() || reviewsLeft === 0} onClick={() => void reviewIt()}>
              <Sparkles className="h-4 w-4" /> {busy === "review" ? "The interviewer is reading…" : "Get the interviewer's review"}
            </Button>
            {reviewsLeft !== null && <span className="text-xs text-zinc-500 dark:text-zinc-400">{reviewsLeft} free review{reviewsLeft === 1 ? "" : "s"} left today</span>}
          </div>
          {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        </Card>
        {review && <ReviewView review={review} attempt={last!} />}
        {attempts.length > 1 && (
          <Card>
            <h2 className="mb-2 font-display text-base font-semibold">Your tries</h2>
            <ul className="space-y-1 text-sm">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  {a.solved ? <CircleCheck className="h-4 w-4 text-emerald-500" aria-label="Solved" /> : <CircleAlert className="h-4 w-4 text-amber-500" aria-label="Not solved" />}
                  <span className="flex-1">{new Date(a.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {a.language}</span>
                  {a.total > 0 && <span className="tabular-nums text-zinc-500">{a.passed}/{a.total} tests</span>}
                  <button type="button" className={cx("text-xs text-indigo-600 dark:text-indigo-400", focusRing)} onClick={() => { setLang(a.language); setCode(a.code); setApproach(a.approach); }}>Load</button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function RunView({ fn, run }: { fn: string; run: RunResult }) {
  if (run.error) {
    return <p role="status" className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-900 dark:text-rose-100">{run.error}</p>;
  }
  const all = run.passed === run.total;
  return (
    <div role="status" className="mt-3">
      <p className={cx("text-sm font-medium", all ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200")}>
        {all ? `All ${run.total} tests pass.` : `${run.passed} of ${run.total} tests pass.`}
      </p>
      <ul className="mt-1 space-y-1 font-mono text-xs">
        {run.results.map((r, i) => (
          <li key={i} className="flex gap-2">
            {r.ok ? <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Passed" /> : <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Failed" />}
            <span className="min-w-0 break-all">
              {callText(fn, r.args)}
              {!r.ok && <span className="block text-zinc-500">{r.error ? `threw: ${r.error}` : `gave ${JSON.stringify(r.got)}, expected ${JSON.stringify(r.expected)}`}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SCORE_LABEL: Record<keyof CodeReview["scores"], string> = {
  problem_solving: "Problem solving", code_quality: "Code", complexity: "Complexity", communication: "Explaining it",
};
const VERDICT = { solved: "Solved", partly: "Nearly there", not_yet: "Not yet" } as const;

function ReviewView({ review: r, attempt }: { review: CodeReview; attempt: CodeAttemptRecord }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">The interviewer's review</h2>
        <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", r.verdict === "solved" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
          {VERDICT[r.verdict]}{attempt.total > 0 ? ` · ${attempt.passed}/${attempt.total} tests` : ""}
        </span>
      </div>
      <p className="mt-2 text-sm">{r.summary}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(SCORE_LABEL) as Array<keyof CodeReview["scores"]>).map((k) => (
          <div key={k} className="rounded-lg bg-zinc-500/[0.06] p-2 text-center">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{SCORE_LABEL[k]}</dt>
            <dd className="font-display text-lg font-semibold tabular-nums">{r.scores[k]}<span className="text-xs font-normal text-zinc-500">/5</span></dd>
          </div>
        ))}
      </dl>
      {r.complexity && <p className="mt-3 text-sm"><span className="text-zinc-500 dark:text-zinc-400">Your complexity:</span> {r.complexity}</p>}
      <List title="Done well" items={r.strengths} />
      <List title="Fix" items={r.fixes} />
      <List title="Edge cases to handle" items={r.edge_cases} />
      {r.follow_up && <p className="mt-3 rounded-lg bg-indigo-500/[0.07] p-3 text-sm"><span className="font-medium">They'd ask next:</span> {r.follow_up}</p>}
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}
