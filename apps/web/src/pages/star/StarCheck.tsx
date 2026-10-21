import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleAlert, ListChecks, Mic, Reveal, cx, focusRing, safeLocal } from "@orbit/ui";
import { Card, PageHeader, Select, Textarea } from "../../components/ui";
import { QUESTIONS, band, checkAnswer } from "./starCheck";

const DRAFT = "orbit.star-check.draft";
const TONE = {
  good: "text-emerald-700 dark:text-emerald-300", ok: "text-amber-700 dark:text-amber-300", weak: "text-rose-700 dark:text-rose-300",
} as const;
const RING = { good: "stroke-emerald-500", ok: "stroke-amber-500", weak: "stroke-rose-500" } as const;

function readDraft(): { question: string; answer: string } {
  try { const v = JSON.parse(safeLocal.getItem(DRAFT) ?? "null") as unknown; if (v && typeof v === "object" && "answer" in v) return v as { question: string; answer: string }; } catch { /* no draft */ }
  return { question: QUESTIONS[0], answer: "" };
}

/**
 * Prepare → STAR answer check (pages/star/starCheck.ts): write or paste a behavioural answer and see, sentence by
 * sentence, which parts of STAR+R it covers, with numbers, ownership, length and filler words. Runs in the browser;
 * the draft stays on this device.
 */
export function StarCheckPage() {
  const [draft, setDraft] = useState(readDraft);
  const save = (next: typeof draft) => { setDraft(next); safeLocal.setItem(DRAFT, JSON.stringify(next)); };
  const text = useDeferredValue(draft.answer);
  const report = useMemo(() => checkAnswer(text), [text]);
  const b = band(report.score);
  const has = report.words >= 25;
  const circumference = 2 * Math.PI * 42;

  return <div>
    <PageHeader eyebrow="Interview preparation" icon={ListChecks} title="STAR answer check"
      subtitle="Write a “Tell me about a time…” answer and see which parts of Situation, Task, Action, Result and Reflection it covers, before you say it out loud." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="space-y-4">
        <div>
          <label htmlFor="star-q" className="text-sm font-semibold">Question</label>
          <Select id="star-q" className="mt-2 w-full" value={draft.question} onChange={(e) => save({ ...draft, question: e.target.value })}>
            {QUESTIONS.map((q) => <option key={q}>{q}</option>)}</Select>
        </div>
        <div>
          <label htmlFor="star-a" className="text-sm font-semibold">Your answer</label>
          <Textarea id="star-a" rows={14} className="mt-2" value={draft.answer} onChange={(e) => save({ ...draft, answer: e.target.value })}
            placeholder="In my final-year project, our team had three weeks to… My job was to… I first… then I… As a result… I learnt…" />
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{report.words} words · about {report.seconds < 60 ? `${report.seconds} seconds` : `${Math.round(report.seconds / 6) / 10} minutes`} spoken · saved on this device</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/documents/stories" className={cx("rounded-lg px-3 py-2 font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>Save it as a story</Link>
          <Link to="/mock" className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}><Mic className="h-4 w-4" aria-hidden />Practise it out loud</Link>
        </div>
      </Card>

      <aside className="space-y-4" aria-live="polite">
        <Card className="flex items-center gap-4">
          <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="42" className="fill-none stroke-zinc-100 dark:stroke-white/10" strokeWidth="9" />
            <circle cx="50" cy="50" r="42" className={cx("fill-none motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500", has ? RING[b.tone] : "stroke-zinc-300")} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (has ? report.score : 0) / 100)} />
          </svg>
          <div><p className="font-display text-3xl font-semibold tabular-nums">{has ? report.score : "–"}<span className="text-base text-zinc-500">/100</span></p>
            <p className={cx("text-sm font-medium", has ? TONE[b.tone] : "text-zinc-600 dark:text-zinc-400")}>{has ? b.label : "Write a few sentences to see the check"}</p></div>
        </Card>
        {has && <Reveal stagger className="space-y-2">{report.parts.map((p) => <div key={p.id} className="workspace-panel p-3">
          <p className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="flex items-center gap-2">{p.got ? <Check className="h-4 w-4 text-emerald-600" aria-label="Covered" /> : <CircleAlert className="h-4 w-4 text-amber-600" aria-label="Missing" />}{p.label}</span>
            <span className="tabular-nums text-zinc-500">{p.got}/{p.points}</span></p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{p.quote ? <>“{p.quote.length > 140 ? `${p.quote.slice(0, 140)}…` : p.quote}”</> : p.tip}</p>
        </div>)}</Reveal>}
        {has && <Card>
          <h2 className="text-sm font-semibold">Delivery</h2>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-white/5"><dt className="text-zinc-500">Numbers</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{report.numbers.length}</dd></div>
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-white/5"><dt className="text-zinc-500">I / we</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{report.i}/{report.we}</dd></div>
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-white/5"><dt className="text-zinc-500">Fillers</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{report.fillers.reduce((n, f) => n + f.count, 0)}</dd></div>
          </dl>
          {report.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </Card>}
        <p className="px-1 text-xs text-zinc-600 dark:text-zinc-400">This checks structure, not whether the story is good or true. Use real examples only.</p>
      </aside>
    </div>
  </div>;
}
