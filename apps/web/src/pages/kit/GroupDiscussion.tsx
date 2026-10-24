import { SpotArt } from "../../components/SpotArt";
import { useEffect, useState } from "react";
import { Check, Clock, RotateCcw, UsersRound, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Button, Card, PageHeader, Textarea } from "../../components/ui";
import { PREP_SECONDS, REVIEW, STRUCTURE, TALK_SECONDS, TOPICS, pickTopic, type Topic } from "./groupDiscussion";

type Phase = "pick" | "prep" | "talk" | "review";
const KINDS = [{ id: "any", label: "Any" }, { id: "current", label: "Current affairs" }, { id: "business", label: "Business & work" }, { id: "abstract", label: "Abstract" }] as const;
const HISTORY = "orbit.gd.history";
interface Done { at: string; topic: string; ticks: number }
const isDone = (v: unknown): v is Done[] => Array.isArray(v);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Prepare → Group discussion (pages/kit/groupDiscussion.ts): a topic, two minutes to plan, five to speak (alone, or
 * with friends on a call), then a self-review against what evaluators look for and both sides' points to compare.
 */
export function GroupDiscussionPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("any");
  const [topic, setTopic] = useState<Topic>(() => pickTopic("any", null));
  const [phase, setPhase] = useState<Phase>("pick");
  const [left, setLeft] = useState(0);
  const [notes, setNotes] = useState("");
  const [ticks, setTicks] = useState<string[]>([]);
  const [history, setHistory] = useState<Done[]>(() => readJSON(safeLocal, HISTORY, [], isDone).slice(0, 8));

  useEffect(() => {
    if (phase !== "prep" && phase !== "talk") return;
    if (left <= 0) { if (phase === "prep") { setPhase("talk"); setLeft(TALK_SECONDS); } else setPhase("review"); return; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, left]);

  const start = () => { setNotes(""); setTicks([]); setPhase("prep"); setLeft(PREP_SECONDS); };
  const another = () => { setTopic(pickTopic(kind, topic.id)); setPhase("pick"); };
  const finish = () => {
    const next = [{ at: new Date().toISOString(), topic: topic.title, ticks: ticks.length }, ...history].slice(0, 8);
    setHistory(next); safeLocal.setItem(HISTORY, JSON.stringify(next)); another();
  };

  return <div>
    <PageHeader art={<SpotArt kind="practice" />} eyebrow="Interview preparation" icon={UsersRound} title="Group discussion practice"
      subtitle="The GD round in campus placements and admissions: a topic, two minutes to plan, five to speak, then review what evaluators look for." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card className="space-y-4">
          {phase === "pick" && <div role="radiogroup" aria-label="Kind of topic" className="flex flex-wrap gap-2">{KINDS.map((k) =>
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => { setKind(k.id); setTopic(pickTopic(k.id, topic.id)); }}
              className={cx("min-h-10 rounded-lg px-3 text-sm font-medium ring-1", kind === k.id ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>{k.label}</button>)}</div>}
          <div key={topic.id} className="motion-safe:animate-fade-up">
            <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{KINDS.find((k) => k.id === topic.kind)?.label} topic</p>
            <h2 className="mt-1 font-display text-2xl font-semibold leading-snug">{topic.title}</h2>
          </div>
          {phase === "pick" && <div className="flex flex-wrap gap-2"><Button onClick={start}><Clock className="h-4 w-4" aria-hidden /> Start: 2 minutes to plan</Button>
            <Button variant="secondary" onClick={another}><RotateCcw className="h-4 w-4" aria-hidden /> Another topic</Button></div>}
          {(phase === "prep" || phase === "talk") && <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{phase === "prep" ? "Plan your points" : "Speak now: open, add value, include others, summarise"}</p>
              <span className={cx("inline-flex items-center gap-1 font-display text-2xl font-semibold tabular-nums", left < 30 && "text-rose-700 dark:text-rose-300")} role="timer" aria-live={left < 30 ? "polite" : "off"}><Clock className="h-5 w-5" aria-hidden />{mmss(left)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden><div className={cx("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-moment motion-safe:ease-linear", phase === "prep" ? "bg-indigo-500" : "bg-emerald-500")} style={{ width: `${(left / (phase === "prep" ? PREP_SECONDS : TALK_SECONDS)) * 100}%` }} /></div>
            <Textarea aria-label="Your notes" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={"Opening line…\nPoint 1 + example…\nPoint 2 + example…\nThe other side…"} />
            <Button variant="secondary" onClick={() => { if (phase === "prep") { setPhase("talk"); setLeft(TALK_SECONDS); } else setPhase("review"); }}>{phase === "prep" ? "I'm ready to speak" : "Done speaking"}</Button>
          </>}
          {phase === "review" && <div className="space-y-4">
            <fieldset><legend className="text-sm font-semibold">How did it go?</legend>
              <ul className="mt-2 space-y-1">{REVIEW.map((r) => { const on = ticks.includes(r); return <li key={r}><label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-zinc-50 dark:hover:bg-white/5">
                <input type="checkbox" className={focusRing} checked={on} onChange={() => setTicks((t) => on ? t.filter((x) => x !== r) : [...t, r])} />{r}</label></li>; })}</ul></fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-emerald-500/10 p-3"><p className="text-sm font-semibold">{topic.kind === "abstract" ? "Angles" : "For"}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{topic.for.map((p) => <li key={p}>{p}</li>)}</ul></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><p className="text-sm font-semibold">{topic.kind === "abstract" ? "More angles" : "Against"}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{topic.against.map((p) => <li key={p}>{p}</li>)}</ul></div>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Compare with your notes: did you cover both sides? Evaluators value balance and listening as much as content.</p>
            <Button onClick={finish}><Check className="h-4 w-4" aria-hidden /> Save and try another</Button>
          </div>}
        </Card>
      </div>
      <aside className="space-y-4">
        <Card>
          <h2 className="font-semibold">What evaluators look for</h2>
          <ol className="mt-3 space-y-3 text-sm">{STRUCTURE.map((s, i) => <li key={s.title} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
            <span><span className="font-medium">{s.title}.</span> <span className="text-zinc-600 dark:text-zinc-400">{s.text}</span></span></li>)}</ol>
        </Card>
        <Card>
          <h2 className="font-semibold">Recent practice</h2>
          {history.length ? <ul className="mt-2 space-y-1.5 text-sm">{history.map((h) => <li key={h.at} className="flex justify-between gap-2"><span className="min-w-0 truncate">{h.topic}</span><span className="shrink-0 tabular-nums text-zinc-500">{h.ticks}/{REVIEW.length}</span></li>)}</ul>
            : <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{TOPICS.length} topics to practise. Your sessions appear here, on this device only.</p>}
        </Card>
      </aside>
    </div>
  </div>;
}
