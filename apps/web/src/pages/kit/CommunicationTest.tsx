import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Headphones, Mic, Play, RotateCcw, Square, cx } from "@orbit/ui";
import { Button, Card, PageHeader, Textarea } from "../../components/ui";
import { SpotArt } from "../../components/SpotArt";
import { useDictation } from "../../lib/dictation";
import { useToolLocal } from "../../lib/useToolLocal";
import { NO_SCORE_HISTORY, validScoreHistory } from "./practiceHistory";
import { SECTIONS, band, newRound, roundScore, scoreItem, type ItemResult, type RoundItem } from "./communication";

const TONE = { good: "bg-emerald-500", ok: "bg-amber-500", improve: "bg-rose-500" } as const;
const sectionOf = (id: RoundItem["section"]) => SECTIONS.find((s) => s.id === id)!;

function speak(text: string, onEnd: () => void): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  u.rate = 0.95;
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
  return true;
}

function Bar({ score, label }: { score: number; label: string }) {
  const b = band(score);
  return <div className="space-y-1">
    <div className="flex items-baseline justify-between gap-3 text-sm"><span>{label}</span><span className="tabular-nums font-medium">{score}<span className="text-zinc-500"> / 100</span></span></div>
    <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10" role="img" aria-label={`${label}: ${score} out of 100, ${b.label.toLowerCase()}`}>
      <div className={cx("h-full rounded-full", TONE[b.tone])} style={{ width: `${Math.max(2, score)}%` }} />
    </div>
  </div>;
}

/**
 * Prepare → Communication test practice (pages/kit/communication.ts): the spoken English round many employers run
 * before an interview. Eight items across read aloud, repeat, sentence builds, story retelling and an open question,
 * spoken into the browser's speech-to-text (or typed), each scored on the spot. Nothing leaves the browser.
 */
export function CommunicationTestPage() {
  const [round, setRound] = useState<RoundItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<ItemResult[]>([]);
  const [checked, setChecked] = useState<ItemResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const [history, setHistory] = useToolLocal("communication", NO_SCORE_HISTORY, validScoreHistory);
  const startedAt = useRef<number | null>(null);
  const dictation = useDictation(answer, (text) => { if (startedAt.current === null) startedAt.current = Date.now(); setAnswer(text); });
  const canListen = typeof window !== "undefined" && "speechSynthesis" in window;
  const item = round?.[index];
  const section = item ? sectionOf(item.section) : null;
  const done = round !== null && index >= round.length;
  const summary = useMemo(() => roundScore(results), [results]);

  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  const begin = () => { setRound(newRound()); setIndex(0); setResults([]); reset(); };
  const reset = () => { setAnswer(""); setChecked(null); setPlayed(0); startedAt.current = null; };
  const play = () => {
    if (!item) return;
    setPlaying(true);
    if (!speak(item.prompt, () => setPlaying(false))) setPlaying(false);
    setPlayed((n) => n + 1);
  };
  const check = () => {
    if (!item) return;
    dictation.stop();
    const seconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    const r = scoreItem(item.section, item.prompt, answer, seconds, item.story);
    setChecked(r);
  };
  const next = () => {
    if (!checked || !round) return;
    const all = [...results, checked];
    setResults(all);
    setIndex(index + 1);
    reset();
    if (index + 1 >= round.length) setHistory([{ at: new Date().toISOString(), score: roundScore(all).overall }, ...history].slice(0, 10));
  };

  const hidden = section?.listen && !checked;
  return <div>
    <PageHeader art={<SpotArt kind="practice" />} eyebrow="Interview preparation" icon={Headphones} title="Communication test practice"
      subtitle="The spoken English round many employers and BPOs run before an interview: read aloud, repeat, sentence builds, story retelling and an open question, scored as you go." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {!round && <Card className="space-y-4">
          <h2 className="font-semibold">Eight items, about five minutes</h2>
          <ol className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {SECTIONS.map((s, i) => <li key={s.id} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-semibold dark:bg-white/10">{i + 1}</span><span><strong className="font-medium text-zinc-900 dark:text-white">{s.name}.</strong> {s.how}</span></li>)}
          </ol>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {dictation.supported ? "Use a quiet room and allow the microphone when asked. Your voice is turned into text by your browser; nothing is recorded or saved." : "This browser can't turn speech into text, so type what you would say. Chrome or Edge on a computer or Android works best for speaking."}
          </p>
          <Button onClick={begin}><Play className="h-4 w-4" aria-hidden /> Start practice</Button>
        </Card>}

        {item && section && <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{section.name}</span>
            <span className="text-zinc-600 dark:text-zinc-400">Item {index + 1} of {round!.length}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10" aria-hidden="true"><div className="h-full bg-indigo-500" style={{ width: `${(index / round!.length) * 100}%` }} /></div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{section.how}</p>

          {section.listen && <div className="flex flex-wrap items-center gap-3">
            {canListen ? <Button variant={played ? "secondary" : "primary"} loading={playing} onClick={play}><Headphones className="h-4 w-4" aria-hidden /> {played ? "Play again" : "Play"}</Button>
              : <p className="text-sm text-zinc-600 dark:text-zinc-400">This browser can't read text aloud. Read the text below once, cover it, then answer.</p>}
            {played > 1 && <span className="text-xs text-zinc-600 dark:text-zinc-400">The real test plays it once.</span>}
          </div>}
          {(!hidden || !canListen) && item.section !== "build" && item.section !== "retell" &&
            <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-lg leading-relaxed dark:border-white/10 dark:bg-white/[0.03]">{item.prompt}</blockquote>}
          {item.section === "retell" && (checked || !canListen) &&
            <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed dark:border-white/10 dark:bg-white/[0.03]">{item.prompt}</blockquote>}
          {item.section === "build" && <ul aria-label="Jumbled phrases" className="flex flex-wrap gap-2">
            {item.parts!.map((p) => <li key={p} className="rounded-lg bg-indigo-500/10 px-3 py-2 text-base text-indigo-900 ring-1 ring-indigo-500/25 dark:text-indigo-100">{p}</li>)}
          </ul>}

          <div className="space-y-2">
            <label htmlFor="comm-answer" className="block text-sm font-medium">Your answer</label>
            <Textarea id="comm-answer" rows={item.section === "retell" || item.section === "open" ? 5 : 2} value={answer} readOnly={dictation.listening || Boolean(checked)}
              onChange={(e) => { if (startedAt.current === null) startedAt.current = Date.now(); setAnswer(e.target.value); }}
              placeholder={dictation.supported ? "Press Speak and say it, or type it here" : "Type what you would say"} />
            <div className="flex flex-wrap items-center gap-2">
              {dictation.supported && !checked && <Button variant={dictation.listening ? "primary" : "secondary"} aria-pressed={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start}>
                {dictation.listening ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />} {dictation.listening ? "Stop" : "Speak"}</Button>}
              {!checked ? <Button onClick={check} disabled={!answer.trim() || (section.listen && canListen && !played)}><Check className="h-4 w-4" aria-hidden /> Check</Button>
                : <Button onClick={next}>{index + 1 >= round!.length ? "See my score" : "Next item"}</Button>}
              {dictation.listening && <span role="status" className="text-sm text-rose-700 dark:text-rose-300">Listening…</span>}
            </div>
            {dictation.error && <p className="text-sm text-rose-700 dark:text-rose-300">{dictation.error}</p>}
          </div>

          <div aria-live="polite">{checked && <div className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-white/10">
            <Bar score={checked.score} label="This item" />
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{checked.note}</p>
          </div>}</div>
        </Card>}

        {done && <Card className="space-y-4">
          <div aria-live="polite" className="space-y-1">
            <h2 className="text-lg font-semibold">Your score: {summary.overall} / 100 · {band(summary.overall).label}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Scored from what speech-to-text heard, so it's a guide, not the real test's score. Practise the lowest section first.</p>
          </div>
          <div className="space-y-3">{summary.bySection.map((s) => <Bar key={s.id} score={s.score} label={s.name} />)}</div>
          <ul className="space-y-2 text-sm">{results.filter((r) => r.score < 80).slice(0, 4).map((r, i) =>
            <li key={i} className="flex gap-2"><span className="font-medium">{sectionOf(r.section).name}:</span><span className="text-zinc-700 dark:text-zinc-300">{r.note}</span></li>)}</ul>
          <Button onClick={begin}><RotateCcw className="h-4 w-4" aria-hidden /> Practise again</Button>
        </Card>}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">What these tests look for</h2>
          <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            <li>Every word, in order, when you read or repeat.</li>
            <li>A steady pace: about 120 to 150 words a minute.</li>
            <li>Few fillers. A short pause is better than "um".</li>
            <li>In a retelling: who, what happened and how it ended.</li>
            <li>In an open answer: a point, a reason and an example.</li>
          </ul>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Formats differ by employer and test provider. These are Orbit's own practice items in the same style.</p>
        </Card>
        {history.length > 0 && <Card className="space-y-2">
          <h2 className="font-semibold">Your last rounds</h2>
          <ul className="space-y-1 text-sm">{history.slice(0, 5).map((h) =>
            <li key={h.at} className="flex justify-between gap-3"><span className="text-zinc-600 dark:text-zinc-400">{new Date(h.at).toLocaleDateString()}</span><span className="tabular-nums font-medium">{h.score} / 100</span></li>)}</ul>
        </Card>}
      </aside>
    </div>
  </div>;
}
