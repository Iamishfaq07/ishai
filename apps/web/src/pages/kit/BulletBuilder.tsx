import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleAlert, Wand2, cx, readJSON, safeLocal } from "@orbit/ui";
import { Card, Field, Input, PageHeader, Textarea } from "../../components/ui";
import { CopyBlock } from "./CopyBlock";
import { STRONG_VERBS, buildBullets, checkBullet, type BulletParts } from "./bullets";

const KEY = "orbit.bullet-builder";
const EMPTY: BulletParts = { did: "", result: "", measure: "" };
const isParts = (v: unknown): v is BulletParts => typeof v === "object" && v !== null && "did" in v;

function Checks({ text }: { text: string }) {
  const { checks, swaps } = checkBullet(text);
  return <div className="mt-2 space-y-1">
    <ul className="space-y-1 text-xs">{checks.map((c) => <li key={c.text} className={cx("flex items-start gap-1.5", c.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200")}>
      {c.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}{c.text}</li>)}</ul>
    {swaps.map((s) => <p key={s.weak} className="text-xs text-zinc-600 dark:text-zinc-400">Instead of “{s.weak}”, try: {s.strong.join(", ")}.</p>)}
  </div>;
}

/**
 * Resume → Bullet builder (pages/kit/bullets.ts): the X-Y-Z formula from three facts the candidate gives, arranged
 * three ways and checked; plus a check for any bullet they paste. Runs in the browser.
 */
export function BulletBuilderPage() {
  const [parts, setParts] = useState<BulletParts>(() => readJSON(safeLocal, KEY, EMPTY, isParts));
  const [pasted, setPasted] = useState("");
  const set = (k: keyof BulletParts, v: string) => { const next = { ...parts, [k]: v }; setParts(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const built = buildBullets(parts);

  return <div>
    <PageHeader eyebrow="Resume Studio" icon={Wand2} title="Bullet builder"
      subtitle="Turn what you did into a resume line recruiters read in seconds: the result, how much, and how you did it." />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <Card className="space-y-4">
          <h2 className="font-semibold">Build from three facts</h2>
          <Field label="What did you do?" htmlFor="b-did" hint="Past tense, starting with a verb: “rewrote the checkout API in Go”">
            <Input id="b-did" value={parts.did} onChange={(e) => set("did", e.target.value)} placeholder="organised a 3-day coding workshop for juniors" /></Field>
          <Field label="What changed because of it?" htmlFor="b-result" hint="Past tense: “cut page load time”, “increased sign-ups”">
            <Input id="b-result" value={parts.result} onChange={(e) => set("result", e.target.value)} placeholder="raised club membership" /></Field>
          <Field label="By how much?" htmlFor="b-measure" hint="Only a number you can back up in an interview">
            <Input id="b-measure" value={parts.measure} onChange={(e) => set("measure", e.target.value)} placeholder="from 40 to 120 students in one semester" /></Field>
          {built.length > 0 && <div className="space-y-3">{built.map((b) => <div key={b.label}>
            <CopyBlock label={b.label} text={b.text} /><Checks text={b.text} /></div>)}</div>}
        </Card>
        <Card>
          <h2 className="font-semibold">Check a bullet you already have</h2>
          <Textarea aria-label="A resume bullet" rows={3} className="mt-3" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Responsible for handling customer queries" />
          {pasted.trim() && <Checks text={pasted} />}
        </Card>
      </div>
      <aside className="space-y-4">
        <Card>
          <h2 className="font-semibold">Strong verbs</h2>
          <dl className="mt-3 space-y-3 text-sm">{STRONG_VERBS.map((g) => <div key={g.group}><dt className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{g.group}</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{g.verbs.map((v) => <span key={v} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-white/10">{v}</span>)}</dd></div>)}</dl>
        </Card>
        <p className="px-1 text-xs text-zinc-600 dark:text-zinc-400">The formula is the one Google's recruiters describe: accomplished X, as measured by Y, by doing Z. Copy a line into your resume in <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/resume-ai">Resume Studio</Link>.</p>
      </aside>
    </div>
  </div>;
}
