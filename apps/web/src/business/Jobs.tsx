// Orbit for Business (D82): the job editor (description, place, pay, screening questions with
// knock-outs, stages, hiring team) with the Orbit assistant beside it (D85: a few words fill every field, short
// instructions refine them, each AI-filled field marked with its own undo). Publishing needs a verified company and a
// free job slot.
import { Suspense, lazy, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  BizAssistField,
  BizEmploymentType,
  BizExperience,
  BizJob,
  BizJobAssist,
  BizJobInput,
  BizMember,
  BizQuestion,
  BizQuestionKind,
  BizSalaryPeriod,
  BizStage,
  BizStageKind,
  BizWorkplace,
} from "@orbit/types";
import {
  ChevronRight,
  ChevronLeft,
  Button,
  Callout,
  Checkbox,
  Dialog,
  ExternalLink,
  Field,
  Input,
  Plus,
  Select,
  Sparkles,
  Textarea,
  Trash2,
  buttonClass,
  confirmDialog,
  cx,
  focusRing,
  toast,
  safeLocal,
  useMediaQuery,
} from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import {
  EMPLOYMENT_LABEL,
  EXPERIENCE_LABEL,
  PERIOD_LABEL,
  QUESTION_KIND_LABEL,
  ROLE_LABEL,
  STAGE_KIND_LABEL,
  WORKPLACE_LABEL,
  describeKnockout,
  emptyJob,
  jobPath,
  knockoutForm,
  knockoutRule,
  moveItem,
  newId,
  newQuestion,
  questionProblems,
  stageProblems,
  type KnockoutForm,
} from "./model";
import { sanitizeHtml } from "./richText";
import {
  FIELD_LABEL,
  applyAssist,
  collect,
  current,
  editorState,
  emptyPanel,
  fieldOf,
  touch,
  undoAll,
  undoField,
  type EditorState,
  type Marks,
  type PanelState,
} from "./assist";

const JobAssistant = lazy(async () => ({ default: (await import("./JobAssistant")).JobAssistant }));
import { JobStatusBadge, Loading, LoadError, Panel, errorCode, errorText } from "./ui";

// ---- the rich text editor -----------------------------------------------------------------------------------------

function RichText({ labelId, value, onChange }: { labelId: string; value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  // Uncontrolled: what the toolbar and typing make stays put; a new value from outside (a draft) replaces it.
  useEffect(() => {
    if (ref.current && value !== shown.current) {
      ref.current.innerHTML = sanitizeHtml(value);
      shown.current = value;
    }
  }, [value]);
  const emit = () => {
    if (!ref.current) return;
    const html = sanitizeHtml(ref.current.innerHTML);
    shown.current = html;
    onChange(html);
  };
  const cmd = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };
  const link = () => {
    const url = window.prompt("Link address (https://…)");
    if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) cmd("createLink", url.trim());
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      link();
    }
  };
  const tools: Array<{ label: string; text: string; run: () => void; className?: string }> = [
    { label: "Bold (Ctrl+B)", text: "B", run: () => cmd("bold"), className: "font-bold" },
    { label: "Italic (Ctrl+I)", text: "I", run: () => cmd("italic"), className: "italic" },
    { label: "Heading", text: "H", run: () => cmd("formatBlock", "h3") },
    { label: "Paragraph", text: "¶", run: () => cmd("formatBlock", "p") },
    { label: "Bullets", text: "Bullets", run: () => cmd("insertUnorderedList") },
    { label: "Numbered", text: "Numbered", run: () => cmd("insertOrderedList") },
    { label: "Link (Ctrl+K)", text: "Link", run: link },
  ];
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/10">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1 border-b border-zinc-200 p-1.5 dark:border-white/10">
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            aria-label={t.label}
            title={t.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.run}
            className={cx("h-8 min-w-8 rounded-md px-2 text-sm hover:bg-zinc-100 dark:hover:bg-white/10", t.className, focusRing)}
          >
            {t.text}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onInput={emit}
        onBlur={emit}
        onKeyDown={keys}
        className={cx("biz-prose min-h-[14rem] px-3.5 py-2.5 text-sm leading-relaxed outline-none", focusRing)}
      />
    </div>
  );
}

// ---- screening questions ------------------------------------------------------------------------------------------

function QuestionEditor({ q, index, count, onChange, onRemove, onMove }: { q: BizQuestion; index: number; count: number; onChange: (q: BizQuestion) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  const id = useId();
  const [ko, setKo] = useState<KnockoutForm>(() => knockoutForm(q));
  const setRule = (next: KnockoutForm, choices = q.choices ?? []) => {
    setKo(next);
    onChange({ ...q, knockout: knockoutRule(q.kind, next, choices) });
  };
  const choices = q.choices ?? [];
  return (
    <fieldset className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <legend className="px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Question {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Question" htmlFor={`${id}-t`}>
          <Input id={`${id}-t`} value={q.text} maxLength={300} onChange={(e) => onChange({ ...q, text: e.target.value })} />
        </Field>
        <Field label="Answer type" htmlFor={`${id}-k`}>
          <Select
            id={`${id}-k`}
            value={q.kind}
            onChange={(e) => {
              const kind = e.target.value as BizQuestionKind;
              const next: BizQuestion = { ...q, kind, knockout: null, ...(kind === "choice" ? { choices: choices.length ? choices : ["", ""] } : {}) };
              if (kind !== "choice") delete next.choices;
              setKo({ ...ko, on: false });
              onChange(next);
            }}
          >
            {(Object.keys(QUESTION_KIND_LABEL) as BizQuestionKind[]).map((k) => (
              <option key={k} value={k}>
                {QUESTION_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.kind === "choice" && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">Choices</p>
          {choices.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Choice ${i + 1}`}
                value={c}
                maxLength={120}
                onChange={(e) => {
                  const next = choices.map((x, j) => (j === i ? e.target.value : x));
                  onChange({ ...q, choices: next, knockout: knockoutRule(q.kind, ko, next) });
                }}
              />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove choice ${i + 1}`} disabled={choices.length <= 2} onClick={() => onChange({ ...q, choices: choices.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" disabled={choices.length >= 10} onClick={() => onChange({ ...q, choices: [...choices, ""] })}>
            Add a choice
          </Button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Checkbox label="Required" checked={q.required} onChange={(e) => onChange({ ...q, required: e.target.checked })} />
        {q.kind !== "short_text" && <Checkbox label="Knock-out rule" description="Answers that don't meet it are flagged and sorted last. Nobody is rejected automatically." checked={ko.on} onChange={(e) => setRule({ ...ko, on: e.target.checked })} />}
      </div>
      {ko.on && q.kind === "yes_no" && (
        <div className="mt-2 w-48">
          <Field label="Passing answer" htmlFor={`${id}-eq`}>
            <Select id={`${id}-eq`} value={ko.equals} onChange={(e) => setRule({ ...ko, equals: e.target.value as "yes" | "no" })}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
        </div>
      )}
      {ko.on && q.kind === "choice" && (
        <fieldset className="mt-2">
          <legend className="text-sm">Passing choices</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {choices.filter((c) => c.trim()).map((c) => (
              <Checkbox key={c} label={c} checked={ko.anyOf.includes(c)} onChange={(e) => setRule({ ...ko, anyOf: e.target.checked ? [...ko.anyOf, c] : ko.anyOf.filter((x) => x !== c) })} />
            ))}
          </div>
        </fieldset>
      )}
      {ko.on && q.kind === "number" && (
        <div className="mt-2 grid w-80 grid-cols-2 gap-2">
          <Field label="At least" htmlFor={`${id}-min`}>
            <Input id={`${id}-min`} type="number" value={ko.min} onChange={(e) => setRule({ ...ko, min: e.target.value })} />
          </Field>
          <Field label="At most" htmlFor={`${id}-max`}>
            <Input id={`${id}-max`} type="number" value={ko.max} onChange={(e) => setRule({ ...ko, max: e.target.value })} />
          </Field>
        </div>
      )}
      {q.knockout && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">Knock-out: {describeKnockout(q.kind, q.knockout)}</p>}
      <div className="mt-3 flex gap-1">
        <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronLeft className="h-4 w-4 rotate-90" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
          <ChevronRight className="h-4 w-4 rotate-90" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden /> Remove
        </Button>
      </div>
    </fieldset>
  );
}

function StagesEditor({ stages, onChange }: { stages: BizStage[]; onChange: (s: BizStage[]) => void }) {
  const problems = stageProblems(stages);
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-right text-xs tabular-nums text-zinc-500">{i + 1}.</span>
            <Input aria-label={`Stage ${i + 1} name`} className="!w-56" value={s.name} maxLength={40} onChange={(e) => onChange(stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Select aria-label={`Stage ${i + 1} kind`} className="!w-36" value={s.kind} disabled={s.kind === "applied" || s.kind === "rejected"} onChange={(e) => onChange(stages.map((x, j) => (j === i ? { ...x, kind: e.target.value as BizStageKind } : x)))}>
              {(Object.keys(STAGE_KIND_LABEL) as BizStageKind[]).map((k) => (
                <option key={k} value={k} disabled={(k === "applied" || k === "rejected") && s.kind !== k}>
                  {STAGE_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="sm" aria-label={`Move ${s.name || "stage"} up`} disabled={i === 0} onClick={() => onChange(moveItem(stages, i, i - 1))}>
              <ChevronLeft className="h-4 w-4 rotate-90" aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Move ${s.name || "stage"} down`} disabled={i === stages.length - 1} onClick={() => onChange(moveItem(stages, i, i + 1))}>
              <ChevronRight className="h-4 w-4 rotate-90" aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${s.name || "stage"}`} disabled={s.kind === "applied" || s.kind === "rejected"} onClick={() => onChange(stages.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <Button type="button" variant="secondary" size="sm" disabled={stages.length >= 12} onClick={() => {
        const at = Math.max(1, stages.findIndex((s) => s.kind === "hired"));
        const next = [...stages];
        next.splice(at, 0, { id: newId("s"), name: "", kind: "interview" });
        onChange(next);
      }}>
        Add a stage
      </Button>
      {problems.length > 0 && <p className="text-xs text-rose-700 dark:text-rose-300">{problems.join(" ")}</p>}
    </div>
  );
}

// ---- the editor ---------------------------------------------------------------------------------------------------

const toInput = (j: BizJob): BizJobInput => ({
  title: j.title,
  description_html: j.description_html,
  department: j.department,
  locations: j.locations,
  workplace: j.workplace,
  allowed_countries: j.allowed_countries,
  employment_type: j.employment_type,
  experience: j.experience,
  salary_min: j.salary_min,
  salary_max: j.salary_max,
  salary_currency: j.salary_currency,
  salary_period: j.salary_period,
  show_salary: j.show_salary,
  must_haves: j.must_haves,
  nice_to_haves: j.nice_to_haves,
  questions: j.questions,
  stages: j.stages,
  hiring_team: j.hiring_team,
  valid_through: j.valid_through,
});

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];
const ASSISTANT_KEY = "orbit.biz.assistant";

/** A field the assistant filled: a quiet indigo ring and an "AI · Undo" mark until the person edits it. */
function AiMark({ field, marks, onUndo, children, className }: { field: BizAssistField; marks: Marks; onUndo: (f: BizAssistField) => void; children: ReactNode; className?: string }) {
  const on = field in marks;
  return (
    <div className={cx("relative rounded-lg transition-shadow", on && "-mx-2 bg-indigo-50/60 px-2 py-1.5 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-400/30", className)} data-ai-field={on ? field : undefined}>
      {children}
      {on && (
        <span className="absolute -top-3 right-0 z-[1] inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white py-0.5 pl-2 pr-0.5 text-xs font-medium text-indigo-700 dark:border-indigo-400/30 dark:bg-zinc-900 dark:text-indigo-300">
          <Sparkles className="h-3 w-3" aria-hidden /> AI
          <button type="button" onClick={() => onUndo(field)} aria-label={`Undo the AI's ${FIELD_LABEL[field]}`} className={cx("rounded-full px-1.5 hover:bg-zinc-100 dark:hover:bg-white/10", focusRing)}>
            Undo
          </button>
        </span>
      )}
    </div>
  );
}

export function JobEditor() {
  const { company } = useCompany();
  const { jid } = useParams();
  const navigate = useNavigate();
  const id = useId();
  const [job, setJob] = useState<BizJob | null>(null);
  const [ed, setEd] = useState<EditorState>(() => editorState(emptyJob()));
  const [marks, setMarks] = useState<Marks>({});
  const [panel, setPanel] = useState<PanelState>(emptyPanel);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [docked, setDocked] = useState(() => safeLocal.getItem(ASSISTANT_KEY) !== "closed");
  const [sheet, setSheet] = useState(false);
  const [members, setMembers] = useState<BizMember[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // The panel answers after a network round trip: it reads and writes the latest editor state, not a stale render's.
  const edRef = useRef(ed);
  edRef.current = ed;
  const marksRef = useRef(marks);
  marksRef.current = marks;

  useEffect(() => {
    biz.members(company.id).then((m) => setMembers(m.members)).catch(() => undefined);
    if (!jid) return;
    biz
      .job(company.id, jid)
      .then((j) => {
        setJob(j);
        setEd(editorState(toInput(j)));
        setMarks({});
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id, jid]);

  if (loadError) return <LoadError error={loadError} />;
  if (jid && !job) return <Loading />;
  const canEdit = company.permissions.manage_jobs && company.status === "active";
  const form = ed.form;
  const set = <K extends keyof BizJobInput>(k: K, v: BizJobInput[K]) => {
    setEd((s) => ({ ...s, form: { ...s.form, [k]: v } }));
    const f = fieldOf(k);
    if (f) setMarks((m) => touch(m, f));
  };
  const setText = (key: "locText" | "countriesText" | "mustText" | "niceText", f: BizAssistField) => (v: string) => {
    setEd((s) => ({ ...s, [key]: v }));
    setMarks((m) => touch(m, f));
  };
  const undo = (f: BizAssistField) => {
    const r = undoField(edRef.current, marksRef.current, f);
    setEd(r.state);
    setMarks(r.marks);
  };
  const onAnswer = (a: BizJobAssist, kind: "fill" | "refine") => {
    const r = applyAssist(edRef.current, a, marksRef.current, kind);
    edRef.current = r.state;
    marksRef.current = r.marks;
    setEd(r.state);
    setMarks(r.marks);
    return r;
  };
  const undoEverything = () => {
    const r = undoAll(edRef.current, marksRef.current);
    setEd(r.state);
    setMarks(r.marks);
    toast({ message: "Undone: the form is back to what it was before Orbit filled it.", tone: "success" });
  };
  const dock = (open: boolean) => {
    setDocked(open);
    safeLocal.setItem(ASSISTANT_KEY, open ? "open" : "closed");
  };

  const check = (input: BizJobInput): string[] => {
    const out: string[] = [];
    if (!input.title.trim()) out.push("Add the job title.");
    if (input.workplace !== "remote" && input.locations.length === 0) out.push("Add where the job is, or make it remote.");
    if (input.salary_min != null && input.salary_max != null && input.salary_min > input.salary_max) out.push("The salary's minimum is more than its maximum.");
    return [...out, ...questionProblems(input.questions), ...stageProblems(input.stages ?? [])];
  };

  const save = async (then?: "publish"): Promise<BizJob | null> => {
    const input = collect(ed);
    const p = check(input);
    setProblems(p);
    if (p.length) return null;
    setBusy(then ?? "save");
    setError(null);
    try {
      let saved = job ? await biz.updateJob(company.id, job.id, input) : await biz.createJob(company.id, input);
      if (then === "publish") saved = await biz.jobAction(company.id, saved.id, "publish");
      setJob(saved);
      setMarks({});
      toast({ message: then === "publish" ? "Published. It's on your careers page now." : "Saved", tone: "success" });
      if (!jid) navigate(jobPath(company.id, saved.id, "edit"), { replace: true });
      return saved;
    } catch (e) {
      const code = errorCode(e);
      setError(code === "biz_unverified" ? "Verify your company first: unverified companies can save drafts but not publish." : code === "biz_limit" ? `${errorText(e)} See Plan to upgrade.` : errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: "pause" | "close" | "reopen" | "publish") => {
    if (!job) return;
    if (action === "close" && !(await confirmDialog({ title: "Close this job?", body: "It comes off your careers page and Google. Applicants stay in the pipeline.", confirmLabel: "Close job", danger: true }))) return;
    setBusy(action);
    setError(null);
    try {
      setJob(await biz.jobAction(company.id, job.id, action));
      toast({ message: { pause: "Paused", close: "Closed", reopen: "Reopened", publish: "Published" }[action], tone: "success" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const showDocked = canEdit && wide && docked;
  const assistant = (onClose: () => void, closeLabel: string, inSheet = false) => (
    <Suspense fallback={<Loading />}>
      <JobAssistant
        companyId={company.id}
        panel={panel}
        setPanel={setPanel}
        getCurrent={() => current(edRef.current)}
        onAnswer={onAnswer}
        marked={Object.keys(marks).length}
        onUndoAll={undoEverything}
        salaryMissing={form.salary_min == null && form.salary_max == null}
        disabled={!canEdit}
        onClose={onClose}
        closeLabel={closeLabel}
        inSheet={inSheet}
      />
    </Suspense>
  );
  const mark = { marks, onUndo: undo };

  return (
    <div className={cx(showDocked && "lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
        className="min-w-0 space-y-5"
      >
        <PageTitle
          title={job ? `Edit: ${job.title}` : "New job"}
          subtitle={job ? <span className="inline-flex items-center gap-2">
            <JobStatusBadge status={job.status} />
            {job.status === "open" && (
              <a href={job.public_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline">
                See it live <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </span> : "Saved as a draft until you publish it."}
          actions={
            <>
              {job && (
                <Link to={jobPath(company.id, job.id)} className={buttonClass("secondary")}>
                  Applicants
                </Link>
              )}
              {canEdit && !showDocked && (
                <Button type="button" variant="secondary" onClick={() => (wide ? dock(true) : setSheet(true))}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {wide ? "Show assistant" : "Fill with AI"}
                </Button>
              )}
            </>
          }
        />
        {job?.taken_down_reason && <Callout tone="error" title="The Orbit team took this job down">{job.taken_down_reason}</Callout>}
        {!canEdit && <Callout tone="info">You can read this job; only owners, admins and recruiters can change it.</Callout>}

        <fieldset disabled={!canEdit} className="space-y-5">
          <Panel title="The job">
            <div className="grid gap-4 sm:grid-cols-2">
              <AiMark field="title" {...mark}>
                <Field label="Job title" htmlFor={`${id}-title`} required>
                  <Input id={`${id}-title`} value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value)} />
                </Field>
              </AiMark>
              <AiMark field="department" {...mark}>
                <Field label="Department (optional)" htmlFor={`${id}-dep`}>
                  <Input id={`${id}-dep`} value={form.department ?? ""} maxLength={80} onChange={(e) => set("department", e.target.value)} />
                </Field>
              </AiMark>
            </div>
            <AiMark field="description" {...mark} className="mt-5 space-y-1.5">
              <p id={`${id}-desc`} className="text-sm font-medium">
                Description
              </p>
              <RichText labelId={`${id}-desc`} value={form.description_html} onChange={(html) => set("description_html", html)} />
            </AiMark>
          </Panel>

          <Panel title="Where and how">
            <div className="grid gap-4 sm:grid-cols-3">
              <AiMark field="workplace" {...mark}>
                <Field label="Workplace" htmlFor={`${id}-wp`}>
                  <Select id={`${id}-wp`} value={form.workplace} onChange={(e) => set("workplace", e.target.value as BizWorkplace)}>
                    {(Object.keys(WORKPLACE_LABEL) as BizWorkplace[]).map((w) => (
                      <option key={w} value={w}>
                        {WORKPLACE_LABEL[w]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </AiMark>
              <AiMark field="employment_type" {...mark}>
                <Field label="Employment type" htmlFor={`${id}-et`}>
                  <Select id={`${id}-et`} value={form.employment_type} onChange={(e) => set("employment_type", e.target.value as BizEmploymentType)}>
                    {(Object.keys(EMPLOYMENT_LABEL) as BizEmploymentType[]).map((w) => (
                      <option key={w} value={w}>
                        {EMPLOYMENT_LABEL[w]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </AiMark>
              <AiMark field="experience" {...mark}>
                <Field label="Experience" htmlFor={`${id}-ex`}>
                  <Select id={`${id}-ex`} value={form.experience} onChange={(e) => set("experience", e.target.value as BizExperience)}>
                    {(Object.keys(EXPERIENCE_LABEL) as BizExperience[]).map((w) => (
                      <option key={w} value={w}>
                        {EXPERIENCE_LABEL[w]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </AiMark>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <AiMark field="locations" {...mark}>
                <Field label="Locations" htmlFor={`${id}-loc`} hint="One per line: city, country.">
                  <Textarea id={`${id}-loc`} rows={2} value={ed.locText} onChange={(e) => setText("locText", "locations")(e.target.value)} />
                </Field>
              </AiMark>
              {form.workplace === "remote" && (
                <AiMark field="allowed_countries" {...mark}>
                  <Field label="Remote: who can apply" htmlFor={`${id}-ac`} hint="Country codes, comma-separated (IN, US). Empty: anywhere.">
                    <Input id={`${id}-ac`} value={ed.countriesText} onChange={(e) => setText("countriesText", "allowed_countries")(e.target.value)} />
                  </Field>
                </AiMark>
              )}
            </div>
          </Panel>

          <Panel title="Pay" hint="A range helps people decide, and Google for Jobs shows it.">
            <AiMark field="salary" {...mark}>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="From" htmlFor={`${id}-smin`}>
                  <Input id={`${id}-smin`} type="number" min={0} value={form.salary_min ?? ""} onChange={(e) => set("salary_min", e.target.value === "" ? null : Number(e.target.value))} />
                </Field>
                <Field label="To" htmlFor={`${id}-smax`}>
                  <Input id={`${id}-smax`} type="number" min={0} value={form.salary_max ?? ""} onChange={(e) => set("salary_max", e.target.value === "" ? null : Number(e.target.value))} />
                </Field>
                <Field label="Currency" htmlFor={`${id}-cur`}>
                  <Select id={`${id}-cur`} value={form.salary_currency ?? "INR"} onChange={(e) => set("salary_currency", e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Per" htmlFor={`${id}-per`}>
                  <Select id={`${id}-per`} value={form.salary_period ?? "year"} onChange={(e) => set("salary_period", e.target.value as BizSalaryPeriod)}>
                    {(Object.keys(PERIOD_LABEL) as BizSalaryPeriod[]).map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABEL[p].replace("per ", "")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Checkbox className="mt-3" label="Show the pay on the job page" checked={form.show_salary} onChange={(e) => set("show_salary", e.target.checked)} />
            </AiMark>
          </Panel>

          <Panel title="What you're looking for" hint="Orbit's ranking checks each applicant against these and shows its evidence. It only sorts; your team decides.">
            <div className="grid gap-4 sm:grid-cols-2">
              <AiMark field="must_haves" {...mark}>
                <Field label="Must-haves" htmlFor={`${id}-must`} hint="One per line.">
                  <Textarea id={`${id}-must`} rows={5} value={ed.mustText} onChange={(e) => setText("mustText", "must_haves")(e.target.value)} />
                </Field>
              </AiMark>
              <AiMark field="nice_to_haves" {...mark}>
                <Field label="Nice to have" htmlFor={`${id}-nice`} hint="One per line.">
                  <Textarea id={`${id}-nice`} rows={5} value={ed.niceText} onChange={(e) => setText("niceText", "nice_to_haves")(e.target.value)} />
                </Field>
              </AiMark>
            </div>
          </Panel>

          <Panel title="Screening questions" hint="Asked when someone applies. Knock-out answers are flagged, never rejected automatically.">
            <AiMark field="questions" {...mark} className="space-y-3">
              {form.questions.map((q, i) => (
                <QuestionEditor
                  key={q.id}
                  q={q}
                  index={i}
                  count={form.questions.length}
                  onChange={(next) => set("questions", form.questions.map((x) => (x.id === q.id ? next : x)))}
                  onRemove={() => set("questions", form.questions.filter((x) => x.id !== q.id))}
                  onMove={(dir) => set("questions", moveItem(form.questions, i, i + dir))}
                />
              ))}
              <Button type="button" variant="secondary" size="sm" disabled={form.questions.length >= 15} onClick={() => set("questions", [...form.questions, newQuestion()])}>
                <Plus className="h-4 w-4" aria-hidden /> Add a question
              </Button>
            </AiMark>
          </Panel>

          <Panel title="Stages" hint="The steps an applicant moves through for this job.">
            <AiMark field="stages" {...mark}>
              <StagesEditor stages={form.stages ?? []} onChange={(s) => set("stages", s)} />
            </AiMark>
          </Panel>

          <Panel title="Hiring team" hint="Hiring managers see only the jobs they're on.">
            {members.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Invite teammates in Team first.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {members.map((m) => (
                  <Checkbox
                    key={m.user_id}
                    label={`${m.name || m.email}${m.you ? " (you)" : ""}`}
                    description={ROLE_LABEL[m.role]}
                    checked={(form.hiring_team ?? []).includes(m.user_id)}
                    onChange={(e) => set("hiring_team", e.target.checked ? [...(form.hiring_team ?? []), m.user_id] : (form.hiring_team ?? []).filter((x) => x !== m.user_id))}
                  />
                ))}
              </div>
            )}
          </Panel>
        </fieldset>

        {problems.length > 0 && (
          <Callout tone="error" title="Fix these to save">
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        )}
        {error && <Callout tone="error">{error}</Callout>}

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-b-xl lg:px-4">
            <Button type="submit" loading={busy === "save"}>
              {job ? "Save" : "Save draft"}
            </Button>
            {(!job || job.status === "draft") && (
              <Button type="button" variant="secondary" loading={busy === "publish"} disabled={!company.verified} disabledReason="Verify your company to publish jobs." onClick={() => void save("publish")}>
                Save and publish
              </Button>
            )}
            {job?.status === "open" && (
              <Button type="button" variant="secondary" loading={busy === "pause"} onClick={() => void act("pause")}>
                Pause
              </Button>
            )}
            {job && (job.status === "paused" || job.status === "closed") && (
              <Button type="button" variant="secondary" loading={busy === "reopen"} disabled={!company.verified} onClick={() => void act("reopen")}>
                Reopen
              </Button>
            )}
            {job && job.status !== "closed" && job.status !== "draft" && (
              <Button type="button" variant="ghost" loading={busy === "close"} onClick={() => void act("close")}>
                Close job
              </Button>
            )}
            {Object.keys(marks).length > 0 && <span className="text-xs text-indigo-700 dark:text-indigo-300">{Object.keys(marks).length} AI-filled field{Object.keys(marks).length === 1 ? "" : "s"} to review</span>}
          </div>
        )}
      </form>
      {showDocked && (
        <aside aria-label="Orbit assistant" className="sticky top-[4.5rem] mt-0 max-h-[calc(100vh-5.5rem)] overflow-y-auto overscroll-contain">
          {assistant(() => dock(false), "Hide")}
        </aside>
      )}
      {canEdit && !wide && (
        <Dialog open={sheet} onClose={() => setSheet(false)} title="Orbit assistant" size="lg">
          {assistant(() => setSheet(false), "Back to the form", true)}
        </Dialog>
      )}
    </div>
  );
}
