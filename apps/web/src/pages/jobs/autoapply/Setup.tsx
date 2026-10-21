import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApplyBankItem, ApplyFacts, ApplyFilters, ApplyLevel, ApplySetup, ApplySetupInput, ApplyWorkplace, ApplyPlanReport } from "@orbit/types";
import { ArrowLeft, ArrowRight, Check, LoadGate, Plus, Rocket, Trash2, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea, Toggle } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { RESUME_AI_HOME } from "../../resume/paths";
import { linkButton, textLink } from "../links";
import { JOBS_APPLICATIONS } from "../paths";
import { applyApi } from "./applyApi";
import { ApplyEngine } from "./ApplyEngine";
import { fromTri, listText, minutesToTime, parseList, sendsItself, timeToMinutes, toTri } from "./model";

const STEPS = ["Resume", "Your facts", "Answers", "Filters", "Mode and limits", "Consent"] as const;
const WORKPLACES: Array<{ id: ApplyWorkplace; label: string }> = [
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On site" },
];
const LEVELS: Array<{ id: ApplyLevel; label: string }> = [
  { id: "fresher", label: "Fresher" },
  { id: "junior", label: "Junior" },
  { id: "mid", label: "Mid-level" },
  { id: "senior", label: "Senior" },
];

/** Jobs → Applications → Set up: the one-time setup of Orbit Apply. */
export function AutoApplySetupPage() {
  const setup = useAsync(() => applyApi.getApplySetup(), [], "apply-setup");
  const bank = useAsync(() => applyApi.getApplyBank(), [], "apply-bank");
  useEffect(() => {
    if (setup.data?.execution !== "hosted") return;
    const timer = window.setInterval(setup.reload, 30_000);
    return () => window.clearInterval(timer);
  }, [setup.data?.execution, setup.reload]);
  const loading = (setup.loading && !setup.data) || (bank.loading && !bank.data);
  return (
    <>
      <PageHeader
        icon={Rocket}
        title="Set up auto-apply"
        subtitle="Approve your resume, answers and limits once. Orbit finds matching jobs and prepares every application. Nothing to install, and missing answers come back to you."
      />
      <LoadGate loading={loading} variant="card" count={2} label="Getting your Orbit Apply setup">
        {setup.error && !setup.data ? (
          <ErrorNote onRetry={setup.reload}>{errorText(setup.error)}</ErrorNote>
        ) : bank.error && !bank.data ? (
          <ErrorNote onRetry={bank.reload}>{errorText(bank.error)}</ErrorNote>
        ) : setup.data && bank.data ? (
          <Wizard
            setup={setup.data}
            bank={bank.data}
            onSaved={(s, b) => {
              setup.setData(() => s);
              if (b) bank.setData(() => b);
            }}
          />
        ) : null}
      </LoadGate>
    </>
  );
}

function inputOf(s: ApplySetup): ApplySetupInput {
  return {
    resume_id: s.resume?.id ?? s.resumes[0]?.id ?? null,
    approve_resume: false,
    facts: s.facts,
    filters: s.filters,
    mode: s.mode,
    daily_limit: s.daily_limit,
    threshold: s.threshold,
    ai_line: s.ai_line,
    quiet_hours: s.quiet_hours,
    tz_offset_min: -new Date().getTimezoneOffset(),
    consent: s.configured,
    // Hosted wherever this server runs it. "browser" otherwise: approved applications wait for the candidate to send
    // (or, for an older account, for its still-connected extension). The extension is no longer offered.
    execution: s.hosted_enabled && !(s.execution === "browser" && s.consent_at && sendsItself(s)) ? "hosted" : "browser",
    hosted_consent: !!s.hosted_consent_at,
    stop_when_hired: s.stop_when_hired ?? true,
  };
}

function Wizard({
  setup,
  bank,
  onSaved,
}: {
  setup: ApplySetup;
  bank: ApplyBankItem[];
  onSaved: (setup: ApplySetup, bank: ApplyBankItem[] | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ApplySetupInput>(() => inputOf(setup));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(bank.map((b) => [b.norm, b.value])));
  const [agree, setAgree] = useState(setup.configured);
  const [busy, setBusy] = useState<"save" | "plan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<ApplyPlanReport | null>(null);
  const set = <K extends keyof ApplySetupInput>(key: K, value: ApplySetupInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setFacts = (patch: Partial<ApplyFacts>) => setDraft((d) => ({ ...d, facts: { ...d.facts, ...patch } }));
  const setFilters = (patch: Partial<ApplyFilters>) => setDraft((d) => ({ ...d, filters: { ...d.filters, ...patch } }));

  const save = async (consent: boolean) => {
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const changed = bank.filter((b) => (answers[b.norm] ?? "") !== b.value).map((b) => ({ norm: b.norm, value: answers[b.norm] ?? "" }));
      const savedBank = changed.length ? await applyApi.saveApplyBank(changed) : null;
      const saved = await applyApi.saveApplySetup({ ...draft, consent });
      onSaved(saved, savedBank);
      setDraft(inputOf(saved));
      setAgree(saved.configured);
      setMessage(saved.configured ? "Saved. Orbit Apply is on." : "Saved. Orbit Apply is off: nothing is sent until you turn it on.");
      if (saved.configured && !setup.configured) {
        setBusy("plan");
        try { setReport(await applyApi.planApplications()); }
        catch { setMessage("Your setup is saved. The first search could not finish; use Find jobs now to retry. Orbit also searches automatically."); }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const plan = async () => {
    setBusy("plan");
    setError(null);
    try {
      setReport(await applyApi.planApplications());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const last = step === STEPS.length - 1;
  return (
    <div className="space-y-4">
      <nav aria-label="Setup steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cx(
                  "rounded-full border px-3 py-1 text-sm",
                  focusRing,
                  i === step
                    ? "border-indigo-700 bg-indigo-700 text-white"
                    : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-200",
                )}
              >
                <span className="sr-only">Step </span>
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <ApplyEngine setup={{ ...setup, execution: draft.execution }} preview={draft.execution !== setup.execution || !setup.configured} />

      <Card>
        <div className="space-y-4 p-5">
          {step === 0 && <ResumeStep setup={setup} draft={draft} set={set} />}
          {step === 1 && <FactsStep facts={draft.facts} setFacts={setFacts} />}
          {step === 2 && <BankStep bank={bank} answers={answers} setAnswer={(norm, v) => setAnswers((a) => ({ ...a, [norm]: v }))} />}
          {step === 3 && <FiltersStep filters={draft.filters} titles={setup.profile_titles} maxDays={setup.caps.max_fresh_days} setFilters={setFilters} />}
          {step === 4 && <ModeStep setup={setup} draft={draft} set={set} />}
          {step === 5 && (
            <ConsentStep setup={setup} agree={agree} setAgree={setAgree} draft={draft} set={set} />
          )}
        </div>
      </Card>

      <div aria-live="polite" className="space-y-2">
        {error && <ErrorNote>{error}</ErrorNote>}
        {message && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
            <Check className="h-4 w-4" aria-hidden /> {message}
          </p>
        )}
        {report && <PlanSummary report={report} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          {!last && (
            <Button variant="secondary" onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}>
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {setup.configured && (
            <Button variant="ghost" onClick={() => void save(false)} loading={busy === "save"}>
              Turn off
            </Button>
          )}
          {last || setup.configured ? (
            <Button
              onClick={() => void save(true)}
              loading={busy === "save"}
              disabled={!agree || (draft.execution === "hosted" && !draft.hosted_consent) || busy === "plan"}
              disabledReason="Complete the consent choices first."
            >
              {setup.configured ? "Save changes" : "Save and turn on"}
            </Button>
          ) : null}
          {setup.configured && (
            <>
              <Button variant="secondary" onClick={() => void plan()} loading={busy === "plan"} loadingText="Finding jobs…">
                Find jobs now
              </Button>
              <Link to={JOBS_APPLICATIONS} className={linkButton("secondary", "md")}>
                See your applications
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlanSummary({ report }: { report: ApplyPlanReport }) {
  if (report.blocked) return <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">{report.blocked}</p>;
  return (
    <div className="rounded-xl bg-zinc-100 p-3 text-sm dark:bg-white/5">
      <p className="font-medium">
        Prepared {report.created} new application{report.created === 1 ? "" : "s"} from {report.considered} matching job
        {report.considered === 1 ? "" : "s"}.
      </p>
      {report.skipped.length > 0 && (
        <details className="mt-2">
          <summary className={cx("cursor-pointer text-zinc-700 dark:text-zinc-300", focusRing)}>
            Why {report.skipped.length} were left out
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {report.skipped.map((s) => (
              <li key={s.listing_id}>
                {s.title} at {s.company}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {hint && <p className="text-sm text-zinc-600 dark:text-zinc-400">{hint}</p>}
      {children}
    </section>
  );
}

function ResumeStep({
  setup,
  draft,
  set,
}: {
  setup: ApplySetup;
  draft: ApplySetupInput;
  set: <K extends keyof ApplySetupInput>(key: K, value: ApplySetupInput[K]) => void;
}) {
  const id = useId();
  const sameResume = setup.resume?.id === draft.resume_id;
  const approved = draft.approve_resume || (sameResume && Boolean(setup.resume?.approved));
  if (setup.resumes.length === 0) {
    return (
      <Section title="Your resume">
        <p className="text-sm">
          Orbit Apply uses a resume you made in Resume.{" "}
          <Link to={RESUME_AI_HOME} className={textLink}>
            Make one first
          </Link>
          .
        </p>
      </Section>
    );
  }
  return (
    <Section
      title="Your resume"
      hint="The one Orbit Apply sends. For each job it only reorders and rewords what's already on it, and shows you the changes. It never adds a skill, a tool, a number or a role you don't have."
    >
      <Field label="Resume" htmlFor={`${id}-resume`}>
        <Select
          id={`${id}-resume`}
          value={draft.resume_id ?? ""}
          onChange={(e) => {
            set("resume_id", e.target.value || null);
            set("approve_resume", false);
          }}
        >
          {setup.resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>
      {sameResume && setup.resume?.changed_since && !draft.approve_resume && (
        <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          This resume changed since you approved it. Orbit Apply waits until you approve it again.
        </p>
      )}
      {approved ? (
        <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <Check className="h-4 w-4" aria-hidden /> {draft.approve_resume ? "Approved. It's saved when you save the setup." : "Approved."}
        </p>
      ) : (
        <Button variant="secondary" onClick={() => set("approve_resume", true)}>
          Approve this resume
        </Button>
      )}
    </Section>
  );
}

function TriSelect({ id, label, value, onChange, hint }: { id: string; label: string; value: boolean | null; onChange: (v: boolean | null) => void; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Select id={id} value={toTri(value)} onChange={(e) => onChange(fromTri(e.target.value))}>
        <option value="">Not said (forms that ask will stop and ask you)</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    </Field>
  );
}

function FactsStep({ facts, setFacts }: { facts: ApplyFacts; setFacts: (patch: Partial<ApplyFacts>) => void }) {
  const id = useId();
  const text = (key: keyof ApplyFacts, label: string, opts: { type?: string; hint?: string; required?: boolean } = {}) => (
    <Field label={label} htmlFor={`${id}-${key}`} {...(opts.hint ? { hint: opts.hint } : {})} {...(opts.required ? { required: true } : {})}>
      <Input
        id={`${id}-${key}`}
        type={opts.type ?? "text"}
        value={String(facts[key] ?? "")}
        onChange={(e) => setFacts({ [key]: e.target.value } as Partial<ApplyFacts>)}
      />
    </Field>
  );
  const num = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return (
    <Section
      title="Your facts"
      hint="Filled in from your resume where it says. Check each one: forms are answered from these, exactly as you leave them. Anything left empty is never guessed."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text("first_name", "First name", { required: true })}
        {text("last_name", "Last name")}
        {text("email", "Email", { type: "email", required: true })}
        {text("phone", "Phone", { type: "tel" })}
        {text("city", "City you live in")}
        {text("country", "Country (2-letter code, e.g. IN, US)")}
        {text("linkedin", "LinkedIn", { type: "url" })}
        {text("github", "GitHub", { type: "url" })}
        {text("website", "Website or portfolio", { type: "url" })}
        {text("current_company", "Current company")}
        {text("current_title", "Current job title")}
        {text("highest_degree", "Highest degree")}
        <Field label="Years of experience" htmlFor={`${id}-years`}>
          <Input
            id={`${id}-years`}
            type="number"
            min={0}
            max={60}
            step={0.5}
            value={facts.years_experience ?? ""}
            onChange={(e) => setFacts({ years_experience: num(e.target.value) })}
          />
        </Field>
        <Field label="Notice period (days)" htmlFor={`${id}-notice`}>
          <Input
            id={`${id}-notice`}
            type="number"
            min={0}
            max={365}
            value={facts.notice_period_days ?? ""}
            onChange={(e) => setFacts({ notice_period_days: num(e.target.value) })}
          />
        </Field>
        {text("earliest_start", "Earliest start", { hint: "For example “Two weeks after an offer”." })}
        <TriSelect id={`${id}-relocate`} label="Willing to relocate?" value={facts.willing_to_relocate} onChange={(v) => setFacts({ willing_to_relocate: v })} />
        {text("expected_salary", "Expected salary (optional)", { hint: "For example “₹28 LPA” or “$150,000”." })}
        {text("current_salary", "Current salary (optional)", {
          hint: "Only if you want forms that ask to get it. Orbit never fills it in otherwise.",
        })}
      </div>
      <WorkAuth facts={facts} setFacts={setFacts} />
    </Section>
  );
}

function WorkAuth({ facts, setFacts }: { facts: ApplyFacts; setFacts: (patch: Partial<ApplyFacts>) => void }) {
  const id = useId();
  const rows = facts.work_auth;
  const update = (i: number, patch: Partial<ApplyFacts["work_auth"][number]>) =>
    setFacts({ work_auth: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Work authorisation, per country</legend>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A legal question: forms asking about a country you haven't listed here stop and ask you.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_1fr_auto]">
          <Field label="Country code" htmlFor={`${id}-${i}-c`}>
            <Input id={`${id}-${i}-c`} maxLength={2} value={r.country} onChange={(e) => update(i, { country: e.target.value.toUpperCase() })} />
          </Field>
          <TriSelect id={`${id}-${i}-a`} label="Authorised to work there?" value={r.authorized} onChange={(v) => update(i, { authorized: v })} />
          <TriSelect id={`${id}-${i}-s`} label="Need visa sponsorship?" value={r.needs_sponsorship} onChange={(v) => update(i, { needs_sponsorship: v })} />
          <Button variant="ghost" onClick={() => setFacts({ work_auth: rows.filter((_, j) => j !== i) })}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remove {r.country || "this country"}
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setFacts({ work_auth: [...rows, { country: facts.country || "", authorized: null, needs_sponsorship: null }] })}
      >
        <Plus className="h-4 w-4" aria-hidden /> Add a country
      </Button>
    </fieldset>
  );
}

const BANK_GROUPS: Array<{ id: ApplyBankItem["group"]; title: string; hint: string }> = [
  { id: "legal", title: "Legal questions", hint: "Only ever answered with what you set here. Left empty, a form asking stops and asks you." },
  { id: "eeo", title: "Voluntary self-identification", hint: "Orbit declines to self-identify for you unless you choose an answer." },
  { id: "yours", title: "Your answers", hint: "Common screening questions. Empty ones are asked when a form needs them." },
  { id: "custom", title: "Saved from forms", hint: "Answers you gave to a form's own questions, used again when a form asks the same." },
];

function BankStep({ bank, answers, setAnswer }: { bank: ApplyBankItem[]; answers: Record<string, string>; setAnswer: (norm: string, value: string) => void }) {
  const id = useId();
  return (
    <Section title="Your answer bank" hint="Saved with the setup. Each answer is used for every form that asks the same question.">
      {BANK_GROUPS.map((g) => {
        const items = bank.filter((b) => b.group === g.id);
        if (!items.length) return null;
        return (
          <fieldset key={g.id} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
            <legend className="px-1 text-sm font-semibold">{g.title}</legend>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{g.hint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((b, i) => {
                const fid = `${id}-${g.id}-${i}`;
                const value = answers[b.norm] ?? "";
                const hint = [b.default && !value ? `Left empty: “${b.default}”.` : "", b.help].filter(Boolean).join(" ");
                return (
                  <Field key={b.norm} label={b.label} htmlFor={fid} {...(hint ? { hint } : {})}>
                    {b.kind === "yes_no" ? (
                      <Select id={fid} value={value} onChange={(e) => setAnswer(b.norm, e.target.value)}>
                        <option value="">Not answered</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </Select>
                    ) : b.kind === "textarea" ? (
                      <Textarea id={fid} rows={3} value={value} onChange={(e) => setAnswer(b.norm, e.target.value)} />
                    ) : (
                      <Input id={fid} value={value} placeholder={b.default || ""} onChange={(e) => setAnswer(b.norm, e.target.value)} />
                    )}
                  </Field>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </Section>
  );
}

function FiltersStep({
  filters,
  titles,
  maxDays,
  setFilters,
}: {
  filters: ApplyFilters;
  titles: string[];
  maxDays: number;
  setFilters: (patch: Partial<ApplyFilters>) => void;
}) {
  const id = useId();
  const list = (key: "titles" | "keywords" | "locations" | "exclude_companies" | "countries", label: string, hint: string, placeholder = "") => (
    <ListField id={`${id}-${key}`} label={label} hint={hint} placeholder={placeholder} value={filters[key]} onChange={(v) => setFilters({ [key]: v })} />
  );
  const toggleIn = <T extends string>(items: T[], item: T): T[] => (items.includes(item) ? items.filter((x) => x !== item) : [...items, item]);
  return (
    <Section title="Which jobs" hint="Jobs come from Jobs's feed and must fit all of these. Empty means what your Jobs profile says.">
      <div className="grid gap-3 sm:grid-cols-2">
        {list("titles", "Job titles", "Separate with commas.", titles.join(", "))}
        {list("keywords", "Must mention", "Each word must be in the title or the skills.")}
        {list("locations", "Cities", "Separate with commas.")}
        {list("countries", "Countries the job may be in", "2-letter codes. Empty: your own country.")}
        {list("exclude_companies", "Never apply to", "Company names, separated with commas.")}
        <Field label="Salary floor (yearly, in the post's currency)" htmlFor={`${id}-floor`} hint="Only checked when a post states its pay.">
          <Input
            id={`${id}-floor`}
            type="number"
            min={0}
            value={filters.salary_floor ?? ""}
            onChange={(e) => setFilters({ salary_floor: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
        <Field label={`Posted within (days, at most ${maxDays})`} htmlFor={`${id}-days`}>
          <Input
            id={`${id}-days`}
            type="number"
            min={1}
            max={maxDays}
            value={filters.days}
            onChange={(e) => setFilters({ days: Math.max(1, Math.min(maxDays, Number(e.target.value) || 1)) })}
          />
        </Field>
      </div>
      <CheckGroup legend="Work mode" options={WORKPLACES} selected={filters.workplace} onToggle={(w) => setFilters({ workplace: toggleIn(filters.workplace, w) })} />
      <CheckGroup legend="Seniority" options={LEVELS} selected={filters.seniority} onToggle={(l) => setFilters({ seniority: toggleIn(filters.seniority, l) })} />
    </Section>
  );
}

function ListField({ id, label, hint, placeholder, value, onChange }: { id: string; label: string; hint: string; placeholder: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(listText(value));
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(parseList(text))} />
    </Field>
  );
}

function CheckGroup<T extends string>({ legend, options, selected, onToggle }: { legend: string; options: Array<{ id: T; label: string }>; selected: T[]; onToggle: (id: T) => void }) {
  const id = useId();
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {options.map((o) => (
          <label key={o.id} htmlFor={`${id}-${o.id}`} className="flex items-center gap-2 text-sm">
            <input id={`${id}-${o.id}`} type="checkbox" className={cx("h-4 w-4", focusRing)} checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">None ticked: any.</p>
    </fieldset>
  );
}

function ModeStep({
  setup,
  draft,
  set,
}: {
  setup: ApplySetup;
  draft: ApplySetupInput;
  set: <K extends keyof ApplySetupInput>(key: K, value: ApplySetupInput[K]) => void;
}) {
  const id = useId();
  const q = setup.quota;
  const quiet = draft.quiet_hours;
  return (
    <Section title="How it runs">
      <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10">
        <h3 className="font-semibold">How applications are sent</h3>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{draft.execution === "hosted"
          ? "Orbit fills and sends supported employer forms from its own servers, even when Orbit is closed: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee. Authorise it in the Consent step."
          : !sendsItself(setup)
            ? "Orbit prepares every application for you to send: answers, cover letter and a tailored resume, waiting in Needs you. Orbit Business jobs are sent for you."
            : "Your connected browser keeps sending applications while it is open."}</p>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Mode</legend>
        <div className="mt-2 space-y-2">
          {(
            [
              ["automatic", "Automatic", "Prepared applications go out within your approved rules and limits. You can pause them at any time."],
              ["review", "Review first", "Each application waits for you to approve it before it goes."],
            ] as const
          ).map(([value, label, text]) => (
            <label key={value} htmlFor={`${id}-${value}`} className="flex items-start gap-2 text-sm">
              <input
                id={`${id}-${value}`}
                type="radio"
                name={`${id}-mode`}
                className={cx("mt-1 h-4 w-4", focusRing)}
                checked={draft.mode === value}
                onChange={() => set("mode", value)}
              />
              <span>
                <span className="font-medium">{label}</span>. {text}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Applications a day (at most ${setup.caps.max_daily_limit})`} htmlFor={`${id}-limit`} hint={`At most ${setup.caps.per_company} per company in ${setup.caps.per_company_days} days, a few minutes apart.`}>
          <Input
            id={`${id}-limit`}
            type="number"
            min={1}
            max={setup.caps.max_daily_limit}
            value={draft.daily_limit}
            onChange={(e) => set("daily_limit", Math.max(1, Math.min(setup.caps.max_daily_limit, Number(e.target.value) || 1)))}
          />
        </Field>
        <Field label={`Match score a job needs: ${draft.threshold}%`} htmlFor={`${id}-threshold`} hint="Jobs's match score. Higher sends fewer, closer matches.">
          <input
            id={`${id}-threshold`}
            type="range"
            min={setup.caps.min_threshold}
            max={95}
            value={draft.threshold}
            onChange={(e) => set("threshold", Number(e.target.value))}
            className={cx("w-full", focusRing)}
          />
        </Field>
      </div>
      <Toggle
        checked={draft.stop_when_hired ?? true}
        onChange={(on) => set("stop_when_hired", on)}
        label="Pause automatically when I mark a role as hired"
        description="Finish this search when you accept your next role. Resuming later starts a new search campaign."
      />
      <Toggle
        checked={quiet !== null}
        onChange={(on) => set("quiet_hours", on ? { start: 22 * 60, end: 7 * 60 } : null)}
        label="Quiet hours"
        description="No applications go out in these hours, your time."
      />
      {quiet && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor={`${id}-qs`}>
            <Input id={`${id}-qs`} type="time" value={minutesToTime(quiet.start)} onChange={(e) => set("quiet_hours", { ...quiet, start: timeToMinutes(e.target.value) ?? quiet.start })} />
          </Field>
          <Field label="To" htmlFor={`${id}-qe`}>
            <Input id={`${id}-qe`} type="time" value={minutesToTime(quiet.end)} onChange={(e) => set("quiet_hours", { ...quiet, end: timeToMinutes(e.target.value) ?? quiet.end })} />
          </Field>
        </div>
      )}
      <Toggle
        checked={draft.ai_line}
        onChange={(v) => set("ai_line", v)}
        label="Say it was prepared with Orbit"
        description={`Ends each cover letter with “${setup.ai_line_text}”`}
      />
      <p className="rounded-xl bg-zinc-100 p-3 text-sm dark:bg-white/5">
        {q.trial
          ? `${q.included} applications free to try (${q.left} left). Only applications that go through are counted.`
          : `${q.included} applications in this period on your plan, ${q.used} used${q.credits ? `, plus ${q.credits} top-up` : ""}. Only applications that go through are counted.`}
      </p>
    </Section>
  );
}

function ConsentStep({ setup, agree, setAgree, draft, set }: { setup: ApplySetup; agree: boolean; setAgree: (v: boolean) => void;
  draft: ApplySetupInput; set: <K extends keyof ApplySetupInput>(key: K, value: ApplySetupInput[K]) => void }) {
  const id = useId();
  return (
    <Section title="Your consent">
      <blockquote className="rounded-xl border-l-4 border-indigo-500 bg-indigo-500/5 p-4 text-sm">{setup.consent_text}</blockquote>
      <label htmlFor={`${id}-agree`} className="flex items-center gap-2 text-sm font-medium">
        <input id={`${id}-agree`} type="checkbox" required className={cx("h-4 w-4", focusRing)} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        I agree
      </label>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        You can pause it or turn it off any time, and every application shows exactly what was sent in your name.
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {draft.execution === "hosted" ? "Orbit can send supported employer applications after you save this setup, including when you close Orbit."
          : "Approved applications wait in Needs you, ready for you to send. Nothing to install."}
      </p>
      {draft.execution === "hosted" && <label className="flex items-start gap-2 rounded-xl border border-indigo-300 p-4 text-sm dark:border-indigo-500/40">
        <input type="checkbox" className={cx("mt-1", focusRing)} checked={!!draft.hosted_consent} onChange={(e) => set("hosted_consent", e.target.checked)} />
        <span><strong className="mb-2 block">I authorise hosted applications</strong>{setup.hosted_consent_text}</span>
      </label>}
    </Section>
  );
}
