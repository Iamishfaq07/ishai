import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ResumeSummary, TailorQueueItem, TailorQueueJob } from "@orbit/types";
import { CircleAlert, CircleCheck, Layers, Plus, Sparkles, X, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { resumePath } from "./paths";
import { queueSummary } from "./tailorQueueText";

const MAX_JOBS = 10;
const POLL_MS = 3000;

/**
 * Tailor one resume to several jobs at once (after Resume-Matcher's queue): each job post becomes its own copy of the
 * resume, fixed for that job by the AI in the background, one after another, so nobody waits on a page. Paste posts,
 * or pick saved jobs from the tracker. One resume credit per job.
 */
export function TailorQueue({ resumes, onMade }: { resumes: ResumeSummary[]; onMade: () => void }) {
  const [open, setOpen] = useState(false);
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "");
  const [posts, setPosts] = useState<string[]>(["", ""]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TailorQueueItem[]>([]);
  const [saved, setSaved] = useState<Array<{ listing_id: string; title: string; company: string }>>([]);
  const finished = useRef(new Set<string>());
  const seeded = useRef(false);

  // The queue: loaded once, then every few seconds while something is waiting or running.
  const pending = items.some((i) => i.status === "queued" || i.status === "running");
  useEffect(() => {
    let live = true;
    const load = () =>
      api.tailorQueue().then((list) => {
        if (!live) return;
        setItems(list);
        // A job finished since the last look (not ones already finished when the page opened): its new resume
        // goes in the list above.
        const fresh = list.filter((i) => i.status === "done" && !finished.current.has(i.id));
        if (fresh.length && seeded.current) onMade();
        list.filter((i) => i.status === "done" || i.status === "failed").forEach((i) => finished.current.add(i.id));
        seeded.current = true;
      }, () => undefined);
    void load();
    const id = pending ? window.setInterval(load, POLL_MS) : undefined;
    return () => {
      live = false;
      if (id) window.clearInterval(id);
    };
  }, [pending, onMade]);

  useEffect(() => {
    if (!open || saved.length) return;
    api.jobTracker().then((t) => setSaved(t.filter((e) => e.live).map((e) => ({ listing_id: e.listing_id, title: e.title, company: e.company }))), () => undefined);
  }, [open, saved.length]);

  const jobs: TailorQueueJob[] = useMemo(
    () => [
      ...posts.map((p) => p.trim()).filter((p) => p.length >= 80).map((job_text) => ({ job_text })),
      ...picked.map((listing_id) => {
        const s = saved.find((x) => x.listing_id === listing_id);
        return { listing_id, label: s ? `${s.title} at ${s.company}`.slice(0, 120) : "" };
      }),
    ],
    [posts, picked, saved],
  );
  const short = posts.filter((p) => p.trim() && p.trim().length < 80).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.queueTailoring(resumeId, jobs.slice(0, MAX_JOBS));
      setItems((prev) => [...made, ...prev]);
      setPosts(["", ""]);
      setPicked([]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: TailorQueueItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await api.removeTailoring(item.id).catch((err: unknown) => {
      setError(errorText(err));
      void api.tailorQueue().then(setItems, () => undefined);
    });
  };

  return (
    <section aria-labelledby="tailor-queue-title" className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tailor-queue-title" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Layers className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden /> Tailor to several jobs
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            One resume, a tailored copy for each job, made in the background. You can leave this page.
          </p>
        </div>
        {!open && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add jobs
          </Button>
        )}
      </div>

      {open && (
        <Card className="mb-4 space-y-4">
          <Field label="Resume to tailor" htmlFor="tq-resume">
            <Select id="tq-resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} (ATS {r.score})
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-3">
            {posts.map((p, i) => (
              <Field key={i} label={`Job post ${i + 1}`} htmlFor={`tq-post-${i}`} hint={i === 0 ? "Paste the whole post: title, company, what they ask for." : undefined}>
                <Textarea id={`tq-post-${i}`} rows={3} maxLength={20000} value={p} onChange={(e) => setPosts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
            {posts.length + picked.length < MAX_JOBS && (
              <Button size="sm" variant="ghost" onClick={() => setPosts((prev) => [...prev, ""])}>
                <Plus className="h-3.5 w-3.5" /> Another job post
              </Button>
            )}
          </div>
          {saved.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">Or pick saved jobs</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {saved.slice(0, 20).map((s) => (
                  <label key={s.listing_id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-500/5">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.listing_id)}
                      disabled={!picked.includes(s.listing_id) && jobs.length >= MAX_JOBS}
                      onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, s.listing_id] : prev.filter((x) => x !== s.listing_id)))}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span className="min-w-0 truncate">
                      {s.title} <span className="text-zinc-500 dark:text-zinc-400">· {s.company}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {short > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">A post that short can't be tailored to: paste the whole thing.</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || !resumeId || !jobs.length} onClick={() => void submit()}>
              <Sparkles className="h-4 w-4" />
              {busy ? "Queueing…" : jobs.length ? `Tailor for ${jobs.length} job${jobs.length === 1 ? "" : "s"}` : "Tailor"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Each job uses 1 resume credit. Anything the AI can't prove from your resume is left for you to confirm.
            </span>
          </div>
        </Card>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((item) => {
            const r = item.result;
            return (
              <li key={item.id}>
                <Card className="flex flex-wrap items-center gap-3 !py-3">
                  {item.status === "done" ? (
                    <CircleCheck className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                  ) : item.status === "failed" ? (
                    <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                  ) : (
                    <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-full", item.status === "running" ? "animate-pulse bg-indigo-500" : "bg-zinc-400")} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    <span className={cx("block text-sm", item.status === "failed" ? "text-amber-800 dark:text-amber-200" : "text-zinc-500 dark:text-zinc-400")}>
                      {queueSummary(item)}
                    </span>
                  </span>
                  {r?.resume_id && (
                    <Link to={resumePath(r.resume_id)} className={cx("text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
                      Open it
                    </Link>
                  )}
                  {item.status !== "running" && (
                    <button type="button" onClick={() => void remove(item)} aria-label={item.status === "queued" ? `Cancel ${item.label}` : `Clear ${item.label} from the list`}
                            title={item.status === "queued" ? "Cancel" : "Clear from the list (the resume stays)"}
                            className={cx("rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200", focusRing)}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

