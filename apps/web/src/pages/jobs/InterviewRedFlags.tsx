import { useState } from "react";
import { ShieldCheck, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";

/**
 * Employer red flags after an interview (career-ops' interview-redflag step): the warning signs candidates and
 * recruiters most often name, ticked per job while the round is fresh. Ticks stay on this device; nothing is sent.
 * A tick is a prompt to ask a question or look closer, not a verdict on the employer.
 */
export const RED_FLAGS = [
  { id: "vague", text: "The role, team or reporting line stayed vague after you asked" },
  { id: "turnover", text: "Several people recently left the role or the team" },
  { id: "pressure", text: "They pushed you to accept or decide unusually fast" },
  { id: "pay", text: "They wouldn't say the pay range, or it changed during the process" },
  { id: "unpaid", text: "A long unpaid take-home that looks like real client work" },
  { id: "respect", text: "Late, cancelled or distracted interviewers, without an apology" },
  { id: "hours", text: "Long hours or weekend work described as normal or expected" },
  { id: "mismatch", text: "What they described doesn't match the job post" },
  { id: "badmouth", text: "Interviewers spoke badly of colleagues, past staff or customers" },
  { id: "fees", text: "Any request for money, deposits or bank details" },
] as const;

const key = (entryId: string) => `orbit.red-flags.${entryId}`;
const isTicks = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function InterviewRedFlags({ entryId }: { entryId: string }) {
  const [ticked, setTicked] = useState<string[]>(() => readJSON(safeLocal, key(entryId), [], isTicks));
  const toggle = (id: string) => {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
    setTicked(next); safeLocal.setItem(key(entryId), JSON.stringify(next));
  };
  const n = RED_FLAGS.filter((f) => ticked.includes(f.id)).length;
  return <section aria-labelledby={`flags-${entryId}`} className="workspace-panel space-y-3 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h3 id={`flags-${entryId}`} className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-indigo-600" aria-hidden />Red flags you noticed</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Interviews go both ways. Tick what you saw while it's fresh. Saved on this device.</p></div>
      <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums", n >= 3 ? "bg-rose-500/15 text-rose-800 dark:text-rose-200" : n ? "bg-amber-500/15 text-amber-900 dark:text-amber-200" : "bg-zinc-100 dark:bg-white/10")}>{n} flagged</span>
    </div>
    <ul className="grid gap-1 sm:grid-cols-2">{RED_FLAGS.map((f) => { const on = ticked.includes(f.id); return <li key={f.id}>
      <label className={cx("flex min-h-10 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-white/5", on && "font-medium text-rose-800 dark:text-rose-200")}>
        <input type="checkbox" className={cx("mt-0.5", focusRing)} checked={on} onChange={() => toggle(f.id)} />{f.text}</label></li>; })}</ul>
    {n > 0 && <p className="text-sm text-zinc-700 dark:text-zinc-300">{n >= 3 ? "Several flags. Ask about each one directly before you accept, and talk to someone who has worked there if you can." : "Worth a direct question before you decide: how they answer tells you a lot."}</p>}
  </section>;
}
