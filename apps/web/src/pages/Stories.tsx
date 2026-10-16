import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { STORY_COMPETENCIES, type Story, type StoryCompetency, type StoryInput } from "@orbit/types";
import {
  ArrowRight,
  BookOpen,
  Check,
  PenLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
  LoadGate,
  confirmDialog,
  cx,
  focusRing,
  splitPlaceholders,
} from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { storyPracticeSession } from "../lib/storyPractice";
import { useAsync } from "../lib/useAsync";
import { RESUME_AI_HOME } from "./resume/paths";
import type { LiveLaunchState } from "./SessionSetup";

/**
 * Documents and Story bank are one "your materials" area: both feed every session. The tabs between them are the
 * interview copilot's tabs (Layout); making a resume is Resume AI's (it used to be a tab here), so there's a pointer
 * to it.
 */
export function LibraryTabs() {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-3">
      <Link
        to={RESUME_AI_HOME}
        className={cx("group inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-300", focusRing)}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span className="group-hover:underline">Build or improve your resume in Resume AI</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

const COMPETENCY: Record<StoryCompetency, { label: string; prompt: string }> = {
  leadership: { label: "Leadership", prompt: "You led people or a project" },
  teamwork: { label: "Teamwork", prompt: "You made a team work better" },
  conflict: { label: "Conflict", prompt: "You disagreed with someone" },
  failure: { label: "Failure", prompt: "Something went wrong" },
  ownership: { label: "Ownership", prompt: "You took on something nobody owned" },
  impact: { label: "Impact", prompt: "A result you’re proud of" },
  ambiguity: { label: "Ambiguity", prompt: "You worked it out with little direction" },
  customer: { label: "Customer focus", prompt: "You went the extra mile for a user" },
  influence: { label: "Influence", prompt: "You changed someone’s mind" },
  learning: { label: "Learning", prompt: "You learned something new fast" },
  technical: { label: "Technical depth", prompt: "A hard technical problem you solved" },
  deadline: { label: "Pressure", prompt: "A tight deadline you met" },
};

const STAR: Array<{ key: "situation" | "task" | "action" | "result"; label: string; hint: string }> = [
  { key: "situation", label: "Situation", hint: "Where and when — the context in a sentence or two." },
  { key: "task", label: "Task", hint: "What you had to achieve, or the problem that was yours." },
  { key: "action", label: "Action", hint: "What you did, in the first person. The heart of the story." },
  { key: "result", label: "Result", hint: "What happened — with a number if you have one — and what you learned." },
];

const EMPTY: StoryInput = { title: "", situation: "", task: "", action: "", result: "", competencies: [] };

/** Draft text with "[fill this in]" prompts shown as chips, like live answers. */
function WithPrompts({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span
            key={i}
            title="Fill this in from your own experience"
            className="rounded bg-amber-500/15 px-1 text-amber-800 underline decoration-amber-500/60 decoration-dashed underline-offset-2 dark:text-amber-200"
          >
            {p.text}
          </span>
        ),
      )}
    </>
  );
}

function CompetencyChips({ value }: { value: StoryCompetency[] }) {
  if (!value.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {value.map((c) => (
        <span key={c} className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
          {COMPETENCY[c].label}
        </span>
      ))}
    </span>
  );
}

function Coverage({ stories, onPick }: { stories: Story[]; onPick: (c: StoryCompetency) => void }) {
  const covered = new Set(stories.flatMap((s) => s.competencies));
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">Coverage</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            What interviewers usually ask about. Tap a gap to write a story for it.
          </p>
        </div>
        <div className="w-full sm:w-44">
          <p className="text-sm tabular-nums text-zinc-600 sm:text-right dark:text-zinc-300">
            <span className="font-semibold">{covered.size}</span> of {STORY_COMPETENCIES.length} covered
          </p>
          <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-500 motion-ok:transition-[width] motion-ok:duration-700 motion-ok:ease-out"
              style={{ width: `${(covered.size / STORY_COMPETENCIES.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {STORY_COMPETENCIES.map((c) => {
          const has = covered.has(c);
          return (
            <li key={c}>
              <button
                type="button"
                onClick={() => onPick(c)}
                title={has ? `Add another ${COMPETENCY[c].label.toLowerCase()} story` : `Write a story: ${COMPETENCY[c].prompt.toLowerCase()}`}
                className={cx(
                  "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  has
                    ? "border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10"
                    : "border-dashed border-zinc-300 hover:bg-zinc-500/5 dark:border-white/15",
                  focusRing,
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full",
                    has ? "bg-emerald-500 text-white" : "border border-dashed border-zinc-400 dark:border-zinc-500",
                  )}
                  aria-hidden="true"
                >
                  {has && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{COMPETENCY[c].label}</span>
                  <span className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">
                    {has ? "Covered" : COMPETENCY[c].prompt}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function StoryEditor({
  initial,
  heading,
  onSave,
  onCancel,
}: {
  initial: StoryInput;
  heading: string;
  onSave: (s: StoryInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [s, setS] = useState<StoryInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (c: StoryCompetency) =>
    setS((prev) => ({
      ...prev,
      competencies: prev.competencies.includes(c)
        ? prev.competencies.filter((x) => x !== c)
        : [...prev.competencies, c].slice(0, 6),
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...s, title: s.title.trim() });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6 ring-1 ring-indigo-500/30">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={heading}>
        <h2 className="font-display text-lg font-semibold">{heading}</h2>
        <Field label="Title" htmlFor="story-title" hint="A few words you’d recognise, e.g. “Cut checkout latency by 40%”.">
          <Input
            id="story-title"
            required
            maxLength={160}
            value={s.title}
            onChange={(e) => setS({ ...s, title: e.target.value })}
            autoFocus={!initial.title}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          {STAR.map(({ key, label, hint }) => (
            <Field key={key} label={label} htmlFor={`story-${key}`} hint={hint}>
              <Textarea
                id={`story-${key}`}
                rows={key === "action" ? 5 : 3}
                maxLength={1200}
                value={s[key]}
                onChange={(e) => setS({ ...s, [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">What it shows</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STORY_COMPETENCIES.map((c) => {
              const on = s.competencies.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                  className={cx(
                    "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
                    on
                      ? "bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-200"
                      : "text-zinc-600 ring-zinc-200 hover:bg-zinc-500/5 dark:text-zinc-300 dark:ring-white/10",
                    focusRing,
                  )}
                >
                  {COMPETENCY[c].label}
                </button>
              );
            })}
          </div>
        </fieldset>
        {s.action.includes("[") || s.result.includes("[") ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Replace the [bracketed] prompts with your real details before you rely on this story.
          </p>
        ) : null}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !s.title.trim()}>
            {saving ? "Saving…" : "Save story"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StoryCard({ story, onEdit, onDelete, onPractise, practising = false }: {
  story: StoryInput;
  onEdit: () => void;
  onDelete?: () => void;
  /** Saved stories: a short mock round asking the questions this story answers (lib/storyPractice.ts). */
  onPractise?: () => void;
  practising?: boolean;
}) {
  const parts = STAR.filter(({ key }) => story[key].trim());
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{story.title}</h3>
        <span className="flex flex-none gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit “${story.title}”`}>
            <PenLine className="h-3.5 w-3.5" /> Edit
          </Button>
          {onDelete && (
            <Button variant="danger" size="sm" onClick={onDelete} aria-label={`Delete “${story.title}”`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      </div>
      <div className="mt-2">
        <CompetencyChips value={story.competencies} />
      </div>
      {story.result.trim() && (
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">Result: </span>
          <WithPrompts text={story.result} />
        </p>
      )}
      {parts.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className={cx("cursor-pointer select-none text-xs font-medium text-indigo-600 dark:text-indigo-300", focusRing)}>
            Show the full story
          </summary>
          <dl className="mt-2 space-y-2">
            {parts.map(({ key, label }) => (
              <div key={key}>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">{label}</dt>
                <dd className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">
                  <WithPrompts text={story[key]} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {onPractise && (
        <div className="mt-auto pt-4">
          <Button variant="secondary" size="sm" onClick={onPractise} disabled={practising} aria-label={`Practise telling “${story.title}” out loud`}>
            <Target className="h-3.5 w-3.5" /> {practising ? "Starting…" : "Practise telling it"}
          </Button>
        </div>
      )}
    </Card>
  );
}

type Editing = { id: string | null; initial: StoryInput; heading: string; fromDraft?: number };
// Each draft gets an id of its own: the editor is keyed on it (so editing another draft starts from that draft) and
// saving or discarding removes exactly that one, even after new drafts were added in front of it.
type Draft = { id: number; story: StoryInput };

export function StoriesPage() {
  const stories = useAsync(() => api.listStories(), [], "stories");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextDraftId = useRef(0);
  const [drafting, setDrafting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [practisingId, setPractisingId] = useState<string | null>(null);
  const [practiseError, setPractiseError] = useState<string | null>(null);

  const list = stories.data ?? [];

  const practise = async (story: Story) => {
    setPractisingId(story.id);
    setPractiseError(null);
    try {
      const session = await api.createSession(storyPracticeSession(story));
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setPractiseError(errorText(err));
      setPractisingId(null);
    }
  };

  const startNew = (c?: StoryCompetency) => {
    setEditing({
      id: null,
      initial: { ...EMPTY, competencies: c ? [c] : [] },
      heading: c ? `New story: ${COMPETENCY[c].prompt.toLowerCase()}` : "New story",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (s: StoryInput) => {
    if (!editing) return;
    if (editing.id) {
      const saved = await api.updateStory(editing.id, s);
      stories.setData((prev) => [saved, ...(prev ?? []).filter((x) => x.id !== saved.id)]);
    } else {
      const saved = await api.createStory(s);
      stories.setData((prev) => [saved, ...(prev ?? [])]);
      if (editing.fromDraft !== undefined) setDrafts((d) => d.filter((x) => x.id !== editing.fromDraft));
    }
    setEditing(null);
  };

  const saveDraft = async (d: Draft) => {
    setError(null);
    try {
      const saved = await api.createStory(d.story);
      stories.setData((prev) => [saved, ...(prev ?? [])]);
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const draft = async (source: "resume" | "notes") => {
    setDrafting(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.draftStories(source === "notes" ? { source, notes } : { source, count: 4 });
      if (!r.grounded) {
        setNote("Upload your resume first — stories are drafted from it.");
      } else {
        const fresh = r.stories.map((story) => ({ id: nextDraftId.current++, story }));
        setDrafts((prev) => [...fresh, ...prev]);
        if (source === "notes") {
          setNotes("");
          setNotesOpen(false);
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDrafting(false);
    }
  };

  const remove = async (s: Story) => {
    if (!(await confirmDialog({ title: `Delete “${s.title}”?`, body: "Live answers stop using it.", confirmLabel: "Delete", danger: true })))
      return;
    try {
      await api.deleteStory(s.id);
      stories.setData((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void draft("resume")} disabled={drafting}>
        <Sparkles className="h-4 w-4" /> {drafting ? "Drafting…" : "Draft from my resume"}
      </Button>
      <Button variant="secondary" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}>
        <PenLine className="h-4 w-4" /> From my notes
      </Button>
      <Button onClick={() => startNew()}>
        <Plus className="h-4 w-4" /> New story
      </Button>
    </div>
  );

  return (
    <div>
      <LibraryTabs />
      <PageHeader
        icon={BookOpen}
        title="Story bank"
        subtitle="Your real examples, in STAR form. When an interviewer asks “Tell me about a time…”, live answers use the story that fits."
        actions={actions}
      />

      {notesOpen && (
        <Card className="mb-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void draft("notes");
            }}
            className="space-y-3"
          >
            <Field
              label="What happened?"
              htmlFor="story-notes"
              hint="Rough notes are fine — who, what went on, what you did, how it ended. Orbit shapes it into a story you can edit."
            >
              <Textarea id="story-notes" rows={4} maxLength={6000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button type="submit" disabled={drafting || notes.trim().length < 20}>
              <Sparkles className="h-4 w-4" /> {drafting ? "Drafting…" : "Turn into a story"}
            </Button>
          </form>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {note && (
        <p role="status" className="mb-4 rounded-xl bg-indigo-500/10 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
          {note}{" "}
          <Link to="/documents" className="font-medium underline underline-offset-2">
            Go to Documents
          </Link>
        </p>
      )}

      {editing && (
        <StoryEditor
          key={editing.id ?? (editing.fromDraft !== undefined ? `draft-${editing.fromDraft}` : `new-${editing.heading}`)}
          initial={editing.initial}
          heading={editing.heading}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-title" className="mb-8">
          <h2 id="drafts-title" className="font-display text-lg font-semibold">
            Drafts to review
          </h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Check each one matches what really happened and fill in the highlighted details. Only saved stories are used.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {drafts.map((d) => (
              <div key={d.id} className="space-y-2">
                <StoryCard
                  story={d.story}
                  onEdit={() => {
                    setEditing({ id: null, initial: d.story, heading: "Edit draft", fromDraft: d.id });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void saveDraft(d)}>
                    <Check className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}>
                    Discard
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <LoadGate loading={stories.loading && !stories.data} variant="card" count={3} label="Loading your stories">
      {stories.error ? (
        <ErrorNote onRetry={stories.reload}>{errorText(stories.error)}</ErrorNote>
      ) : (
        <>
          <Coverage stories={list} onPick={startNew} />
          {list.length === 0 && drafts.length === 0 && !editing ? (
            <EmptyState
              icon={BookOpen}
              title="Build your story bank"
              body="Save five to eight real examples — a conflict, a failure, a win. Draft them from your resume in one click, then make them yours."
              action={
                <Button onClick={() => void draft("resume")} disabled={drafting}>
                  <Sparkles className="h-4 w-4" /> {drafting ? "Drafting…" : "Draft from my resume"}
                </Button>
              }
            />
          ) : (
            list.length > 0 && (
              <section aria-labelledby="saved-title">
                <h2 id="saved-title" className="mb-3 font-display text-lg font-semibold">
                  Your stories <span className="font-sans text-sm font-normal text-zinc-500">({list.length})</span>
                </h2>
                {practiseError && (
                  <div className="mb-3">
                    <ErrorNote>{practiseError}</ErrorNote>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {list.map((s) =>
                    editing?.id === s.id ? null : (
                      <StoryCard
                        key={s.id}
                        story={s}
                        onEdit={() => {
                          setEditing({ id: s.id, initial: s, heading: `Edit “${s.title}”` });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        onDelete={() => void remove(s)}
                        onPractise={() => void practise(s)}
                        practising={practisingId === s.id}
                      />
                    ),
                  )}
                </div>
              </section>
            )
          )}
        </>
      )}
      </LoadGate>
    </div>
  );
}
