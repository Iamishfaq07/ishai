import { useState } from "react";
import { Route, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Card, Field, Input, PageHeader } from "../../components/ui";
import { CopyBlock } from "./CopyBlock";
import { GAP_TIPS, REASONS, gapAnswer, gapLine, type GapInput } from "./gaps";

const KEY = "orbit.gap-explainer";
const EMPTY: GapInput = { reason: "study", from: "", to: "", during: "", role: "" };
const isGap = (v: unknown): v is GapInput => typeof v === "object" && v !== null && "reason" in v && REASONS.some((r) => r.id === (v as GapInput).reason);

/**
 * My Career → Career gap explainer (pages/kit/gaps.ts): an honest resume line and a 30-second answer for a break,
 * from the reason, dates and what the candidate did. Kept on this device.
 */
export function GapExplainerPage() {
  const [g, setG] = useState<GapInput>(() => readJSON(safeLocal, KEY, EMPTY, isGap));
  const set = (patch: Partial<GapInput>) => { const next = { ...g, ...patch }; setG(next); safeLocal.setItem(KEY, JSON.stringify(next)); };

  return <div>
    <PageHeader eyebrow="My Career" icon={Route} title="Career gap explainer"
      subtitle="A break is common. Say it briefly and honestly, then show you're ready. Here's a resume line and an answer to start from." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="space-y-4">
        <fieldset><legend className="text-sm font-semibold">Why the break?</legend>
          <div role="radiogroup" className="mt-2 grid gap-2 sm:grid-cols-2">{REASONS.map((r) => <button key={r.id} type="button" role="radio" aria-checked={g.reason === r.id} onClick={() => set({ reason: r.id })}
            className={cx("min-h-11 rounded-xl border px-3 text-left text-sm motion-safe:transition-colors", g.reason === r.id ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-500/10" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10", focusRing)}>{r.label}</button>)}</div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor="g-from"><Input id="g-from" value={g.from} onChange={(e) => set({ from: e.target.value })} placeholder="March 2024" /></Field>
          <Field label="To" htmlFor="g-to"><Input id="g-to" value={g.to} onChange={(e) => set({ to: e.target.value })} placeholder="January 2025" /></Field>
        </div>
        <Field label="What you did in that time (optional)" htmlFor="g-during" hint="Real things only: a course, certificate, project, freelance or volunteer work">
          <Input id="g-during" value={g.during} onChange={(e) => set({ during: e.target.value })} placeholder="completed the Google Data Analytics certificate" /></Field>
        <Field label="The role you're applying for (optional)" htmlFor="g-role">
          <Input id="g-role" value={g.role} onChange={(e) => set({ role: e.target.value })} placeholder="data analyst" /></Field>
      </Card>
      <div className="space-y-4">
        <CopyBlock label="Resume line" hint="Add it as an entry in your experience, in date order" text={gapLine(g)} />
        <CopyBlock label="Your answer (about 30 seconds)" hint="Say it in your own words; then talk about why you fit the job" text={gapAnswer(g)} />
        <Card>
          <h2 className="text-sm font-semibold">Good to know</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">{GAP_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
      </div>
    </div>
  </div>;
}
