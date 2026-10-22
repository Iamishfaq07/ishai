import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobPrefs, JobProfile } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Sparkles, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useJobsAi } from "./JobsAi";

type Stage = "fresher" | "change" | "experienced";
interface Context {
  version: string; prefs: JobPrefs; resume_id: string | null;
  resumes: { id: string; title: string }[];
  facts: { id: string; label: string; text: string }[];
}
interface Idea { title: string; fact_id: string; source_quote: string; reason: string; experiment: string; check: string }
interface Ideas { roles: Idea[]; source: string }
const STAGES: { id: Stage; label: string; detail: string }[] = [
  { id: "fresher", label: "Student / fresher", detail: "Start with education, projects and skills." },
  { id: "change", label: "Changing careers", detail: "Explore where your existing skills transfer." },
  { id: "experienced", label: "Next career move", detail: "Build on your professional experience." },
];
const panel = "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 sm:p-6";
const muted = "text-sm text-zinc-600 dark:text-zinc-400";

/** One guided start, nested in Today. No extra primary tab and no background AI or application consent changes. */
export function CareerLaunchpad() {
  const { setProfile } = useJobsAi();
  const [params] = useSearchParams();
  const requestedResume = params.get("resume_id") ?? undefined;
  const [context, setContext] = useState<Context | null>(null);
  const [stage, setStage] = useState<Stage>("fresher");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [internships, setInternships] = useState(true);
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [busy, setBusy] = useState<"load" | "ai" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState(0);
  const move = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => {
      const heading = document.getElementById(["starting-point", "role-exploration", "launchpad-search"][next]!);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  };
  const initialized = useRef(false);
  const request = useRef(0);
  const load = useCallback(async (resumeId?: string) => {
    const id = ++request.current;
    setBusy("load"); setError(null); setIdeas(null); setSaved(false); setContext(null);
    try {
      const next = await api.call<Context>(`/v1/jobs/launchpad${resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ""}`);
      if (id !== request.current) return;
      setContext(next);
      if (!initialized.current) {
        setTitle(next.prefs.titles[0] ?? ""); setLocation(next.prefs.locations[0] ?? "");
        if ((next.prefs.level && next.prefs.level !== "fresher") || (next.prefs.years ?? 0) > 0) { setStage("experienced"); setInternships(false); }
        initialized.current = true;
      }
    } catch (e) { if (id === request.current) setError(errorText(e)); }
    finally { if (id === request.current) setBusy(null); }
  }, []);
  const cancelPending = useCallback(() => { request.current++; }, []);
  useEffect(() => { void load(requestedResume); return cancelPending; }, [load, cancelPending, requestedResume]);
  const payload = () => ({ version: context!.version, resume_id: context!.resume_id, stage });
  const explore = async () => {
    if (!context) return;
    const id = ++request.current;
    setBusy("ai"); setError(null); setIdeas(null);
    try {
      const next = await api.call<Ideas>("/v1/jobs/launchpad/ideas", {
        method: "POST", body: JSON.stringify({ ...payload(), target: title.trim() }), timeoutMs: 70_000,
      });
      if (id === request.current) setIdeas(next);
    } catch (e) { if (id === request.current) setError(errorText(e)); }
    finally { if (id === request.current) setBusy(null); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!context) return;
    const id = ++request.current;
    setBusy("save"); setError(null);
    try {
      const next = await api.call<{ profile: JobProfile; context: Context }>("/v1/jobs/launchpad/search", {
        method: "POST", body: JSON.stringify({ ...payload(), title: title.trim(), location: location.trim(), include_internships: internships }),
      });
      if (id !== request.current) return;
      setProfile(next.profile); setContext(next.context); setSaved(true);
    } catch (e) { if (id === request.current) setError(errorText(e)); }
    finally { if (id === request.current) setBusy(null); }
  };
  const edit = () => { setSaved(false); };
  const standardTypes = ["full_time", "part_time", "contract"];
  const existingTypes = (context?.prefs.job_types.length ? context.prefs.job_types : standardTypes).filter((type) => type !== "internship");
  const searchTypes = stage === "fresher" ? ["full_time"] : existingTypes.length ? existingTypes : standardTypes;
  const typePreview = [...searchTypes, ...(internships ? ["internship"] : [])].map((type) => type.replace("_", "-")).join(", ");
  return <section aria-labelledby="launchpad-title" className="min-w-0 space-y-5 break-words">
    <header className="relative overflow-hidden rounded-2xl bg-indigo-950 p-5 text-white sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full border-[22px] border-indigo-400/15 motion-safe:animate-pulse" />
      <p className="text-xs font-semiboldst text-indigo-200">Search setup · Step {step + 1} of 3</p>
      <h2 id="launchpad-title" className="relative mt-2 text-2xl font-semibold">A clear start. A next step you can take.</h2>
      <p className="relative mt-2 max-w-xl text-sm text-indigo-100">Bring what you have, even if it is your first project. Build a resume, explore roles and start a focused search.</p>
      <ol aria-label="Getting started" className="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-indigo-100">
        {["Your starting point", "Explore roles", "Review & start"].map((text, i) => <li key={text}><button type="button" disabled={Boolean(busy)} aria-current={step === i ? "step" : undefined} onClick={() => move(i)} className={cx("flex min-h-11 items-center gap-2 rounded-lg px-2", step === i ? "bg-white/15 font-semibold" : "hover:bg-white/10", focusRing)}><span className="grid h-6 w-6 place-items-center rounded-full border border-indigo-300/50">{i + 1}</span>{text}</button></li>)}
      </ol>
    </header>
    {error && <Callout tone="error"><p>{error}</p><Button variant="ghost" disabled={Boolean(busy)} onClick={() => void load()}>Refresh launchpad</Button></Callout>}
    {!context ? <p role="status" className={muted}>{busy ? "Opening your starting point…" : "Refresh to load your resumes and search settings."}</p> : <>
      <section hidden={step !== 0} className={panel} aria-labelledby="starting-point">
        <h3 id="starting-point" tabIndex={-1} className="scroll-mt-4 font-semibold">1. Your starting point</h3>
        <fieldset disabled={Boolean(busy)} className="mt-4 space-y-4">
          <legend className="sr-only">Choose your career stage</legend>
          <div className="grid gap-2 sm:grid-cols-3">{STAGES.map((item) => <label key={item.id} className={cx("cursor-pointer rounded-xl border p-3 transition-colors motion-reduce:transition-none", stage === item.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-200 dark:border-white/15")}>
            <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="career-stage" value={item.id} checked={stage === item.id} onChange={() => { setStage(item.id); setInternships(item.id === "fresher"); setIdeas(null); edit(); }} />{item.label}</span>
            <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">{item.detail}</span>
          </label>)}</div>
          {context.resumes.length > 0 && <Field htmlFor="launchpad-resume" label="Resume to explore"><Select id="launchpad-resume" value={context.resume_id ?? ""} onChange={(e) => void load(e.target.value)}>
            {context.resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select></Field>}
        </fieldset>
        <p className={cx("mt-3", muted)}>{context.resumes.length ? "Use real details from your education, projects and work. You can browse jobs without AI." : "No resume yet? Start with the student / fresher layout, or bring an existing resume. You can also choose a job title below and browse now."}</p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <Link className={cx("rounded text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing)} to={context.resume_id ? `/resume-ai/${context.resume_id}?guide=1` : "/resume-ai?start=new&guide=1"}>{context.resume_id ? "Edit this resume" : "Build a resume"}</Link>
          <Link className={cx("rounded underline underline-offset-4", focusRing)} to="/resume-ai?start=import&guide=1">Import a resume</Link>
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void load(context.resume_id ?? undefined)}>Refresh resumes</Button>
        </div>
        <Button className="mt-4" disabled={Boolean(busy)} onClick={() => move(1)}>Continue to role ideas</Button>
      </section>
      <form onSubmit={(e) => void save(e)} className="space-y-5">
        <section hidden={step !== 1} className={panel} aria-labelledby="role-exploration">
          <h3 id="role-exploration" tabIndex={-1} className="scroll-mt-4 font-semibold">2. Choose a direction</h3>
          <fieldset disabled={Boolean(busy)} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field htmlFor="launchpad-role" label="Job title to explore"><Input id="launchpad-role" placeholder="e.g. Graduate software engineer" required minLength={2} maxLength={80} value={title} onChange={(e) => { setTitle(e.target.value); edit(); }} /></Field>
            <Field htmlFor="launchpad-location" label="Preferred city (optional)"><Input id="launchpad-location" placeholder="Blank keeps your saved locations" maxLength={120} value={location} onChange={(e) => { setLocation(e.target.value); edit(); }} /></Field>
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2"><p className="text-xs text-zinc-600 dark:text-zinc-400">Example searches:</p>{["Customer support trainee", "Graduate analyst", "Junior designer"].map((example) => <Button key={example} type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => { setTitle(example); edit(); }}>{example}</Button>)}</div>
          <div className="mt-4 flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" disabled={Boolean(busy) || !context.facts.length} disabledReason={!busy && !context.facts.length ? "Add your resume first: role ideas come from its facts." : undefined} loading={busy === "ai"} onClick={() => void explore()}><Sparkles className="h-4 w-4" aria-hidden />Suggest roles from my resume</Button><p className="text-xs text-zinc-600 dark:text-zinc-400">Optional AI · up to 5 requests a day · ideas to explore, not verified vacancies.</p></div>
          {!context.facts.length && <p className={cx("mt-2", muted)}>Add skills, education or project details to unlock AI ideas. You can enter a title yourself.</p>}
          {ideas && <div className="mt-5 space-y-3" aria-live="polite"><p className="text-xs font-medium">{ideas.source === "mock" ? "Demo AI suggestions" : "AI suggestions — review against each job description"}</p>{ideas.roles.map((idea) => <article key={idea.title} className="rounded-xl border border-indigo-200 p-4 dark:border-indigo-400/30">
            <h4 className="font-semibold">{idea.title}</h4><p className={cx("mt-1", muted)}>{idea.reason}</p>
            <blockquote className="my-3 border-l-2 border-indigo-400 pl-3 text-sm"><span className="block text-xs text-zinc-600 dark:text-zinc-400">From your resume</span>“{idea.source_quote}”</blockquote>
            <p className="text-sm"><strong>Try next: </strong>{idea.experiment}</p><p className={cx("mt-1", muted)}><strong>Check your learning: </strong>{idea.check}</p>
            <Button type="button" variant="secondary" className="mt-3" disabled={Boolean(busy)} onClick={() => { setTitle(idea.title); edit(); move(2); }}>Use {idea.title}</Button>
          </article>)}<p className="text-xs text-zinc-600 dark:text-zinc-400">Learning experiments are future work. Add them to a resume only after you have done them.</p></div>}
          <div className="mt-5 flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => move(0)}>Back to resume</Button><Button type="button" disabled={Boolean(busy) || title.trim().length < 2} onClick={() => move(2)}>Review my search</Button></div>
        </section>
        <section hidden={step !== 2} className={panel} aria-labelledby="launchpad-search">
          <h3 id="launchpad-search" tabIndex={-1} className="scroll-mt-4 font-semibold">3. Review your search</h3>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={internships} disabled={Boolean(busy)} onChange={(e) => { setInternships(e.target.checked); edit(); }} />Include internships</label>
          <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5">
            <p><strong>Role:</strong> {title.trim() || "Choose a title above"} <span className="text-zinc-600 dark:text-zinc-400">(replaces your saved role list)</span></p>
            <p className="mt-1"><strong>Locations:</strong> {location.trim() || context.prefs.locations.join(", ") || "Any location"}</p>
            <p className="mt-1">{stage === "fresher" ? `Fresher level · 0 years of professional experience · full-time${internships ? " and internships" : " only"}.` : `Keeps your saved experience level and years. Job types: ${typePreview}.`}</p>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Other search filters stay as saved. Projects and education do not count as professional experience. Employers set each role’s requirements.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => move(1)}>Back to role</Button><Button type="submit" loading={busy === "save"} disabled={Boolean(busy) || saved || title.trim().length < 2}>{saved ? "Search settings saved" : "Save this search"}</Button></div>
          {saved && <div role="status" className="mt-4 space-y-3"><p className="text-sm font-medium">Your search is ready. Review matches and their requirements, then shortlist the roles you want.</p><div className="flex flex-wrap gap-3 text-sm font-semibold">{([["/jobs/matches", "Find matching jobs"], [`/mock?${new URLSearchParams({ role: title.trim() })}`, "Practice with Saba"], ["/jobs/weekly", "Set my weekly plan"]] as const).map(([to, label]) => <Link key={to} to={to} className={cx("rounded text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing)}>{label}</Link>)}</div></div>}
        </section>
      </form>
    </>}
  </section>;
}
