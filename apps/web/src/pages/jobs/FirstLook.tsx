import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Eye, cx, focusRing, useCopy } from "@orbit/ui";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Look {
  impression: string; headline: string; summary: string; resume_id: string; resume_title: string; top_text: string;
  skills: { skill: string; where: "top" | "later" | "missing" }[];
}

const WHERE: Record<Look["skills"][number]["where"], { label: string; tone: string }> = {
  top: { label: "Seen first", tone: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" },
  later: { label: "Further down", tone: "bg-amber-500/10 text-amber-900 dark:text-amber-200" },
  missing: { label: "Not on resume", tone: "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300" },
};

function CopyLine({ label, text }: { label: string; text: string }) {
  const [state, copy] = useCopy();
  if (!text) return null;
  return <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
    <div className="flex items-center justify-between gap-2"><span className="font-medium">{label}</span>
      <Button size="sm" variant="ghost" onClick={() => void copy(text)}><Copy className="h-3.5 w-3.5" aria-hidden /> {state === "copied" ? "Copied" : "Copy"}</Button></div>
    <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{text}</p>
  </div>;
}

/**
 * Recruiter first look (POST /v1/jobs/tracker/{id}/first-look): where this job's most-asked skills appear in the
 * resume (seen first, further down, not on it) and a recruiter-style impression of the top third, with a suggested
 * headline and summary from the resume's own facts. Nothing is changed: the candidate copies what they want.
 */
export function FirstLook({ entryId, resumeId }: { entryId: string; resumeId?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      setLook(await api.call<Look>(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/first-look`, {
        method: "POST", body: JSON.stringify({ resume_id: resumeId ?? null }) }));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Recruiter first look" className="workspace-panel space-y-4 p-4 sm:p-5">
    <div><h3 className="font-semibold">Recruiter first look</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">A first pass reads the top third of a resume in seconds. See whether this job’s main skills show up there, and get a headline and summary written from your own facts.</p></div>
    <Button loading={busy} variant={look ? "secondary" : "primary"} onClick={() => void run()}><Eye className="h-4 w-4" aria-hidden /> {look ? "Look again" : "See the first look"}</Button>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {look && <div className="space-y-4">
      <p className="text-sm"><span className="font-medium">First impression: </span>{look.impression}</p>
      {look.skills.length > 0 && <div><h4 className="text-sm font-semibold">This job’s main skills on “{look.resume_title}”</h4>
        <ul className="mt-2 flex flex-wrap gap-2">{look.skills.map((s) => <li key={s.skill} className={cx("rounded-full px-2.5 py-1 text-xs", WHERE[s.where].tone)}>{s.skill} · {WHERE[s.where].label}</li>)}</ul>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Further down: move it into your headline, summary or latest role if it’s central to this job. Not on resume: add it only if you really have it.</p></div>}
      <CopyLine label="Suggested headline" text={look.headline} />
      <CopyLine label="Suggested summary" text={look.summary} />
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Written from your resume only. Replace any [bracketed] prompt with the real detail, or remove it.</p>
      <Link to={`/resume-ai/${encodeURIComponent(look.resume_id)}`} className={cx("inline-flex min-h-11 items-center rounded text-sm font-semibold underline underline-offset-4", focusRing)}>Edit this resume</Link>
    </div>}
  </section>;
}
