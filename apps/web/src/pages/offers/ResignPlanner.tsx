import { useState } from "react";
import { LogOut, cx, focusRing, isIndia, readJSON, safeLocal } from "@orbit/ui";
import { Card, Field, Input, Select } from "../../components/ui";
import { useCountry } from "../../lib/country";
import { CopyBlock } from "../kit/CopyBlock";
import { exitChecklist, gapDays, lastDay, letter } from "./notice";

const KEY = "orbit.resign-planner";
interface Saved { resignOn: string; amount: number; unit: "days" | "months"; joinOn: string; manager: string; role: string; company: string; name: string; done: string[] }
const EMPTY: Saved = { resignOn: "", amount: 30, unit: "days", joinOn: "", manager: "", role: "", company: "", name: "", done: [] };
const isSaved = (v: unknown): v is Saved => typeof v === "object" && v !== null && "resignOn" in v && "done" in v;
const pretty = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/**
 * Offers → "Resign well" (notice.ts): last working day from the notice period, the clash with the joining date, a
 * resignation letter and the exit checklist (India's relieving letter, PF and Form 16 included there).
 */
export function ResignPlanner() {
  const india = isIndia(useCountry());
  const [s, setS] = useState<Saved>(() => ({ ...EMPTY, ...readJSON(safeLocal, KEY, EMPTY, isSaved) }));
  const update = (patch: Partial<Saved>) => { const next = { ...s, ...patch }; setS(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const last = lastDay(s);
  const gap = gapDays(last, s.joinOn);
  const list = exitChecklist(india);

  return <Card>
    <h2 className="flex items-center gap-3 font-display text-lg font-semibold"><LogOut className="h-5 w-5 text-indigo-600" aria-hidden /> Resign well</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Accepted an offer? Work out your last day, check it against your joining date, and leave on good terms. Your contract's notice terms are what count.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Resigning on" htmlFor="rp-on"><Input id="rp-on" type="date" value={s.resignOn} onChange={(e) => update({ resignOn: e.target.value })} /></Field>
      <Field label="Notice period" htmlFor="rp-n"><div className="flex gap-2">
        <Input id="rp-n" type="number" min={1} max={365} value={s.amount} onChange={(e) => update({ amount: Number(e.target.value) })} className="w-20" />
        <Select aria-label="Notice unit" value={s.unit} onChange={(e) => update({ unit: e.target.value as Saved["unit"] })}><option value="days">days</option><option value="months">months</option></Select></div></Field>
      <Field label="New job starts" htmlFor="rp-join"><Input id="rp-join" type="date" value={s.joinOn} onChange={(e) => update({ joinOn: e.target.value })} /></Field>
      <div className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5" aria-live="polite">
        <p className="text-xs text-zinc-500">Last working day</p>
        <p className="font-semibold">{last ? pretty(last) : "Pick a date"}</p>
        {gap !== null && <p className={cx("mt-0.5 text-xs font-medium", gap < 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300")}>
          {gap < 0 ? `Joining is ${-gap} ${-gap === 1 ? "day" : "days"} too early: ask for an early release${india ? " or a notice buyout" : ""}, or a later joining date` : gap === 0 ? "You join the next day" : `${gap} ${gap === 1 ? "day" : "days"} off between jobs`}</p>}
      </div>
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Manager's name" htmlFor="rp-m"><Input id="rp-m" value={s.manager} onChange={(e) => update({ manager: e.target.value })} /></Field>
          <Field label="Your name" htmlFor="rp-name"><Input id="rp-name" value={s.name} onChange={(e) => update({ name: e.target.value })} /></Field>
          <Field label="Your role" htmlFor="rp-r"><Input id="rp-r" value={s.role} onChange={(e) => update({ role: e.target.value })} /></Field>
          <Field label="Company" htmlFor="rp-c"><Input id="rp-c" value={s.company} onChange={(e) => update({ company: e.target.value })} /></Field>
        </div>
        <CopyBlock label="Resignation letter" hint="Send it after you've told your manager in person or on a call" text={letter({ ...s, last })} />
      </div>
      <fieldset><legend className="text-sm font-semibold">Exit checklist <span className="font-normal text-zinc-500">({s.done.filter((d) => list.includes(d)).length}/{list.length})</span></legend>
        <ul className="mt-2 space-y-1">{list.map((item) => { const on = s.done.includes(item); return <li key={item}>
          <label className={cx("flex min-h-10 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-white/5", on && "text-zinc-500 line-through")}>
            <input type="checkbox" className={cx("mt-0.5", focusRing)} checked={on} onChange={() => update({ done: on ? s.done.filter((d) => d !== item) : [...s.done, item] })} />{item}</label></li>; })}</ul>
      </fieldset>
    </div>
  </Card>;
}
