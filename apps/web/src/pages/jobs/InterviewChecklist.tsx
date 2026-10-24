import { useState } from "react";
import { ClipboardCheck, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";

/**
 * Interview-day checklist for one job: the logistics that go wrong on the day (time zone, link, camera, documents,
 * questions to ask, the thank-you after), the kind of run-sheet recruiters and career centres hand out. Ticks stay
 * on this device, per job. Nothing is sent.
 */

export const CHECKLIST = [
  { id: "time", group: "The day before", text: "Confirm the date, time and time zone with the recruiter" },
  { id: "format", group: "The day before", text: "Know the format: who you'll meet, how long, and what kind of round" },
  { id: "link", group: "The day before", text: "Open the video link or plan the route, with 15 minutes spare" },
  { id: "research", group: "The day before", text: "Read the company's latest news and the interviewers' profiles" },
  { id: "stories", group: "The day before", text: "Pick three stories that match the job's top requirements" },
  { id: "questions", group: "The day before", text: "Write two or three questions to ask them" },
  { id: "tech", group: "On the day", text: "Test camera, microphone and internet; close other apps" },
  { id: "docs", group: "On the day", text: "Keep your resume, the job post and ID or documents to hand" },
  { id: "space", group: "On the day", text: "Quiet room, good light, phone on silent" },
  { id: "notes", group: "Right after", text: "Write down the questions asked and anything you promised to send" },
  { id: "thanks", group: "Right after", text: "Send a short thank-you note the same day" },
] as const;

const key = (entryId: string) => `orbit.interview-checklist.${entryId}`;
const isTicks = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function InterviewChecklist({ entryId }: { entryId: string }) {
  const [ticked, setTicked] = useState<string[]>(() => readJSON(safeLocal, key(entryId), [], isTicks));
  const toggle = (id: string) => {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
    setTicked(next); safeLocal.setItem(key(entryId), JSON.stringify(next));
  };
  const groups = [...new Set(CHECKLIST.map((c) => c.group))];
  const done = CHECKLIST.filter((c) => ticked.includes(c.id)).length;
  return <section aria-labelledby={`checklist-${entryId}`} className="workspace-panel space-y-4 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h3 id={`checklist-${entryId}`} className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-indigo-600" aria-hidden />Interview-day checklist</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">The things that go wrong on the day, ticked off in advance. Saved on this device.</p></div>
      <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums dark:bg-white/10">{done}/{CHECKLIST.length}</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden><div className="h-full rounded-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-page" style={{ width: `${(done / CHECKLIST.length) * 100}%` }} /></div>
    {groups.map((g) => <div key={g}><p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{g}</p>
      <ul className="mt-2 space-y-1">{CHECKLIST.filter((c) => c.group === g).map((c) => {
        const on = ticked.includes(c.id);
        return <li key={c.id}><label className={cx("flex min-h-10 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-white/5", on && "text-zinc-500 line-through")}>
          <input type="checkbox" className={cx("mt-0.5", focusRing)} checked={on} onChange={() => toggle(c.id)} />{c.text}</label></li>;
      })}</ul></div>)}
  </section>;
}
