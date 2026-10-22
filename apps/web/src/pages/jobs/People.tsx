import { useEffect, useState, type FormEvent } from "react";
import type { JobContact, JobContactInput, JobContactRelation, JobTrackerEntry } from "@orbit/types";
import {
  ArrowUpRight,
  CalendarIcon,
  Check,
  Mail,
  PenLine,
  Phone,
  Plus,
  Trash2,
  Users,
  LoadGate,
  confirmDialog,
  cx,
  focusRing,
  CosmicEmptyState,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { contactsCsv, dateInput, followUpState, fromDateInput, safeUrl, shortDate } from "./model";

export const RELATIONS: Array<{ id: JobContactRelation; label: string }> = [
  { id: "referral", label: "Referral" },
  { id: "recruiter", label: "Recruiter / HR" },
  { id: "hiring_manager", label: "Hiring manager" },
  { id: "alum", label: "Alum / senior" },
  { id: "interviewer", label: "Interviewer" },
  { id: "mentor", label: "Mentor" },
  { id: "other", label: "Other" },
];
const relationLabel = (r: JobContactRelation) => RELATIONS.find((x) => x.id === r)?.label ?? "Other";

const EMPTY: JobContactInput = { name: "", company: "", title: "", relation: "referral", notes: "" };

/**
 * Jobs AI → Outreach → People: referrers, recruiters, alumni and hiring managers you're in touch with, and when to
 * follow up with each (orbit_api/job_portal/contacts.py). Whoever is due comes first; "I got in touch" sets the next
 * follow-up a week out.
 */
export function PeopleSection({ revision = 0 }: { revision?: number }) {
  const contacts = useAsync(() => api.jobContacts(), [revision], "job-contacts");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const [editing, setEditing] = useState<{ id: string | null; initial: JobContactInput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = contacts.data ?? [];
  // Home's "Follow up with…" links here as /jobs/outreach#people: bring the section into view once it's loaded.
  const loaded = Boolean(contacts.data);
  useEffect(() => {
    if (loaded && window.location.hash === "#people") {
      document.getElementById("people")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
      });
    }
  }, [loaded]);

  const save = async (input: JobContactInput) => {
    setError(null);
    try {
      if (editing?.id) await api.updateJobContact(editing.id, input);
      else await api.addJobContact(input);
      setEditing(null);
      contacts.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const act = async (c: JobContact, run: () => Promise<unknown>) => {
    setBusy(c.id);
    setError(null);
    try {
      await run();
      contacts.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (c: JobContact) => {
    const ok = await confirmDialog({
      title: `Remove ${c.name}?`,
      body: "They come off your people with their notes. Nothing is sent to them.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await act(c, () => api.deleteJobContact(c.id));
  };
  const due = list.filter((c) => {
    const s = followUpState(c.follow_up_at);
    return s === "overdue" || s === "today";
  }).length;

  return (
    <section id="people" aria-labelledby="people-title" className="mt-10 scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="people-title" className="flex items-center gap-2 font-display text-lg font-semibold">
            <Users className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden />
            People
            {due > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                {due} to follow up
              </span>
            )}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Referrers, recruiters and alumni you're in touch with, and when to follow up. Most jobs come through people.
          </p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {(contacts.data?.length ?? 0) > 0 && <Button size="sm" variant="secondary"
              onClick={() => downloadText(`orbit-people-${dateInput(new Date().toISOString())}.csv`, contactsCsv(contacts.data ?? []), "text/csv;charset=utf-8")}>
              Export CSV</Button>}
            <Button size="sm" onClick={() => setEditing({ id: null, initial: EMPTY })}>
              <Plus className="h-4 w-4" /> Add a person
            </Button>
          </div>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {editing && (
        <ContactForm
          key={editing.id ?? "new"}
          initial={editing.initial}
          jobs={tracker.data ?? []}
          heading={editing.id ? `Edit ${editing.initial.name}` : "Add a person"}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}

      {contacts.loading && !contacts.data ? (
        <LoadGate loading variant="card" count={2} label="Loading people">{null}</LoadGate>
      ) : contacts.error && !contacts.data ? (
        <ErrorNote onRetry={contacts.reload}>{errorText(contacts.error)}</ErrorNote>
      ) : contacts.data && !list.length && !editing ? (
        <CosmicEmptyState
          variant="people"
          title="No one yet"
          body="Add the senior who offered a referral, the recruiter who called, or an alum at a company you like. Orbit reminds you when to follow up."
          action={
            <Button onClick={() => setEditing({ id: null, initial: EMPTY })}>
              <Plus className="h-4 w-4" /> Add a person
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <PersonCard
                contact={c}
                busy={busy === c.id}
                onTouched={() => void act(c, () => api.jobContactTouched(c.id))}
                onEdit={() => {
                  setEditing({ id: c.id, initial: toInput(c) });
                  document.getElementById("people-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                onDelete={() => void remove(c)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function toInput(c: JobContact): JobContactInput {
  return {
    name: c.name,
    company: c.company,
    title: c.title,
    relation: c.relation,
    linkedin_url: c.linkedin_url,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    application_id: c.application_id,
    follow_up_at: c.follow_up_at,
  };
}

function PersonCard({ contact: c, busy, onTouched, onEdit, onDelete }: {
  contact: JobContact;
  busy: boolean;
  onTouched: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const state = followUpState(c.follow_up_at);
  const linkedin = c.linkedin_url ? safeUrl(c.linkedin_url) : null;
  const iconLink = cx("rounded-md p-1.5 text-zinc-500 hover:bg-indigo-500/10 hover:text-indigo-600 dark:text-zinc-400", focusRing);
  return (
    <Card className="flex h-full flex-col gap-2">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-100">
          {c.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {[c.title, c.company].filter(Boolean).join(" at ") || relationLabel(c.relation)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {relationLabel(c.relation)}
        </span>
      </div>
      {c.application_label && <p className="text-xs text-zinc-600 dark:text-zinc-300">About: {c.application_label}</p>}
      {c.notes && <p className="line-clamp-2 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300">{c.notes}</p>}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {state && (
          <span
            className={cx(
              "inline-flex items-center gap-1 font-medium",
              state === "later" ? "text-zinc-600 dark:text-zinc-300" : "text-amber-700 dark:text-amber-300",
            )}
          >
            <CalendarIcon className="h-3 w-3" aria-hidden />
            {state === "overdue" ? `Follow-up overdue · ${shortDate(c.follow_up_at)}` : state === "today" ? "Follow up today" : `Follow up ${shortDate(c.follow_up_at)}`}
          </span>
        )}
        {c.last_contacted_at && <span className="text-zinc-500 dark:text-zinc-400">Last in touch {shortDate(c.last_contacted_at)}</span>}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
        <Button variant="secondary" size="sm" onClick={onTouched} disabled={busy} title="Marks today as your last contact and sets a follow-up a week out">
          <Check className="h-3.5 w-3.5" /> I got in touch
        </Button>
        <span className="ml-auto flex items-center">
          {linkedin && (
            <a href={linkedin} target="_blank" rel="noopener" className={iconLink} aria-label={`${c.name} on LinkedIn (opens in a new tab)`}>
              <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className={iconLink} aria-label={`Email ${c.name}`}>
              <Mail className="h-4 w-4" />
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className={iconLink} aria-label={`Call ${c.name}`}>
              <Phone className="h-4 w-4" />
            </a>
          )}
          <button type="button" onClick={onEdit} className={iconLink} aria-label={`Edit ${c.name}`}>
            <PenLine className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} className={cx(iconLink, "hover:text-rose-600")} aria-label={`Remove ${c.name}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </span>
      </div>
    </Card>
  );
}

function ContactForm({ initial, jobs, heading, onCancel, onSave }: {
  initial: JobContactInput;
  jobs: JobTrackerEntry[];
  heading: string;
  onCancel: () => void;
  onSave: (input: JobContactInput) => Promise<void>;
}) {
  const [f, setF] = useState<JobContactInput>(initial);
  const [followUp, setFollowUp] = useState(dateInput(initial.follow_up_at ?? null));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof JobContactInput>(key: K, value: JobContactInput[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      ...f,
      name: f.name.trim(),
      linkedin_url: f.linkedin_url?.trim() || null,
      email: f.email?.trim() || null,
      phone: f.phone?.trim() || null,
      application_id: f.application_id || null,
      follow_up_at: fromDateInput(followUp),
    });
    setSaving(false);
  };
  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <h3 className="font-display text-base font-semibold">{heading}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="pc-name">
            <Input id="pc-name" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="How you know them" htmlFor="pc-rel">
            <Select id="pc-rel" value={f.relation ?? "other"} onChange={(e) => set("relation", e.target.value as JobContactRelation)}>
              {RELATIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Company" htmlFor="pc-company">
            <Input id="pc-company" maxLength={200} value={f.company ?? ""} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field label="Their role" htmlFor="pc-title">
            <Input id="pc-title" maxLength={200} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="LinkedIn" htmlFor="pc-li">
            <Input id="pc-li" maxLength={500} placeholder="linkedin.com/in/…" value={f.linkedin_url ?? ""} onChange={(e) => set("linkedin_url", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="pc-email">
            <Input id="pc-email" type="email" maxLength={320} value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone or WhatsApp" htmlFor="pc-phone">
            <Input id="pc-phone" type="tel" maxLength={32} value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Follow up on" htmlFor="pc-follow">
            <Input id="pc-follow" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </Field>
          {jobs.length > 0 && (
            <Field label="About a tracked job" htmlFor="pc-job">
              <Select id="pc-job" value={f.application_id ?? ""} onChange={(e) => set("application_id", e.target.value || null)}>
                <option value="">None</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} at {j.company}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes" htmlFor="pc-notes">
          <Textarea id="pc-notes" rows={3} maxLength={4000} placeholder="Where you met, what they said, what you promised to send" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} loadingText="Saving…" disabled={!f.name.trim()} disabledReason="Add their name first">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
