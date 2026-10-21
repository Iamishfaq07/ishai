import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Sparkles, cx, focusRing, useCopy } from "@orbit/ui";
import { Button, ErrorNote, Field, Textarea } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";
import { addCommitment, tomorrowMorning } from "../Commitments";

interface Story { title: string; situation: string; task: string; action: string; result: string; competencies: string[] }
interface Debrief {
  questions: { question: string; kind: string; went: "strong" | "okay" | "weak" | "unsure" }[];
  promises: string[]; focus: string[]; thank_you_points: string[]; stories: Story[];
}

const WENT: Record<Debrief["questions"][number]["went"], string> = {
  strong: "Went well", okay: "Went okay", weak: "Needs work", unsure: "Not sure",
};
const WENT_TONE: Record<Debrief["questions"][number]["went"], string> = {
  strong: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200", okay: "bg-zinc-100 dark:bg-white/10",
  weak: "bg-amber-500/10 text-amber-900 dark:text-amber-200", unsure: "bg-zinc-100 dark:bg-white/10",
};
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold underline underline-offset-4", focusRing);

/**
 * After a real employer round: the candidate's notes become the questions asked, promises to keep, what to prepare
 * next and story drafts (POST /v1/jobs/tracker/{id}/debrief). Nothing is saved until they choose: a story goes to the
 * story bank; the summary can be copied into the round's notes through the normal edit form.
 */
export function InterviewDebrief({ entryId, roundId, label, initialNotes = "" }: {
  entryId: string; roundId?: string; label: string; initialNotes?: string;
}) {
  const [copied, copy] = useCopy();
  const id = useId();
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Debrief | null>(null);
  const [saved, setSaved] = useState<Record<number, "saving" | "saved" | string>>({});
  const run = async () => {
    setBusy(true); setError(null); setResult(null); setSaved({}); setPromised("idle");
    try {
      setResult(await api.call<Debrief>(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/debrief`, {
        method: "POST", body: JSON.stringify({ notes, round_id: roundId ?? null }) }));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const [promised, setPromised] = useState<"idle" | "saving" | "saved">("idle");
  const keepPromises = async (items: string[]) => {
    setPromised("saving");
    try {
      const due = tomorrowMorning();
      for (const text of items) await addCommitment(entryId, text, due);
      setPromised("saved");
    } catch (e) { setError(errorText(e)); setPromised("idle"); }
  };
  const saveStory = async (index: number, story: Story) => {
    setSaved((s) => ({ ...s, [index]: "saving" }));
    try {
      await api.call("/v1/stories", { method: "POST", body: JSON.stringify(story) });
      setSaved((s) => ({ ...s, [index]: "saved" }));
    } catch (e) { setSaved((s) => ({ ...s, [index]: errorText(e) })); }
  };
  const summary = result ? [
    `Debrief · ${label}`,
    ...result.questions.map((q) => `- ${q.question} (${WENT[q.went].toLowerCase()})`),
    ...(result.promises.length ? ["To send:", ...result.promises.map((p) => `- ${p}`)] : []),
    ...(result.focus.length ? ["Next round focus:", ...result.focus.map((f) => `- ${f}`)] : []),
  ].join("\n").slice(0, 4000) : "";
  return <section aria-label={`Debrief ${label}`} className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <div><h4 className="font-semibold">Debrief this interview</h4>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Write what you remember: the questions, your answers, anything you promised. AI organises it; it uses only your notes and saves nothing until you choose.</p></div>
    <Field label="Your notes" htmlFor={`${id}-notes`} hint={`${notes.trim().length < 40 ? "At least 40 characters" : `${notes.length} / 8000`}`}>
      <Textarea id={`${id}-notes`} rows={5} maxLength={8000} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="They asked how I'd design a rate limiter. I talked through a token bucket but forgot about multiple regions. I promised to send my GitHub link…" />
    </Field>
    <Button loading={busy} disabled={notes.trim().length < 40} onClick={() => void run()}><Sparkles className="h-4 w-4" aria-hidden /> Organise my debrief</Button>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {result && <div className="space-y-5">
      {result.questions.length > 0 && <div><h5 className="text-sm font-semibold">Questions asked</h5>
        <ul className="mt-2 space-y-2">{result.questions.map((q, i) => <li key={i} className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <span className="min-w-0 flex-1 break-words">{q.question}</span>
          <span className={cx("rounded-full px-2 py-0.5 text-xs", WENT_TONE[q.went])}>{WENT[q.went]}</span></li>)}</ul></div>}
      {result.promises.length > 0 && <div><h5 className="text-sm font-semibold">You said you would send</h5>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.promises.map((p, i) => <li key={i}>{p}</li>)}</ul>
        <Button size="sm" variant="secondary" className="mt-2" disabled={promised !== "idle"} onClick={() => void keepPromises(result.promises)}>
          {promised === "saved" ? "Added to Promises to keep" : promised === "saving" ? "Adding…" : "Add to my to-dos, due tomorrow"}</Button></div>}
      {result.focus.length > 0 && <div><h5 className="text-sm font-semibold">Prepare before the next round</h5>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.focus.map((f, i) => <li key={i}>{f}</li>)}</ul>
        <Link className={link} to={`/jobs/mission/${encodeURIComponent(entryId)}?tab=practice`}>Practise these with Saba</Link></div>}
      {result.thank_you_points.length > 0 && <div><h5 className="text-sm font-semibold">Worth mentioning in a thank-you note</h5>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.thank_you_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        <Link className={link} to="/jobs/outreach?view=messages">Draft a thank-you note</Link></div>}
      {result.stories.length > 0 && <div><h5 className="text-sm font-semibold">Story drafts for your story bank</h5>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Fill any [bracketed] gaps with what really happened after saving.</p>
        <ul className="mt-2 space-y-3">{result.stories.map((s, i) => <li key={i} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
          <p className="font-medium">{s.title}</p>
          <dl className="mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">{([["Situation", s.situation], ["Task", s.task], ["Action", s.action], ["Result", s.result]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline">{v}</dd></div>)}</dl>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" disabled={saved[i] === "saving" || saved[i] === "saved"} onClick={() => void saveStory(i, s)}>{saved[i] === "saved" ? "Saved to story bank" : "Save to story bank"}</Button>
            {saved[i] === "saved" && <Link className={link} to="/documents/stories">Open story bank</Link>}
            {saved[i] && saved[i] !== "saving" && saved[i] !== "saved" && <span role="alert" className="text-xs text-rose-700 dark:text-rose-300">{saved[i]}</span>}
          </div></li>)}</ul></div>}
      {summary && <Button variant="ghost" onClick={() => void copy(summary)}><Copy className="h-4 w-4" aria-hidden /> {copied === "copied" ? "Summary copied" : "Copy summary"}</Button>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Organised from your notes only. It doesn't predict whether you'll move forward.</p>
    </div>}
  </section>;
}
