import { useState } from "react";
import { Link } from "react-router-dom";
import type { EvidenceItem } from "@orbit/types";
import { Check, FileText, PenLine, Plus, ShieldCheck, Sparkles, Trash2, LoadGate, confirmDialog, cx } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Input, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { sourceLabel, suggestNote } from "../lib/evidence";
import { LibraryTabs } from "./Stories";

const MAX_CLAIM = 300;

/**
 * Career Evidence Vault: short claims about your work, each with where it comes from. Suggestions from a story or
 * the resume quote the source word for word (the server checks) and wait here until you confirm them; only
 * confirmed claims are used, as facts live answers can draw on.
 */
export function EvidencePage() {
  const items = useAsync(() => api.listEvidence(), [], "evidence");
  const stories = useAsync(() => api.listStories(), [], "stories");
  const [claim, setClaim] = useState("");
  const [storyId, setStoryId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const list = items.data ?? [];
  const toCheck = list.filter((i) => i.status === "suggested");
  const confirmed = list.filter((i) => i.status === "confirmed");
  const replace = (next: EvidenceItem) => items.setData((prev) => (prev ?? []).map((i) => (i.id === next.id ? next : i)));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run("add", async () => {
      const item = await api.addEvidence(claim.trim());
      items.setData((prev) => [item, ...(prev ?? [])]);
      setClaim("");
    });

  const suggest = (source: "resume" | "story") =>
    run(`suggest-${source}`, async () => {
      setNote(null);
      const r = await api.suggestEvidence(source === "story" ? { source, story_id: storyId } : { source });
      items.setData((prev) => [...r.added, ...(prev ?? [])]);
      setNote(suggestNote(r.added.length, r.dropped));
    });

  const confirm = (item: EvidenceItem) => run(item.id, async () => replace(await api.confirmEvidence(item.id)));

  const saveEdit = () =>
    editing &&
    run(editing.id, async () => {
      replace(await api.editEvidence(editing.id, editing.text.trim()));
      setEditing(null);
    });

  const remove = (item: EvidenceItem) =>
    run(item.id, async () => {
      await api.deleteEvidence(item.id);
      items.setData((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    });

  const clear = async (only?: "suggested") => {
    const ok = await confirmDialog(
      only
        ? { title: "Discard every suggestion?", body: "Your confirmed claims stay.", confirmLabel: "Discard all", danger: true }
        : { title: "Delete everything in your vault?", body: "Every claim goes, confirmed or not. Live answers stop using them. This can't be undone.", confirmLabel: "Delete everything", danger: true },
    );
    if (!ok) return;
    await run(only ? "clear-suggested" : "clear", async () => {
      await api.clearEvidence(only);
      items.setData((prev) => (only ? (prev ?? []).filter((i) => i.status !== "suggested") : []));
    });
  };

  const row = (item: EvidenceItem) => {
    const isEditing = editing?.id === item.id;
    const working = busy === item.id;
    return (
      <li key={item.id}>
        <Card className={cx("space-y-2", item.status === "suggested" && "border-amber-500/30")}>
          {isEditing ? (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
            >
              <Input
                aria-label="Claim"
                value={editing.text}
                maxLength={MAX_CLAIM}
                autoFocus
                onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
              />
              <span className="flex gap-2">
                <Button size="sm" type="submit" disabled={working || editing.text.trim().length < 3}>
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </span>
            </form>
          ) : (
            <p className="font-medium leading-snug text-zinc-900 dark:text-zinc-50">{item.claim}</p>
          )}
          {item.quote && (
            <blockquote className="border-l-2 border-indigo-500/40 pl-3 text-sm italic text-zinc-600 dark:text-zinc-300">
              “{item.quote}”
            </blockquote>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {sourceLabel(item)}
            </span>
            {!isEditing && (
              <span className="ml-auto flex gap-1">
                {item.status === "suggested" && (
                  <Button size="sm" onClick={() => void confirm(item)} disabled={working} aria-label={`Confirm “${item.claim}”`}>
                    <Check className="h-3.5 w-3.5" /> It's true
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: item.id, text: item.claim })} aria-label={`Edit “${item.claim}”`}>
                  <PenLine className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(item)} disabled={working}
                        aria-label={`${item.status === "suggested" ? "Discard" : "Delete"} “${item.claim}”`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
          </div>
        </Card>
      </li>
    );
  };

  const storyList = stories.data ?? [];
  return (
    <div>
      <LibraryTabs />
      <PageHeader
        icon={ShieldCheck}
        title="Evidence vault"
        subtitle="Short claims about your work, each with where it comes from. Confirmed claims are facts live answers can use; suggestions wait for you."
      />

      <Card className="mb-6 space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="A claim about your work"
            placeholder="e.g. Cut checkout latency by 40% with a pricing cache"
            value={claim}
            maxLength={MAX_CLAIM}
            onChange={(e) => setClaim(e.target.value)}
          />
          <Button type="submit" disabled={busy === "add" || claim.trim().length < 3}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
        <div className="flex flex-col gap-2 border-t border-zinc-200/70 pt-4 sm:flex-row sm:flex-wrap sm:items-center dark:border-white/10">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Find evidence in</span>
          <Button variant="secondary" size="sm" onClick={() => void suggest("resume")} disabled={busy !== null}>
            <Sparkles className="h-3.5 w-3.5" /> {busy === "suggest-resume" ? "Reading…" : "My resume"}
          </Button>
          {storyList.length > 0 && (
            <span className="flex gap-2">
              <Select aria-label="A story" value={storyId} onChange={(e) => setStoryId(e.target.value)} className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                <option value="">Pick a story…</option>
                {storyList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => void suggest("story")} disabled={busy !== null || !storyId}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "suggest-story" ? "Reading…" : "This story"}
              </Button>
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Orbit only suggests what your source says word for word, and shows you the words. Nothing it suggests is used until you confirm it.
        </p>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {note && (
        <p role="status" className="mb-4 rounded-xl bg-indigo-500/10 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
          {note}
        </p>
      )}

      <LoadGate loading={items.loading && !items.data} variant="card" count={3} label="Loading your evidence">
        {items.error ? (
          <ErrorNote onRetry={items.reload}>{errorText(items.error)}</ErrorNote>
        ) : list.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Your evidence vault is empty"
            body="Add a claim you can stand behind, or let Orbit find them in your resume or a story. Every suggestion shows the words it comes from."
            action={
              storyList.length === 0 ? (
                <Link to="/documents/stories" className="text-sm font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
                  Write a story first
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-8">
            {toCheck.length > 0 && (
              <section aria-labelledby="check-title">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 id="check-title" className="font-display text-lg font-semibold">
                      To check <span className="font-sans text-sm font-normal text-zinc-500">({toCheck.length})</span>
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Is each one true, and fairly put? Confirm it, fix the wording, or discard it.</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void clear("suggested")} disabled={busy !== null}>
                    Discard all suggestions
                  </Button>
                </div>
                <ul className="grid gap-3 md:grid-cols-2">{toCheck.map(row)}</ul>
              </section>
            )}
            {confirmed.length > 0 && (
              <section aria-labelledby="confirmed-title">
                <h2 id="confirmed-title" className="mb-3 font-display text-lg font-semibold">
                  Confirmed <span className="font-sans text-sm font-normal text-zinc-500">({confirmed.length})</span>
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">{confirmed.map(row)}</ul>
              </section>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Your evidence is in your account export (Settings) and is deleted with your account.{" "}
              <button
                type="button"
                onClick={() => void clear()}
                className="font-medium text-rose-700 underline underline-offset-2 hover:no-underline dark:text-rose-300"
              >
                Delete everything in the vault
              </button>
            </p>
          </div>
        )}
      </LoadGate>
    </div>
  );
}
