import { useEffect, useState, type ReactNode } from "react";
import type { JobStatus, LinkedInProfile, NaukriProfile, OutreachInputs, OutreachKind, OutreachMessage, Resume } from "@orbit/types";
import {
  Copy,
  Sparkles,
  KIT_LIMITS,
  KIT_SHOWN_FIRST,
  MESSAGE_WORDS,
  confirmDialog,
  countWords,
  cx,
  focusRing,
  shownFirst,
  skillList,
  toast,
  type MessageKit,
} from "@orbit/ui";
import { Button, Field, Input, Spinner, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { AiCostNote, AiErrorNote, isUpgradeError, useAllowance } from "../resume/allowance";
import { outreachKindFor } from "./model";

/**
 * What Outreach writes (it was Resume AI's "Profiles & outreach" tab): the Naukri and LinkedIn profiles and the
 * job-hunt messages, from one resume and, for messages, one job. Each one written uses a resume credit; what comes
 * back is edited here and copied out. The page around them (pickers, what's kept) is Outreach.tsx.
 */

const KINDS: Array<{ id: OutreachKind; label: string; about: string; details: string }> = [
  {
    id: "referral",
    label: "Referral request",
    about: "For someone who works there: a LinkedIn connection note, and a longer message for LinkedIn or WhatsApp once they accept.",
    details: "e.g. We were batchmates at NIT Trichy",
  },
  {
    id: "cold_email",
    label: "Email to HR",
    about: "A short email to an HR person or a recruiter, with a subject line, for when you send your resume directly.",
    details: "e.g. Serving notice, can join in 30 days",
  },
  {
    id: "follow_up",
    label: "Follow-up",
    about: "A polite nudge a week or two after you applied, asking about next steps.",
    details: "e.g. Applied on 2 October through Naukri",
  },
  {
    id: "thank_you",
    label: "Thank-you note",
    about: "To send the same day as an interview. Say what you talked about below and it'll mention it; otherwise it won't guess.",
    details: "e.g. We talked about moving the reports to Power BI",
  },
];

/** The job post's first line or sentence: usually the title (as the server reads it, resumes/ai.py job_title). */
export function jobTitle(jobText: string): string {
  const first = jobText.trim().split("\n", 1)[0] ?? "";
  return (first.split(/(?<=[.!?])\s/, 1)[0] ?? "").slice(0, 120);
}

/** The job a message is for: from its page in Jobs AI, or from the tracker once the post has left the feed. */
export interface OutreachJob {
  id: string;
  title: string;
  company: string;
  place: string;
  /** Still in the feed: the server reads its posting for the message. */
  live: boolean;
  /** The skills the post asks for. */
  asks: string[];
  status: JobStatus | null;
}

/** One AI call at a time, with its error, the credit note and the allowance refreshed after. */
function useWrite() {
  const { refresh } = useAllowance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const run = async <T,>(work: () => Promise<T>, done: (out: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      done(await work());
    } catch (err) {
      setError({ text: errorText(err), upgrade: isUpgradeError(err) });
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return { busy, error, run };
}

const replaceOk = (what: string) =>
  confirmDialog({ title: "Write a new one?", body: `This replaces the ${what} below, with your edits.`, confirmLabel: "Write a new one" });

function WriteButton({ busy, again, label, disabled = false, onClick }: { busy: boolean; again: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button disabled={busy || disabled} onClick={onClick}>
      <Sparkles className="h-4 w-4" /> {busy ? "Writing…" : again ? "Write a new one" : label}
    </Button>
  );
}

export function NaukriPart({ resume, value, onChange }: { resume: Resume; value: NaukriProfile | undefined; onChange: (v: NaukriProfile) => void }) {
  const { busy, error, run } = useWrite();
  const write = async () => {
    if (value && !(await replaceOk("profile"))) return;
    await run(() => api.naukriProfile(resume.data, resume.job_text), onChange);
  };
  return (
    <>
      <Box title="Naukri profile">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          The resume headline, profile summary and key skills, the parts recruiters search on Naukri. The headline starts with your role, years and strongest skills, because search results show only its first line.
        </p>
        <WriteButton busy={busy} again={Boolean(value)} label="Write my Naukri profile" onClick={() => void write()} />
        <AiCostNote className="mt-2" />
        {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
      </Box>
      {busy && <Spinner label="Writing your Naukri profile" state="composing" />}
      {value && !busy && (
        <Box title="Copy these into Naukri">
          <div className="space-y-4">
            <KitField id="naukri-headline" label="Resume headline" value={value.headline} onChange={(headline) => onChange({ ...value, headline })} chars={KIT_LIMITS.naukriHeadline} rows={3} firstShown={KIT_SHOWN_FIRST.headline} firstNote="Search results show" />
            <KitField id="naukri-summary" label="Profile summary" value={value.summary} onChange={(summary) => onChange({ ...value, summary })} chars={KIT_LIMITS.naukriSummary} rows={8} />
            <SkillsField id="naukri-skills" label="Key skills" skills={value.skills} onChange={(skills) => onChange({ ...value, skills })} most={KIT_LIMITS.naukriSkills} note="All from your resume. Add them one at a time under Key skills on Naukri." />
          </div>
        </Box>
      )}
    </>
  );
}

export function LinkedInPart({ resume, value, onChange }: { resume: Resume; value: LinkedInProfile | undefined; onChange: (v: LinkedInProfile) => void }) {
  const { busy, error, run } = useWrite();
  const write = async () => {
    if (value && !(await replaceOk("profile"))) return;
    await run(() => api.linkedinProfile(resume.data, resume.job_text), onChange);
  };
  return (
    <>
      <Box title="LinkedIn profile">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          A headline, an About section and the five skills to feature. About opens with what you do and your strongest result, because only its first two lines show before “see more”.
        </p>
        <WriteButton busy={busy} again={Boolean(value)} label="Write my LinkedIn profile" onClick={() => void write()} />
        <AiCostNote className="mt-2" />
        {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
      </Box>
      {busy && <Spinner label="Writing your LinkedIn profile" state="composing" />}
      {value && !busy && (
        <Box title="Copy these into LinkedIn">
          <div className="space-y-4">
            <KitField id="linkedin-headline" label="Headline" value={value.headline} onChange={(headline) => onChange({ ...value, headline })} chars={KIT_LIMITS.linkedinHeadline} rows={3} firstShown={KIT_SHOWN_FIRST.headline} firstNote="Search results and invitations show" />
            <KitField id="linkedin-about" label="About" value={value.about} onChange={(about) => onChange({ ...value, about })} chars={KIT_LIMITS.linkedinAbout} rows={12} firstShown={KIT_SHOWN_FIRST.about} firstNote="Before “see more”, people read" />
            <SkillsField id="linkedin-skills" label="Top skills" skills={value.skills} onChange={(skills) => onChange({ ...value, skills })} most={KIT_LIMITS.linkedinSkills} note="All from your resume. On LinkedIn: About → Top skills." />
          </div>
        </Box>
      )}
    </>
  );
}

export function MessagesPart({
  resume,
  jobId,
  job,
  jobLoading,
  slot,
  onSlot,
}: {
  resume: Resume;
  /** The job asked for (`?job=`): its messages are kept apart from the rest. */
  jobId: string | null;
  /** That job, once it's read (null while it loads, or when none is asked for). */
  job: OutreachJob | null;
  jobLoading: boolean;
  slot: MessageKit;
  onSlot: (change: (slot: MessageKit) => MessageKit) => void;
}) {
  const { busy, error, run } = useWrite();
  const [kind, setKind] = useState<OutreachKind>(() => outreachKindFor(job?.status) ?? "referral");
  // A job (another one, or the one asked for once it's read) opens on the message for how far along it is.
  const [kindFor, setKindFor] = useState(job?.id ?? null);
  if (job && kindFor !== job.id) {
    setKindFor(job.id);
    setKind(outreachKindFor(job.status) ?? kind);
  }
  const meta = KINDS.find((k) => k.id === kind) ?? KINDS[0]!;
  const current = slot.messages?.[kind];
  // For a job, its company and role until something's typed for it.
  const inputs: OutreachInputs = slot.inputs ?? (job ? { company: job.company.slice(0, 120), role: job.title.slice(0, 120) } : {});
  const set = (patch: Partial<OutreachInputs>) => onSlot(() => ({ inputs: { ...inputs, ...patch } }));
  const onMessage = (m: OutreachMessage) => onSlot((s) => ({ messages: { ...s.messages, [m.kind]: m } }));
  // The job post pasted on the resume counts only when no job from Jobs AI is asked for.
  const resumeJob = jobId ? "" : resume.job_text;
  const write = async () => {
    if (current && !(await replaceOk("message"))) return;
    const clean = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, (v ?? "").trim()]).filter(([, v]) => v)) as OutreachInputs;
    await run(() => api.outreach(resume.data, resumeJob, kind, clean, job?.live ? job.id : null), onMessage);
  };
  const email = kind !== "referral";
  const titleHint = job ? job.title : resumeJob.trim() ? jobTitle(resumeJob) : "";
  return (
    <>
      <Box title="Messages">
        <div role="group" aria-label="Message" className="mb-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cx(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                kind === k.id ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10",
                focusRing,
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{meta.about}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "thank_you" ? "Interviewer's name" : "Their name"} htmlFor="kit-recipient" hint="Optional">
            <Input id="kit-recipient" maxLength={80} value={inputs.recipient ?? ""} onChange={(e) => set({ recipient: e.target.value })} placeholder="e.g. Priya Sharma" />
          </Field>
          <Field label="Company" htmlFor="kit-company" hint={job ? "From the job post" : "Optional"}>
            <Input id="kit-company" maxLength={120} value={inputs.company ?? ""} onChange={(e) => set({ company: e.target.value })} placeholder={job?.company || "e.g. Flipkart"} />
          </Field>
          <Field label="Role" htmlFor="kit-role" hint={job ? "From the job post" : titleHint ? "Optional: the job post's title otherwise" : "Optional"}>
            <Input id="kit-role" maxLength={120} value={inputs.role ?? ""} onChange={(e) => set({ role: e.target.value })} placeholder={titleHint || "e.g. Data Analyst"} />
          </Field>
          <Field label="Anything to mention" htmlFor="kit-details" hint="Optional, and true: it's used as you write it">
            <Input id="kit-details" maxLength={600} value={inputs.details ?? ""} onChange={(e) => set({ details: e.target.value })} placeholder={meta.details} />
          </Field>
        </div>
        <div className="mt-3">
          <WriteButton busy={busy} disabled={jobLoading} again={Boolean(current)} label={`Write the ${meta.label.toLowerCase()}`} onClick={() => void write()} />
        </div>
        <AiCostNote className="mt-2" />
        {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
      </Box>
      {busy && <Spinner label="Writing your message" state="composing" />}
      {current && !busy && (
        <Box title={meta.label}>
          <div className="space-y-4">
            {kind === "referral" && (
              <KitField id="kit-note" label="LinkedIn connection note" value={current.connection_note} onChange={(connection_note) => onMessage({ ...current, connection_note })} chars={KIT_LIMITS.connectionNote} rows={3} hint="Free accounts allow 200 characters, Premium 300." />
            )}
            {email && <KitField id="kit-subject" label="Subject" value={current.subject} onChange={(subject) => onMessage({ ...current, subject })} chars={KIT_LIMITS.subject} rows={1} />}
            <KitField id="kit-message" label={email ? "Email" : "Message for LinkedIn or WhatsApp"} value={current.message} onChange={(message) => onMessage({ ...current, message })} words={MESSAGE_WORDS[kind]} rows={10} />
          </div>
        </Box>
      )}
    </>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <h2 className="mb-3 font-display text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={!text.trim()}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => toast("Copied"),
          () => toast({ message: "Couldn't copy", tone: "error" }),
        )
      }
    >
      <Copy className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}

/** A text the site limits by characters (`chars`) or words (`words`), with its count, what shows first, and Copy. */
function KitField({
  id,
  label,
  value,
  onChange,
  chars,
  words,
  rows,
  firstShown,
  firstNote,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  chars?: number;
  words?: number;
  rows: number;
  firstShown?: number;
  firstNote?: string;
  hint?: string;
}) {
  const used = chars ? value.length : countWords(value);
  const limit = chars ?? words ?? 0;
  const over = limit > 0 && used > limit;
  const first = firstShown ? shownFirst(value, firstShown) : "";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className={cx("text-xs tabular-nums", over ? "font-medium text-rose-600" : "text-zinc-500 dark:text-zinc-400")}>
            {used.toLocaleString("en-IN")}/{limit.toLocaleString("en-IN")} {chars ? "characters" : "words"}
          </span>
          <CopyButton text={value} />
        </div>
      </div>
      {rows === 1 ? (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {over && <p className="mt-1 text-xs text-rose-600">Over the limit: the site would cut the end off. Shorten it a little.</p>}
      {first && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {firstNote ?? "Shown first"}: <span className="text-zinc-700 dark:text-zinc-300">“{first}…”</span>
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Skills as tags, edited as one comma-separated line; Copy gives that line. */
function SkillsField({ id, label, skills, onChange, most, note }: { id: string; label: string; skills: string[]; onChange: (v: string[]) => void; most: number; note: string }) {
  const [text, setText] = useState(skills.join(", "));
  useEffect(() => {
    // A new set from the AI replaces what's typed; the user's own typing doesn't bounce back through here.
    if (skillList(text).join("|") !== skills.join("|")) setText(skills.join(", "));
  }, [skills]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the skills change from outside
  const list = skillList(text);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className={cx("text-xs tabular-nums", list.length > most ? "font-medium text-rose-600" : "text-zinc-500 dark:text-zinc-400")}>
            {list.length} of {most}
          </span>
          <CopyButton text={list.join(", ")} />
        </div>
      </div>
      <Input
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(skillList(e.target.value));
        }}
      />
      {list.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={label}>
          {list.map((s) => (
            <li key={s} className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs text-indigo-900 ring-1 ring-indigo-500/20 dark:text-indigo-200">
              {s}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>
    </div>
  );
}
