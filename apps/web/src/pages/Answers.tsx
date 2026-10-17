import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SavedAnswer, SavedAnswerInput } from "@orbit/types";
import { CosmicEmptyState, LoadGate, MessageSquareQuote, PenLine, Plus, Search, Target, Trash2, confirmDialog } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Textarea } from "../components/ui";
import { answerPracticeSession } from "../lib/answerPractice";
import { api } from "../lib/api";
import { errorText, formatDate, spokenTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { LiveLaunchState } from "./SessionSetup";
import { LibraryTabs } from "./Stories";

const EMPTY: SavedAnswerInput = { question: "", answer: "" };
const SEARCH_FROM = 6; // answers before a search box is worth showing

/** A question and the user's answer to it, as typed or edited. */
function AnswerEditor({ initial, heading, onSave, onCancel }: {
  initial: SavedAnswerInput;
  heading: string;
  onSave: (a: SavedAnswerInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [a, setA] = useState<SavedAnswerInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ question: a.question.trim(), answer: a.answer.trim() });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };
  return (
    <Card className="mb-6 ring-1 ring-indigo-500/30">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={heading}>
        <h2 className="font-display text-lg font-semibold">{heading}</h2>
        <Field label="Question" htmlFor="answer-question" hint="As an interviewer would ask it, e.g. “Why do you want to leave your current job?”">
          <Input id="answer-question" required maxLength={500} value={a.question} autoFocus={!initial.question}
                 onChange={(e) => setA({ ...a, question: e.target.value })} />
        </Field>
        <Field label="Your answer" htmlFor="answer-text" hint="Write it the way you'd say it. In an interview, the copilot starts from this when the question comes up.">
          <Textarea id="answer-text" required rows={7} maxLength={3000} value={a.answer}
                    onChange={(e) => setA({ ...a, answer: e.target.value })} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !a.question.trim() || !a.answer.trim()}>
            {saving ? "Saving…" : "Save answer"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AnswerCard({ saved, onEdit, onDelete, onPractise, practising }: {
  saved: SavedAnswer;
  onEdit: () => void;
  onDelete: () => void;
  onPractise: () => void;
  practising: boolean;
}) {
  const words = saved.answer.split(/\s+/).filter(Boolean).length;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{saved.question}</h3>
        <span className="flex flex-none gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit your answer to “${saved.question}”`}>
            <PenLine className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete} aria-label={`Delete your answer to “${saved.question}”`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
      <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{saved.answer}</p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {words} word{words === 1 ? "" : "s"} · {spokenTime(words)} out loud · saved{" "}
        {formatDate(saved.updated_at)}
        {saved.session_id && (
          <>
            {" · "}
            <Link to={`/sessions/${saved.session_id}`} className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
              from a session
            </Link>
          </>
        )}
      </p>
      <div className="mt-auto pt-4">
        <Button variant="secondary" size="sm" onClick={onPractise} disabled={practising}
                aria-label={`Practise answering “${saved.question}” out loud`}>
          <Target className="h-3.5 w-3.5" /> {practising ? "Starting…" : "Practise it"}
        </Button>
      </div>
    </Card>
  );
}

type Editing = { id: string | null; initial: SavedAnswerInput; heading: string };

export function AnswersPage() {
  const answers = useAsync(() => api.savedAnswers(), [], "answers");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [practisingId, setPractisingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const list = useMemo(() => answers.data ?? [], [answers.data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => `${a.question}\n${a.answer}`.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const startNew = () => {
    setEditing({ id: null, initial: EMPTY, heading: "New answer" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (a: SavedAnswerInput) => {
    if (!editing) return;
    // A question that's already saved (in near enough the same words) gets this answer: the server says which.
    const saved = editing.id ? await api.updateSavedAnswer(editing.id, a) : await api.saveAnswer(a);
    answers.setData((prev) => [saved, ...(prev ?? []).filter((x) => x.id !== saved.id)]);
    setEditing(null);
  };

  const remove = async (a: SavedAnswer) => {
    if (!(await confirmDialog({ title: "Delete this answer?", body: "Live answers stop using it.", confirmLabel: "Delete", danger: true })))
      return;
    try {
      await api.deleteSavedAnswer(a.id);
      answers.setData((prev) => (prev ?? []).filter((x) => x.id !== a.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const practise = async (a: SavedAnswer) => {
    setPractisingId(a.id);
    setError(null);
    try {
      const session = await api.createSession(answerPracticeSession(a));
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setPractisingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        icon={MessageSquareQuote}
        title="My answers"
        subtitle="Your own answers to the questions you expect. When one comes up in an interview, the copilot starts from yours instead of starting over."
        actions={
          <Button onClick={startNew}>
            <Plus className="h-4 w-4" /> New answer
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {editing && (
        <AnswerEditor key={editing.id ?? "new"} initial={editing.initial} heading={editing.heading} onSave={save}
                      onCancel={() => setEditing(null)} />
      )}

      <LoadGate loading={answers.loading && !answers.data} variant="card" count={3} label="Loading your answers">
      {answers.error ? (
        <ErrorNote onRetry={answers.reload}>{errorText(answers.error)}</ErrorNote>
      ) : list.length === 0 ? (
        !editing && (
          <CosmicEmptyState
            variant="answers"
            title="Keep the answers you've worked out"
            body="After a mock or a real interview, open its review and choose “Save as my answer” on any question. Or write one now for a question you know is coming."
            action={
              <Button onClick={startNew}>
                <Plus className="h-4 w-4" /> Write an answer
              </Button>
            }
          />
        )
      ) : (
        <section aria-labelledby="answers-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="answers-title" className="font-display text-lg font-semibold">
              Your answers <span className="font-sans text-sm font-normal text-zinc-500">({list.length})</span>
            </h2>
            {list.length >= SEARCH_FROM && (
              <label className="relative block w-full sm:w-64">
                <span className="sr-only">Search your answers</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
                       className="pl-9" />
              </label>
            )}
          </div>
          {shown.length === 0 ? (
            <EmptyState kind="no-results" title="No answers match" body="Try another word from the question or answer." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {shown.map((a) =>
                editing?.id === a.id ? null : (
                  <AnswerCard
                    key={a.id}
                    saved={a}
                    onEdit={() => {
                      setEditing({ id: a.id, initial: { question: a.question, answer: a.answer }, heading: "Edit answer" });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    onDelete={() => void remove(a)}
                    onPractise={() => void practise(a)}
                    practising={practisingId === a.id}
                  />
                ),
              )}
            </div>
          )}
        </section>
      )}
      </LoadGate>
      <LibraryTabs />
    </div>
  );
}
