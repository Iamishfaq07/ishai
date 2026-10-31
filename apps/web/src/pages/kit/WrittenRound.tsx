import { useEffect, useMemo, useState } from "react";
import { Check, Clock, PenLine, RotateCcw, Sparkles, X, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Input, PageHeader, Textarea } from "../../components/ui";
import { SpotArt } from "../../components/SpotArt";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { words } from "../../lib/warmup/checks";
import { useToolLocal } from "../../lib/useToolLocal";
import { NO_SCORE_HISTORY, validScoreHistory } from "./practiceHistory";
import { BRIEFS, checkWritten, timeLeft, type Brief, type Kind } from "./written";

interface Review {
  scores: { content: number; organisation: number; language: number; tone: number };
  total: number; words: number; summary: string; covered: string[]; missed: string[];
  fixes: Array<{ quote: string; issue: string; better: string }>; strengths: string[];
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const SCORE_LABELS: Array<[keyof Review["scores"], string]> = [["content", "Content"], ["organisation", "Organisation"], ["language", "Language"], ["tone", "Tone"]];

/**
 * Prepare → Written English round (pages/kit/written.ts): an email to a brief or a short essay, against the clock,
 * with instant form checks and an AI review (POST /v1/practice/written-review) that quotes the candidate's own words.
 */
export function WrittenRoundPage() {
  const [kind, setKind] = useState<Kind>("email");
  const [brief, setBrief] = useState<Brief>(BRIEFS[0]!);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useToolLocal("written", NO_SCORE_HISTORY, validScoreHistory);
  const left = startedAt === null ? brief.minutes * 60 : timeLeft(startedAt, brief.minutes, now);
  const checks = useMemo(() => checkWritten(brief, subject, text), [brief, subject, text]);
  const n = words(text).length;

  useEffect(() => {
    if (startedAt === null || review) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, review]);

  const choose = (b: Brief) => { setBrief(b); setStartedAt(null); setSubject(""); setText(""); setReview(null); setError(null); };
  const switchKind = (k: Kind) => { setKind(k); choose(BRIEFS.find((b) => b.kind === k)!); };
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body = brief.kind === "email" ? `Subject: ${subject}\n\n${text}` : text;
      const r = await api.call<Review>("/v1/practice/written-review", { method: "POST", body: JSON.stringify({ kind: brief.kind, brief: brief.text, text: body }) });
      setReview(r);
      setHistory([{ at: new Date().toISOString(), score: Math.round((r.total / 20) * 100) }, ...history].slice(0, 10));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return <div>
    <PageHeader art={<SpotArt kind="resume" />} eyebrow="Interview preparation" icon={PenLine} title="Written English round"
      subtitle="Practise the email or essay task in entry-level online tests: write to a brief against the clock, check the form instantly, then get an AI review of content, language and tone." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card className="space-y-4">
          <div role="radiogroup" aria-label="Task" className="flex flex-wrap gap-2">
            {(["email", "essay"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => switchKind(k)}
              className={cx("min-h-10 rounded-lg px-3 text-sm font-medium ring-1", kind === k ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>
              {k === "email" ? "Email" : "Essay"}</button>)}
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Brief</span>
            <select value={brief.id} onChange={(e) => choose(BRIEFS.find((b) => b.id === e.target.value)!)}
              className={cx("block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-white/15 dark:bg-zinc-900", focusRing)}>
              {BRIEFS.filter((b) => b.kind === kind).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </label>
          <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed dark:border-white/10 dark:bg-white/[0.03]">
            {brief.text}
            <span className="mt-2 block text-zinc-600 dark:text-zinc-400">{brief.range[0]} to {brief.range[1]} words · {brief.minutes} minutes</span>
          </blockquote>
          {startedAt === null ? <Button onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}><Clock className="h-4 w-4" aria-hidden /> Start the clock</Button>
            : <p role="timer" aria-live="off" className={cx("text-sm font-medium tabular-nums", left <= 60 ? "text-rose-700 dark:text-rose-300" : "")}>
              <Clock className="mr-1 inline h-4 w-4" aria-hidden /> {left > 0 ? `${mmss(left)} left` : "Time's up. Finish your sentence and submit."}</p>}
        </Card>

        {startedAt !== null && <Card className="space-y-3">
          {brief.kind === "email" && <label className="block space-y-1.5 text-sm"><span className="font-medium">Subject</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={Boolean(review)} maxLength={120} placeholder="What the email is about, in a few words" /></label>}
          <label htmlFor="written-text" className="block text-sm font-medium">{brief.kind === "email" ? "Email" : "Essay"}</label>
          <Textarea id="written-text" rows={14} value={text} onChange={(e) => setText(e.target.value)} readOnly={Boolean(review)} spellCheck={false}
            placeholder={brief.kind === "email" ? "Dear Sir or Madam,\n\n…\n\nRegards,\nYour name" : "Introduction…\n\nFirst reason…\n\nConclusion…"} />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{n} words. Spell-check is off, as in most test platforms.</p>
          <div className="flex flex-wrap gap-2">
            {!review ? <Button loading={busy} disabled={n < 20} onClick={() => void submit()}><Sparkles className="h-4 w-4" aria-hidden /> Submit for review</Button>
              : <Button variant="secondary" onClick={() => choose(brief)}><RotateCcw className="h-4 w-4" aria-hidden /> Try this brief again</Button>}
          </div>
          <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
        </Card>}

        {review && <Card className="space-y-4">
          <div aria-live="polite"><h2 className="text-lg font-semibold">Score: {review.total} / 20</h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{review.summary}</p></div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{SCORE_LABELS.map(([k, label]) =>
            <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt><dd className="text-lg font-semibold tabular-nums">{review.scores[k]} / 5</dd></div>)}</dl>
          {(review.covered.length > 0 || review.missed.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
            {review.covered.length > 0 && <div><h3 className="text-sm font-semibold">Covered</h3><ul className="mt-1 space-y-1 text-sm">{review.covered.map((c) => <li key={c} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{c}</li>)}</ul></div>}
            {review.missed.length > 0 && <div><h3 className="text-sm font-semibold">Missing</h3><ul className="mt-1 space-y-1 text-sm">{review.missed.map((c) => <li key={c} className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />{c}</li>)}</ul></div>}
          </div>}
          {review.fixes.length > 0 && <div><h3 className="text-sm font-semibold">Fix these lines</h3>
            <ul className="mt-2 space-y-2">{review.fixes.map((f) => <li key={f.quote} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
              <p><span className="text-zinc-600 dark:text-zinc-400">You wrote:</span> <del className="decoration-rose-500/60">{f.quote}</del></p>
              <p><span className="text-zinc-600 dark:text-zinc-400">Better:</span> <ins className="no-underline font-medium text-emerald-800 dark:text-emerald-300">{f.better}</ins></p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{f.issue}</p></li>)}</ul></div>}
          {review.strengths.length > 0 && <p className="text-sm"><span className="font-semibold">Done well:</span> {review.strengths.join(" ")}</p>}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">An AI review in the style of these tests' marking, not any employer's actual score.</p>
        </Card>}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">Form checks</h2>
          {startedAt === null ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Start the clock to write. These update as you type.</p>
            : <ul className="space-y-2 text-sm">{checks.map((c) => <li key={c.label} className="flex gap-2">
              {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
              <span><span className="font-medium">{c.label}{c.ok ? "" : " (to fix)"}.</span> <span className="text-zinc-600 dark:text-zinc-400">{c.detail}</span></span></li>)}</ul>}
        </Card>
        <Card className="space-y-2">
          <h2 className="font-semibold">The brief asks for</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">{brief.points.map((p) => <li key={p}>{p}</li>)}</ul>
        </Card>
        {history.length > 0 && <Card className="space-y-2">
          <h2 className="font-semibold">Your last answers</h2>
          <ul className="space-y-1 text-sm">{history.slice(0, 5).map((h) =>
            <li key={h.at} className="flex justify-between gap-3"><span className="text-zinc-600 dark:text-zinc-400">{new Date(h.at).toLocaleDateString()}</span><span className="tabular-nums font-medium">{h.score}%</span></li>)}</ul>
        </Card>}
      </aside>
    </div>
  </div>;
}
