import { SpotArt } from "../../components/SpotArt";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, Plus, Reveal, Target, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Button, Card, Input, PageHeader, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { ACTIONS, KINDS, nextStep, readiness, trend, type EvidenceKind, type SkillRecord } from "./readiness";

const KEY = "orbit.readiness";
const isRecords = (v: unknown): v is SkillRecord[] => Array.isArray(v) && v.every((r) => typeof r === "object" && r !== null && "skill" in r && "evidence" in r);
interface Demand { skill: string; jobs: number }
interface Gaps { jobs: number; missing: Demand[]; shown: Demand[] }

const TONE = (v: number | null) => v === null ? "bg-zinc-300 dark:bg-white/20" : v >= 4 ? "bg-emerald-500" : v >= 2.5 ? "bg-amber-500" : "bg-rose-500";

/**
 * Prepare → Skill readiness (readiness.ts): the skills your saved jobs ask for (GET /v1/jobs/skill-gaps) plus your own,
 * each with a readiness from the evidence you log, and a plan that brings weak, in-demand skills back first.
 * Evidence stays on this device.
 */
export function ReadinessPage() {
  const [records, setRecords] = useState<SkillRecord[]>(() => readJSON(safeLocal, KEY, [], isRecords));
  const save = (next: SkillRecord[]) => { setRecords(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const gaps = useAsync(() => api.call<Gaps>("/v1/jobs/skill-gaps"), [], "skill-gaps|0");
  const [newSkill, setNewSkill] = useState("");
  const [log, setLog] = useState<{ skill: string; score: number; kind: EvidenceKind; note: string }>({ skill: "", score: 3, kind: "practice", note: "" });

  const demand = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of [...(gaps.data?.missing ?? []), ...(gaps.data?.shown ?? [])]) m.set(d.skill.toLowerCase(), d.jobs);
    return m;
  }, [gaps.data]);
  const skills = useMemo(() => {
    const names = new Map<string, string>();
    for (const d of [...(gaps.data?.missing ?? []), ...(gaps.data?.shown ?? [])]) names.set(d.skill.toLowerCase(), d.skill);
    for (const r of records) names.set(r.skill.toLowerCase(), r.skill);
    const max = Math.max(0, ...demand.values());
    return [...names.entries()].map(([key, skill]) => {
      const ev = records.find((r) => r.skill.toLowerCase() === key)?.evidence ?? [];
      const { value, confidence } = readiness(ev);
      const jobs = demand.get(key) ?? 0;
      return { skill, jobs, evidence: ev, value, confidence, change: trend(ev), ...nextStep(value, confidence, jobs, max) };
    }).sort((a, b) => b.priority - a.priority);
  }, [records, demand, gaps.data]);

  const add = () => {
    const s = newSkill.trim();
    if (!s || records.some((r) => r.skill.toLowerCase() === s.toLowerCase())) { setNewSkill(""); return; }
    save([...records, { skill: s, evidence: [] }]); setNewSkill("");
  };
  const logIt = () => {
    const skill = log.skill || skills[0]?.skill;
    if (!skill) return;
    const entry = { at: new Date().toISOString(), score: log.score, kind: log.kind, note: log.note.trim().slice(0, 200) };
    const found = records.find((r) => r.skill.toLowerCase() === skill.toLowerCase());
    save(found ? records.map((r) => r === found ? { ...r, evidence: [entry, ...r.evidence].slice(0, 30) } : r) : [...records, { skill, evidence: [entry] }]);
    setLog({ ...log, note: "" });
  };
  const ready = skills.filter((s) => s.value !== null && s.value >= 4).length;
  const plan = skills.slice(0, 5);

  return <div>
    <PageHeader art={<SpotArt kind="practice" />} eyebrow="Interview preparation" icon={Gauge} title="Skill readiness"
      subtitle="Every skill your target jobs ask for, how ready you are from the evidence you log, and what to work on next." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-6">
        {plan.length > 0 && <section aria-labelledby="plan">
          <h2 id="plan" className="font-display text-lg font-semibold">Next up</h2>
          <Reveal as="ol" stagger className="mt-3 grid gap-3 sm:grid-cols-2">{plan.map((s, i) => <li key={s.skill} className="workspace-panel flex flex-col gap-2 p-4">
            <p className="flex items-center justify-between gap-2"><span className="font-semibold">{i + 1}. {s.skill}</span>{s.jobs > 0 && <span className="text-xs text-zinc-500">{s.jobs} {s.jobs === 1 ? "job asks" : "jobs ask"}</span>}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{ACTIONS[s.action].label}</p>
            <Link to={ACTIONS[s.action].to} className={cx("mt-auto self-start rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>{ACTIONS[s.action].cta}</Link>
          </li>)}</Reveal>
        </section>}
        <section aria-labelledby="all-skills">
          <h2 id="all-skills" className="font-display text-lg font-semibold">All skills ({skills.length}) · {ready} ready</h2>
          {skills.length ? <ul className="mt-3 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">{skills.map((s) => <li key={s.skill} className="grid items-center gap-3 p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_7rem]">
            <span className="min-w-0"><span className="block truncate font-medium">{s.skill}</span><span className="text-xs text-zinc-500">{s.evidence.length} {s.evidence.length === 1 ? "entry" : "entries"}{s.jobs ? ` · ${s.jobs} jobs` : ""}</span></span>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden><div className={cx("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", TONE(s.value))} style={{ width: `${((s.value ?? 0) / 5) * 100}%`, opacity: 0.45 + 0.55 * s.confidence }} /></div>
            <span className="text-right text-sm tabular-nums">{s.value === null ? <span className="text-zinc-500">not rated</span> : <>{s.value.toFixed(1)}/5{s.change !== null && s.change !== 0 && <span className={cx("ml-1 text-xs", s.change > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{s.change > 0 ? "+" : ""}{s.change}</span>}</>}</span>
          </li>)}</ul> : <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Save a few jobs to see the skills they ask for, or add your own skills on the right.</p>}
        </section>
      </div>
      <aside className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">Log evidence</h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">After a practice answer, a self-check or a real interview, rate how it went for one skill.</p>
          <Select aria-label="Skill" className="w-full" value={log.skill || skills[0]?.skill || ""} onChange={(e) => setLog({ ...log, skill: e.target.value })}>
            {skills.map((s) => <option key={s.skill}>{s.skill}</option>)}</Select>
          <Select aria-label="Kind of evidence" className="w-full" value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value as EvidenceKind })}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>
          <div role="radiogroup" aria-label="How it went (1 to 5)" className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={log.score === n} onClick={() => setLog({ ...log, score: n })}
            className={cx("h-9 flex-1 rounded-md text-sm font-semibold ring-1", log.score === n ? "bg-indigo-600 text-white ring-indigo-600" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>{n}</button>)}</div>
          <Input aria-label="Note (optional)" placeholder="Couldn't explain caching trade-offs clearly" value={log.note} onChange={(e) => setLog({ ...log, note: e.target.value })} />
          <Button className="w-full" disabled={!skills.length} onClick={logIt}><Target className="h-4 w-4" aria-hidden /> Log it</Button>
        </Card>
        <Card className="space-y-2">
          <h2 className="font-semibold">Add a skill</h2>
          <div className="flex gap-2"><Input aria-label="Skill name" placeholder="System design" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button variant="secondary" onClick={add} aria-label="Add skill"><Plus className="h-4 w-4" aria-hidden /></Button></div>
        </Card>
        <p className="px-1 text-xs text-zinc-600 dark:text-zinc-400">Real interviews count most, self-checks least, and evidence halves in weight every 30 days, so old practice fades. A faint bar means little or old evidence.</p>
      </aside>
    </div>
  </div>;
}
