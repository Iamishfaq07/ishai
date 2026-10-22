import { SpotArt } from "../../components/SpotArt";
import { useEffect, useMemo, useState } from "react";
import { Brain, Check, Clock, Reveal, RotateCcw, X, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Button, Card, PageHeader } from "../../components/ui";
import { SECTIONS, buildTest, type Question, type Section } from "./questions";

const HISTORY_KEY = "orbit.aptitude.history";
interface Attempt { at: string; score: number; total: number; sections: Section[] }

const isAttempts = (v: unknown): v is Attempt[] => Array.isArray(v);
function loadHistory(): Attempt[] { return readJSON(safeLocal, HISTORY_KEY, [], isAttempts).slice(0, 10); }
function saveHistory(list: Attempt[]) { safeLocal.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10))); }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Aptitude practice (pages/aptitude/questions.ts): the quantitative, logical and verbal tests placement drives and
 * screening rounds use. Quant and logical are generated with computed answers; verbal comes from a checked bank.
 * Everything runs in the browser; recent scores stay on this device.
 */
export function AptitudePage() {
  const [sections, setSections] = useState<Section[]>(["quant", "logical", "verbal"]);
  const [count, setCount] = useState(15);
  const [timed, setTimed] = useState(true);
  const [test, setTest] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [left, setLeft] = useState(0);
  const [history, setHistory] = useState<Attempt[]>(loadHistory);

  const start = () => {
    const q = buildTest(sections, count, Date.now() % 2_147_483_647);
    setTest(q); setAnswers({}); setIndex(0); setDone(false); setLeft(q.length * 60);
  };
  const finish = () => {
    if (!test) return;
    setDone(true);
    const score = test.filter((q) => answers[q.id] === q.answer).length;
    const next = [{ at: new Date().toISOString(), score, total: test.length, sections }, ...history];
    setHistory(next); saveHistory(next);
  };
  useEffect(() => {
    if (!test || done || !timed) return;
    if (left <= 0) { finish(); return; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // finish reads the latest answers through closure on each tick
  }, [test, done, timed, left]); // eslint-disable-line react-hooks/exhaustive-deps

  const score = useMemo(() => test ? test.filter((q) => answers[q.id] === q.answer).length : 0, [test, answers]);

  if (!test) return <div>
    <PageHeader art={<SpotArt kind="practice" />} eyebrow="Interview preparation" icon={Brain} title="Aptitude practice"
      subtitle="The quantitative, reasoning and verbal tests used in placement drives and screening rounds. Fresh questions every time, with worked answers." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="space-y-5">
        <fieldset><legend className="font-semibold">Sections</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">{SECTIONS.map((s) => {
            const on = sections.includes(s.id);
            return <label key={s.id} className={cx("cursor-pointer rounded-xl border p-3 text-sm motion-safe:transition-colors", on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10")}>
              <input type="checkbox" className={cx("mr-2", focusRing)} checked={on} onChange={() => setSections((x) => on ? x.filter((y) => y !== s.id) : [...x, s.id])} />
              <span className="font-semibold">{s.label}</span><span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">{s.about}</span></label>;
          })}</div></fieldset>
        <fieldset><legend className="font-semibold">Length</legend>
          <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">{[10, 15, 20, 30].map((c) =>
            <button key={c} type="button" role="radio" aria-checked={count === c} onClick={() => setCount(c)}
              className={cx("min-h-10 rounded-lg px-4 text-sm font-medium ring-1", count === c ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>
              {c} questions</button>)}</div></fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={timed} onChange={(e) => setTimed(e.target.checked)} />Timed: one minute a question, like most placement tests</label>
        <Button size="lg" disabled={!sections.length} onClick={start}>Start the test</Button>
      </Card>
      <Card>
        <h2 className="font-semibold">Recent scores</h2>
        {history.length ? <ul className="mt-3 space-y-2 text-sm">{history.map((h) => <li key={h.at} className="flex items-center justify-between gap-2">
          <span className="text-zinc-600 dark:text-zinc-400">{new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {h.sections.map((s) => SECTIONS.find((x) => x.id === s)?.label.split(" ")[0]).join(", ")}</span>
          <span className="font-semibold tabular-nums">{h.score}/{h.total}</span></li>)}</ul>
          : <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Your scores appear here, on this device only.</p>}
      </Card>
    </div>
  </div>;

  if (done) {
    const pct = Math.round((score / test.length) * 100);
    return <div className="space-y-6">
      <PageHeader art={<SpotArt kind="practice" />} eyebrow="Aptitude practice" icon={Brain} title={`You scored ${score} of ${test.length}`} subtitle={pct >= 80 ? "Strong. Most placement cut-offs sit between 60% and 75%." : pct >= 60 ? "Around typical cut-offs. Review the misses below, then try again." : "Review each explanation below; the patterns repeat across tests."}
        actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => setTest(null)}>Change setup</Button><Button onClick={start}><RotateCcw className="h-4 w-4" /> New test</Button></div>} />
      <Reveal stagger className="grid gap-3 sm:grid-cols-3">{SECTIONS.filter((s) => test.some((q) => q.section === s.id)).map((s) => {
        const qs = test.filter((q) => q.section === s.id), ok = qs.filter((q) => answers[q.id] === q.answer).length;
        return <div key={s.id} className="workspace-panel p-4"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{s.label}</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{ok}/{qs.length}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${(ok / qs.length) * 100}%` }} /></div></div>;
      })}</Reveal>
      <ol className="space-y-3">{test.map((q, i) => {
        const mine = answers[q.id], right = mine === q.answer;
        return <li key={q.id}><Card>
          <p className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">{right ? <Check className="h-4 w-4 text-emerald-600" aria-label="Correct" /> : <X className="h-4 w-4 text-rose-600" aria-label="Wrong" />}Question {i + 1} · {q.topic}</p>
          <p className="mt-2 font-medium">{q.prompt}</p>
          <p className="mt-2 text-sm">Answer: <span className="font-semibold text-emerald-700 dark:text-emerald-300">{q.options[q.answer]}</span>{!right && <> · You chose: <span className="font-semibold text-rose-700 dark:text-rose-300">{mine === undefined ? "nothing" : q.options[mine]}</span></>}</p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{q.explain}</p>
        </Card></li>;
      })}</ol>
    </div>;
  }

  const q = test[index]!;
  const answered = Object.keys(answers).length;
  return <div className="mx-auto max-w-2xl space-y-5">
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">Question {index + 1} of {test.length} · {SECTIONS.find((s) => s.id === q.section)?.label}</span>
      {timed && <span className={cx("inline-flex items-center gap-1 tabular-nums", left < 60 && "font-semibold text-rose-700 dark:text-rose-300")} aria-live={left < 60 ? "polite" : "off"}><Clock className="h-4 w-4" aria-hidden />{mmss(left)}</span>}
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden><div className="h-full rounded-full bg-indigo-600 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${(answered / test.length) * 100}%` }} /></div>
    <Card key={q.id} className="motion-safe:animate-fade-up">
      <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{q.topic}</p>
      <h1 className="mt-2 text-lg font-semibold leading-snug">{q.prompt}</h1>
      <div role="radiogroup" aria-label="Options" className="mt-4 grid gap-2">{q.options.map((o, i) => {
        const chosen = answers[q.id] === i;
        return <button key={i} type="button" role="radio" aria-checked={chosen} onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
          className={cx("flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm motion-safe:transition-colors", chosen ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-500/10" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10", focusRing)}>
          <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", chosen ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-white/10")}>{String.fromCharCode(65 + i)}</span>{o}</button>;
      })}</div>
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Previous</Button>
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{answered} of {test.length} answered</span>
      {index < test.length - 1 ? <Button onClick={() => setIndex((i) => i + 1)}>Next</Button> : <Button onClick={finish}>Submit</Button>}
    </div>
  </div>;
}
