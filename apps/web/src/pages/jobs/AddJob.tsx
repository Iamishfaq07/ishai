import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { JobLinkInfo, JobStatus, JobTrackerEntry } from "@orbit/types";
import { ApiError, CircleAlert, Link2, cx, focusRing } from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { STATUS_LABEL, dateInput, fromDateInput } from "./model";
import { Sheet } from "./Sheet";

/** Sites whose job pages need a sign-in or JavaScript, so reading the post itself fails: the link's address is all. */
const UNREADABLE = new Set(["Naukri", "LinkedIn", "Indeed", "Glassdoor", "foundit", "Internshala", "Instahyre", "Cutshort", "Wellfound", "apna"]);
const STATUS_CHOICES: JobStatus[] = ["saved", "applied", "interviewing"];
/** A pasted link worth reading: something with a dot in it, after a pause in typing. */
const LOOKS_LIKE_LINK = /^\S+\.\S{2,}/;
const READ_AFTER_MS = 400;

type Fields = { company: string; title: string; location: string };
const EMPTY: Fields = { company: "", title: "", location: "" };

/**
 * "Add a job you found elsewhere": paste a Naukri, LinkedIn or any job link (its title, company and city are read from
 * the address, POST /v1/jobs/tracker/link, nothing fetched), or type the company and title. A company's own page can
 * also be read for its text (POST /v1/prep/import-link), which can be saved to Documents for interview practice.
 */
export function AddJob({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (entry: JobTrackerEntry) => void }) {
  const formId = useId();
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<JobLinkInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  // What was filled in from the link: replaced when the link changes, unless the user has typed over it.
  const filled = useRef<Fields>(EMPTY);
  const [status, setStatus] = useState<JobStatus>("applied");
  const [applied, setApplied] = useState(() => dateInput(new Date().toISOString()));
  const [interview, setInterview] = useState("");
  const [notes, setNotes] = useState("");
  const [posting, setPosting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saveDoc, setSaveDoc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = useCallback((next: Partial<Fields>) => {
    setFields((cur) => {
      const out = { ...cur };
      for (const key of ["company", "title", "location"] as const) {
        const value = next[key];
        if (value && (!cur[key] || cur[key] === filled.current[key])) out[key] = value;
      }
      filled.current = { ...filled.current, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) };
      return out;
    });
  }, []);

  // Read the link once typing pauses; a newer link makes an older answer moot.
  const asked = useRef(0);
  useEffect(() => {
    const link = url.trim();
    setLinkError(null);
    if (!link || !LOOKS_LIKE_LINK.test(link)) {
      setInfo(null);
      return;
    }
    const n = ++asked.current;
    const t = window.setTimeout(() => {
      setReading(true);
      api
        .jobLinkInfo(link)
        .then((got) => {
          if (n !== asked.current) return;
          setInfo(got);
          fill({ company: got.company, title: got.title, location: got.location });
        })
        .catch((err: unknown) => {
          if (n !== asked.current) return;
          setInfo(null);
          setLinkError(errorText(err));
        })
        .finally(() => {
          if (n === asked.current) setReading(false);
        });
    }, READ_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [url, fill]);

  const reset = () => {
    setUrl("");
    setInfo(null);
    setFields(EMPTY);
    filled.current = EMPTY;
    setStatus("applied");
    setInterview("");
    setNotes("");
    setPosting(null);
    setError(null);
  };

  const readPost = async () => {
    if (!info) return;
    setImporting(true);
    setError(null);
    try {
      const post = await api.importJobLink(info.url);
      fill({ company: post.company ?? "", title: post.title ?? "" });
      setPosting(post.text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setImporting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let documentId: string | undefined;
      if (posting && saveDoc) {
        const doc = await api.createTextDocument({
          title: `${fields.title} — ${fields.company}`.slice(0, 300),
          kind: "job_description",
          text: posting,
        });
        documentId = doc.id;
      }
      const when = status !== "saved" ? fromDateInput(applied) : null;
      const next = status === "interviewing" ? fromDateInput(interview) : null;
      const entry = await api.trackManualJob({
        ...(url.trim() ? { url: url.trim() } : {}),
        company: fields.company.trim(),
        title: fields.title.trim(),
        location: fields.location.trim(),
        status,
        ...(when ? { applied_at: when } : {}),
        ...(next ? { next_at: next } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(documentId ? { document_id: documentId } : {}),
      });
      onAdded(entry);
      // TODO(ws-a): a toast ("Added to your tracker") once the design layer's ToastHost is in.
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "already_tracked" ? `${err.message} Find it in the list.` : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = fields.company.trim().length > 0 && fields.title.trim().length > 0;
  const canRead = info && !info.listing_id && !UNREADABLE.has(info.site) && !posting;
  return (
    <Sheet
      open={open}
      title="Add a job you found elsewhere"
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="flex-1 sm:flex-none" disabled={busy || !ready || Boolean(info?.tracked)}>
            {busy ? "Adding…" : "Add to tracker"}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label="Link to the job (optional)"
          htmlFor="add-url"
          hint="From Naukri, LinkedIn, Indeed, a campus portal or a company's careers page. Orbit reads the job's name from the link itself."
        >
          <Input
            id="add-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="Paste the link: https://www.naukri.com/job-listings-…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div aria-live="polite" className="space-y-2 empty:hidden">
          {reading && <p className="text-xs text-zinc-500 dark:text-zinc-400">Reading the link…</p>}
          {linkError && (
            <p className="flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {linkError}
            </p>
          )}
          {info && !reading && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 font-medium text-zinc-700 dark:text-zinc-200">From {info.site}</span>
              {info.tracked ? (
                <span className="font-medium text-amber-800 dark:text-amber-200">Already on your tracker ({STATUS_LABEL[info.tracked.status]}).</span>
              ) : info.listing_id ? (
                <span className="text-zinc-600 dark:text-zinc-300">This job is in your Jobs AI feed: it's saved with its page.</span>
              ) : info.title || info.company ? (
                <span className="text-zinc-600 dark:text-zinc-300">Filled in from the link: check it below.</span>
              ) : (
                <span className="text-zinc-600 dark:text-zinc-300">The link doesn't say which job it is: type it in below.</span>
              )}
              {canRead && (
                <button type="button" onClick={() => void readPost()} disabled={importing} className={cx("inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400", focusRing)}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> {importing ? "Reading the post…" : "Read the post for its details"}
                </button>
              )}
            </div>
          )}
          {posting && (
            <label className="flex items-start gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-950 dark:text-indigo-100">
              <input type="checkbox" checked={saveDoc} onChange={(e) => setSaveDoc(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600" />
              <span>Got the post. Also save it to Documents, so Practice can ask this job's questions.</span>
            </label>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" htmlFor="add-company">
            <Input id="add-company" required maxLength={200} autoComplete="organization" value={fields.company} onChange={(e) => setFields((f) => ({ ...f, company: e.target.value }))} placeholder="e.g. Infosys" />
          </Field>
          <Field label="Job title" htmlFor="add-title">
            <Input id="add-title" required maxLength={300} value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Systems Engineer" />
          </Field>
        </div>
        <Field label="City (optional)" htmlFor="add-city">
          <Input id="add-city" maxLength={300} value={fields.location} onChange={(e) => setFields((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Pune, or Remote" />
        </Field>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-zinc-800 dark:text-zinc-200">Where it stands</legend>
          <div className="inline-flex gap-0.5 rounded-xl bg-zinc-500/10 p-1">
            {STATUS_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  status === s ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>
        {status !== "saved" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applied on" htmlFor="add-applied">
              <Input id="add-applied" type="date" value={applied} onChange={(e) => setApplied(e.target.value)} />
            </Field>
            {status === "interviewing" && (
              <Field label="Interview on (optional)" htmlFor="add-interview" hint="Your follow-ups show it the day before.">
                <Input id="add-interview" type="date" value={interview} onChange={(e) => setInterview(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        <Field label="Notes (optional)" htmlFor="add-notes">
          <Textarea id="add-notes" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referred by…, HR's name, the next step…" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Sheet>
  );
}
