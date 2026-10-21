import { useState } from "react";
import { MessagesSquare, isIndia, readJSON, safeLocal } from "@orbit/ui";
import { Card, Field, Input } from "../../components/ui";
import { useCountry } from "../../lib/country";
import { CopyBlock } from "../kit/CopyBlock";
import { scripts, type ScriptInput } from "./salaryScripts";

const KEY = "orbit.salary-scripts";
type Saved = Omit<ScriptInput, "india">;
const EMPTY: Saved = { low: "", high: "", current: "", notice: "", role: "", city: "" };
const isSaved = (v: unknown): v is Saved => typeof v === "object" && v !== null && "low" in v;

/**
 * Offers → "What to say about pay" (salaryScripts.ts): the recruiter-screen questions about money, answered from the
 * candidate's own researched range. Typed values stay on this device.
 */
export function SalaryScripts() {
  const india = isIndia(useCountry());
  const [s, setS] = useState<Saved>(() => readJSON(safeLocal, KEY, EMPTY, isSaved));
  const set = (k: keyof Saved, v: string) => { const next = { ...s, [k]: v }; setS(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const field = (k: keyof Saved, label: string, placeholder: string) => <Field label={label} htmlFor={`ss-${k}`}>
    <Input id={`ss-${k}`} value={s[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} /></Field>;

  return <Card>
    <h2 className="flex items-center gap-3 font-display text-lg font-semibold"><MessagesSquare className="h-5 w-5 text-indigo-600" aria-hidden /> What to say about pay</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Before there's an offer, recruiters ask about money on the first call. Fill in your own researched numbers and get the words ready.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {field("role", "Role", "Software engineer")}
      {field("city", "City", india ? "Bengaluru" : "London")}
      {field("notice", "Notice period", india ? "60 days" : "4 weeks")}
      {field("low", "Range: the bottom you'd happily accept", india ? "₹14 LPA" : "£55,000")}
      {field("high", "Range: the top", india ? "₹18 LPA" : "£65,000")}
      {india && field("current", "Current CTC", "₹11 LPA")}
    </div>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{scripts({ ...s, india }).map((x) => <CopyBlock key={x.q} label={x.q} hint={x.when} text={x.say} />)}</div>
    <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">Research your range first: the market bar on each offer, salary sites and people in the role. Orbit never suggests a number for you.</p>
  </Card>;
}
