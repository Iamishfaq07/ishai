import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ResumeData } from "@orbit/types";
import { Button, ErrorNote, Select } from "@orbit/ui";
import { errorText } from "../../lib/format";
import { ResumeSectionScope } from "./ContentForm";

const STEPS = [
  { id: "basics", label: "Your details", hint: "Add the name and contact details employers should use. Check your email carefully." },
  { id: "education", label: "Education", hint: "Add your actual course, school and dates. Freshers can start here." },
  { id: "projects", label: "Projects", hint: "Describe something you actually built or contributed to, including coursework or volunteering." },
  { id: "experience", label: "Work experience", hint: "Add real work or internships. You can skip this if you have no work experience." },
  { id: "skills", label: "Skills", hint: "Choose skills you can explain or demonstrate. Do not add a skill only because a job asks for it." },
  { id: "summary", label: "Summary", hint: "Write a short, truthful introduction. The existing AI rewrite offers changes for you to review." },
  { id: "review", label: "Review & continue", hint: "Check your facts, open the resume checks if helpful, then save and continue to your search." },
];

export function GuidedResume({ data, saveState, children, onContinue, onReview, continueLabel = "Save & continue to jobs" }: {
  continueLabel?: string; data: ResumeData; saveState: string; children: ReactNode; onContinue: () => Promise<void>; onReview: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, STEPS.findIndex((s) => s.id === params.get("section")));
  const step = STEPS[index]!;
  const title = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (previous.current === step.id) return;
    previous.current = step.id;
    const frame = requestAnimationFrame(() => {
      title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [step.id]);
  const move = (next: number) => {
    const query = new URLSearchParams(params); query.set("section", STEPS[next]!.id); setParams(query);
    setError(null);
  };
  const finish = async () => {
    setBusy(true); setError(null);
    try { await onContinue(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const checks = [
    ["Name", Boolean(data.basics.name.trim())], ["Email", Boolean(data.basics.email.trim())],
    ["Education", data.education.some((e) => e.degree.trim() || e.field.trim())],
    ["Project details", data.projects.some((p) => p.name.trim() && (p.description.trim() || p.bullets.some((b) => b.trim())))],
    ["Work details", data.experience.some((e) => e.title.trim() && e.bullets.some((b) => b.trim()))],
    ["Skills", data.skills.some((g) => g.items.some((i) => i.trim()))],
  ] as const;
  return <section aria-label="Guided resume editor" className="min-w-0 space-y-4 break-words">
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-400/30 dark:bg-indigo-500/10">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Resume · Step {index + 1} of {STEPS.length}</p>
      <h2 ref={title} tabIndex={-1} className="mt-2 scroll-mt-4 text-xl font-semibold outline-none">{step.label}</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.hint}</p>
      <label className="mt-3 block text-xs font-medium" htmlFor="resume-guide-step">Jump to a section</label>
      <Select id="resume-guide-step" value={index} disabled={busy} onChange={(e) => move(Number(e.target.value))}>
        {STEPS.map((s, i) => <option key={s.id} value={i}>{i + 1}. {s.label}</option>)}
      </Select>
      <p role="status" className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">{saveState === "saved" ? "Changes saved" : (saveState === "error" || saveState === "conflict") ? "Your changes need saving. Check the editor’s save message." : "Saving your latest changes…"}</p>
    </div>
    {error && <ErrorNote>{error}</ErrorNote>}
    <fieldset disabled={busy} className="min-w-0">
      <legend className="sr-only">{step.label}</legend>
      {step.id !== "review" ? <ResumeSectionScope section={step.id}>{children}</ResumeSectionScope> : <div className="space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        <h3 className="font-semibold">Check before sharing</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">These indicators only show where text exists. They do not judge quality or verify claims. Skip anything that does not apply to you.</p>
        <ul className="space-y-2 text-sm">{checks.map(([label, present]) => <li key={label} className="flex justify-between gap-3"><span>{label}</span><span>{present ? "Text added" : "Not added"}</span></li>)}</ul>
        {(data.hidden ?? []).length > 0 && <p className="text-sm">Some sections are hidden from the printed resume. Use Full editor to review section visibility.</p>}
        <Button type="button" variant="secondary" onClick={onReview}>Open resume checks</Button>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Preview the resume and verify names, dates and contact details. Certificates, extra sections, layout and downloads are available in Full editor.</p>
      </div>}
    </fieldset>
    <nav aria-label="Resume editing steps" className="flex flex-wrap items-center justify-between gap-3 pb-3">
      <Button type="button" variant="secondary" disabled={busy || index === 0} onClick={() => move(index - 1)}>Previous section</Button>
      {index < STEPS.length - 1 ? <Button type="button" disabled={busy} onClick={() => move(index + 1)}>Next: {STEPS[index + 1]!.label}</Button> :
        <Button type="button" loading={busy} onClick={() => void finish()}>{continueLabel}</Button>}
    </nav>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">You can edit any section again. Nothing is submitted to an employer from this editor.</p>
  </section>;
}
