import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarIcon, Check, CircleAlert, GraduationCap, Plus, Reveal, Trash2, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Button, Card, Field, IconButton, Input, PageHeader, Select } from "../../components/ui";
import { ROUNDS, STATUSES, daysTo, eligibility, newDrive, ordered, type Drive, type Marks, type RoundId } from "./campus";

const KEY = "orbit.campus";
interface Saved { marks: Marks; drives: Drive[] }
const EMPTY: Saved = { marks: { cgpa: null, tenth: null, twelfth: null, backlogs: null, branch: "" }, drives: [] };
const isSaved = (v: unknown): v is Saved => typeof v === "object" && v !== null && "marks" in v && Array.isArray((v as Saved).drives);
const num = (v: string) => { const n = Number(v); return v.trim() === "" || Number.isNaN(n) ? null : n; };
const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 18);

function When({ date }: { date: string }) {
  const d = daysTo(date);
  if (d === null) return <span className="text-zinc-500">No date yet</span>;
  const label = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d > 0 ? `In ${d} days` : `${-d} days ago`;
  return <span className={cx("font-medium", d >= 0 && d <= 3 ? "text-rose-700 dark:text-rose-300" : d >= 0 ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-500")}>{label}</span>;
}

function DriveForm({ drive, onSave, onCancel }: { drive: Drive; onSave: (d: Drive) => void; onCancel: () => void }) {
  const [d, setD] = useState(drive);
  const n = (k: "minCgpa" | "min10" | "min12" | "maxBacklogs", label: string, hint: string) => <Field label={label} htmlFor={`d-${k}`} hint={hint}>
    <Input id={`d-${k}`} inputMode="decimal" value={d[k] ?? ""} onChange={(e) => setD({ ...d, [k]: num(e.target.value) })} /></Field>;
  return <Card className="space-y-4 motion-safe:animate-fade-up">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Company" htmlFor="d-co"><Input id="d-co" value={d.company} onChange={(e) => setD({ ...d, company: e.target.value })} /></Field>
      <Field label="Role" htmlFor="d-role"><Input id="d-role" value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} placeholder="Graduate engineer trainee" /></Field>
      <Field label="Drive date" htmlFor="d-date"><Input id="d-date" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
      <Field label="CTC offered" htmlFor="d-ctc"><Input id="d-ctc" value={d.ctc} onChange={(e) => setD({ ...d, ctc: e.target.value })} placeholder="₹6.5 LPA" /></Field>
      {n("minCgpa", "Minimum CGPA", "Leave empty if none")}
      {n("min10", "Minimum 10th %", "")}
      {n("min12", "Minimum 12th / diploma %", "")}
      {n("maxBacklogs", "Active backlogs allowed", "0 for none")}
    </div>
    <Field label="Branches allowed" htmlFor="d-br" hint="Comma-separated, or “all”"><Input id="d-br" value={d.branches} onChange={(e) => setD({ ...d, branches: e.target.value })} placeholder="CSE, IT, ECE" /></Field>
    <fieldset><legend className="text-sm font-medium">Rounds</legend>
      <div className="mt-2 flex flex-wrap gap-2">{ROUNDS.map((r) => { const on = d.rounds.includes(r.id); return <label key={r.id} className={cx("flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ring-1", on ? "bg-indigo-50 ring-indigo-500 dark:bg-indigo-500/10" : "ring-zinc-200 dark:ring-white/10")}>
        <input type="checkbox" className={focusRing} checked={on} onChange={() => setD({ ...d, rounds: on ? d.rounds.filter((x) => x !== r.id) : ROUNDS.map((x) => x.id).filter((x) => x === r.id || d.rounds.includes(x)) })} />{r.label}</label>; })}</div></fieldset>
    <div className="flex gap-2"><Button disabled={!d.company.trim()} onClick={() => onSave(d)}>Save drive</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </Card>;
}

/**
 * Prepare → Campus placements (campus.ts): the season's drives with an eligibility check against your marks, a
 * countdown, each round's prep, and the outcome. Kept on this device.
 */
export function CampusPage() {
  const [s, setS] = useState<Saved>(() => readJSON(safeLocal, KEY, EMPTY, isSaved));
  const [editing, setEditing] = useState<Drive | null>(null);
  const save = (next: Saved) => { setS(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const setMarks = (patch: Partial<Marks>) => save({ ...s, marks: { ...s.marks, ...patch } });
  const upsert = (d: Drive) => { save({ ...s, drives: s.drives.some((x) => x.id === d.id) ? s.drives.map((x) => x.id === d.id ? d : x) : [...s.drives, d] }); setEditing(null); };
  const patch = (driveId: string, p: Partial<Drive>) => save({ ...s, drives: s.drives.map((x) => x.id === driveId ? { ...x, ...p } : x) });
  const list = ordered(s.drives);
  const eligible = s.drives.filter((d) => eligibility(d, s.marks).ok === true).length;
  const selected = s.drives.filter((d) => d.status === "selected").length;

  return <div>
    <PageHeader eyebrow="Interview preparation" icon={GraduationCap} title="Campus placements"
      subtitle="Every drive your placement cell announces: whether you're eligible, how long until it, and the prep for each round."
      actions={!editing ? <Button onClick={() => setEditing(newDrive(id()))}><Plus className="h-4 w-4" aria-hidden /> Add a drive</Button> : undefined} />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-4">
        {editing && <DriveForm key={editing.id} drive={editing} onSave={upsert} onCancel={() => setEditing(null)} />}
        {!list.length && !editing && <Card className="text-center"><p className="font-semibold">No drives yet</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Add one when your placement cell shares it: company, date, cut-offs and rounds.</p>
          <Button className="mt-4" onClick={() => setEditing(newDrive(id()))}><Plus className="h-4 w-4" aria-hidden /> Add your first drive</Button></Card>}
        <Reveal as="ul" stagger className="space-y-3">{list.map((d) => {
          const e = eligibility(d, s.marks);
          return <li key={d.id}><Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-display text-lg font-semibold">{d.company}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{[d.role, d.ctc].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm"><CalendarIcon className="h-4 w-4 text-zinc-500" aria-hidden />{d.date ? new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : ""} <When date={d.date} /></p></div>
              <div className="flex items-center gap-2">
                <Select aria-label={`Status for ${d.company}`} value={d.status} onChange={(ev) => patch(d.id, { status: ev.target.value as Drive["status"] })}>{STATUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
                <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button>
                <IconButton label={`Delete ${d.company}`} icon={Trash2} onClick={() => save({ ...s, drives: s.drives.filter((x) => x.id !== d.id) })} />
              </div>
            </div>
            <p className={cx("mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm", e.ok === true ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : e.ok === false ? "bg-rose-500/10 text-rose-800 dark:text-rose-200" : "bg-zinc-100 text-zinc-700 dark:bg-white/5 dark:text-zinc-300")}>
              {e.ok === true ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              {e.ok === true ? "You meet every cut-off entered." : e.ok === false ? e.reasons.join(". ") + ". Confirm with your placement cell before skipping." : "Add your marks on the right to check eligibility."}</p>
            {d.rounds.length > 0 && <ol className="mt-3 grid gap-2 sm:grid-cols-2">{d.rounds.map((rid: RoundId, i) => { const r = ROUNDS.find((x) => x.id === rid)!; const on = d.done.includes(rid); return <li key={rid} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-white/10">
              <input type="checkbox" aria-label={`Prepared for ${r.label}`} className={focusRing} checked={on} onChange={() => patch(d.id, { done: on ? d.done.filter((x) => x !== rid) : [...d.done, rid] })} />
              <span className={cx("min-w-0 flex-1", on && "text-zinc-500 line-through")}>{i + 1}. {r.label}</span>
              <Link to={r.to} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" title={r.prep}>Prepare</Link></li>; })}</ol>}
          </Card></li>;
        })}</Reveal>
      </div>
      <aside className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">Your marks</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CGPA" htmlFor="m-cgpa"><Input id="m-cgpa" inputMode="decimal" value={s.marks.cgpa ?? ""} onChange={(e) => setMarks({ cgpa: num(e.target.value) })} /></Field>
            <Field label="Active backlogs" htmlFor="m-bl"><Input id="m-bl" inputMode="numeric" value={s.marks.backlogs ?? ""} onChange={(e) => setMarks({ backlogs: num(e.target.value) })} /></Field>
            <Field label="10th %" htmlFor="m-10"><Input id="m-10" inputMode="decimal" value={s.marks.tenth ?? ""} onChange={(e) => setMarks({ tenth: num(e.target.value) })} /></Field>
            <Field label="12th / diploma %" htmlFor="m-12"><Input id="m-12" inputMode="decimal" value={s.marks.twelfth ?? ""} onChange={(e) => setMarks({ twelfth: num(e.target.value) })} /></Field>
          </div>
          <Field label="Branch" htmlFor="m-br"><Input id="m-br" value={s.marks.branch} onChange={(e) => setMarks({ branch: e.target.value })} placeholder="CSE" /></Field>
        </Card>
        {s.drives.length > 0 && <Card><dl className="grid grid-cols-3 gap-2 text-center">
          <div><dt className="text-xs text-zinc-500">Drives</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.drives.length}</dd></div>
          <div><dt className="text-xs text-zinc-500">Eligible</dt><dd className="font-display text-2xl font-semibold tabular-nums">{eligible}</dd></div>
          <div><dt className="text-xs text-zinc-500">Selected</dt><dd className="font-display text-2xl font-semibold tabular-nums">{selected}</dd></div></dl></Card>}
        <p className="px-1 text-xs text-zinc-600 dark:text-zinc-400">Off-campus too? Use <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/jobs/matches">Discover</Link> with the Fresher and Internship chips.</p>
      </aside>
    </div>
  </div>;
}
