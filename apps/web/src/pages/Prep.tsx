import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { OrbitDocument, PrepCategory, PrepQuestion, PrepResponse } from "@orbit/types";
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  Save,
  Sparkles,
  Target,
  Wand2,
  cx,
  focusRing,
  practiceDocumentIds,
  splitPlaceholders,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { LAST_PREP_KEY as LAST_KEY } from "../lib/auth";
import { errorText } from "../lib/format";
import type { LiveLaunchState } from "./SessionSetup";

const MAX_PRACTICE = 8; // a mock drill asks at most eight fixed questions

const CATEGORY: Record<PrepCategory, { label: string; tone: string }> = {
  behavioral: { label: "Behavioral", tone: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  technical: { label: "Technical", tone: "bg-aurora-400/10 text-aurora-700 dark:text-aurora-300" },
  role: { label: "Role fit", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  motivation: { label: "Motivation", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  curveball: { label: "Curveball", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

function loadLast(): PrepResponse | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as PrepResponse) : null;
  } catch {
    return null;
  }
}

function asMarkdown(p: PrepResponse): string {
  const head = `# Interview prep${p.role ? ` — ${p.role}` : ""}${p.company ? ` at ${p.company}` : ""}\n`;
  return (
    head +
    p.questions
      .map(
        (q, i) =>
          `\n## ${i + 1}. ${q.question}\n_${CATEGORY[q.category].label} — ${q.why}_\n\n` +
          q.talking_points.map((t) => `- ${t}`).join("\n") +
          `\n\n> ${q.suggested_answer}\n`,
      )
      .join("")
  );
}

/** Answer text with "[fill in]" prompts shown as chips, like the live answer card. */
function Spoken({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span
            key={i}
            title="Fill this in from your own experience"
            className="rounded bg-amber-500/15 px-1 text-amber-800 underline decoration-amber-500/60 decoration-dashed underline-offset-2 dark:text-amber-200"
          >
            {part.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Interview prep: pick (or paste) a job description, and Orbit predicts the likely questions with talking points
 * and a suggested answer from your resume. Then practise the ones you pick in a mock interview.
 */
export function PrepSection({
  docs,
  onDocumentAdded,
}: {
  docs: OrbitDocument[] | null;
  /** A job description saved from an imported link (the parent adds it to its document list). */
  onDocumentAdded?: (doc: OrbitDocument) => void;
}) {
  const navigate = useNavigate();
  const jds = (docs ?? []).filter((d) => d.kind === "job_description" && d.status === "ready");
  const hasResume = (docs ?? []).some((d) => d.kind === "resume" && d.status === "ready");
  const [source, setSource] = useState<string>(""); // a JD document id, "link", or "paste"
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ url: string; title: string | null; company: string | null } | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrepResponse | null>(loadLast);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [open, setOpen] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  // Default source: the newest saved job description, else paste.
  useEffect(() => {
    if (source || docs === null) return;
    setSource(jds[0]?.id ?? "paste");
  }, [docs, jds, source]);

  useEffect(() => {
    if (!result) return;
    setPicked(new Set(result.questions.slice(0, MAX_PRACTICE).map((_, i) => i)));
  }, [result]);

  const importLink = async () => {
    setImporting(true);
    setError(null);
    try {
      const posting = await api.importJobLink(link.trim());
      setPasted(posting.text);
      setImported({ url: posting.url, title: posting.title, company: posting.company });
      setSource("paste");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setImporting(false);
    }
  };

  const saveImported = async () => {
    if (!imported) return;
    setSavingDoc(true);
    setError(null);
    try {
      const host = new URL(imported.url).hostname.replace(/^www\./, "");
      const doc = await api.createTextDocument({
        title: [imported.title, imported.company].filter(Boolean).join(" — ") || `Job posting (${host})`,
        kind: "job_description",
        text: pasted.trim(),
      });
      onDocumentAdded?.(doc);
      setImported(null);
      setSource(doc.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingDoc(false);
    }
  };

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.prep(
        source === "paste"
          ? { job_text: pasted.trim(), count, ...(imported?.title ? { role: imported.title } : {}) }
          : { job_description_id: source, count },
      );
      setResult(res);
      setOpen(0);
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(res));
      } catch {
        // storage full or blocked — the result still shows
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < MAX_PRACTICE) next.add(i);
      return next;
    });

  const practise = async () => {
    if (!result || picked.size === 0) return;
    setStarting(true);
    setError(null);
    const questions = [...picked].sort((a, b) => a - b).map((i) => result.questions[i]).filter(Boolean) as PrepQuestion[];
    const contextDocs = practiceDocumentIds(docs ?? [], source !== "paste" && source !== "link" ? source : null);
    try {
      const session = await api.createSession({
        title: `Prep practice${result.role ? ` — ${result.role}` : ""}`,
        type: "mock",
        ...(result.role ? { role: result.role } : {}),
        language: "en",
        length: "standard",
        style: "natural",
        auto_answer: false,
        document_ids: contextDocs,
        mock: {
          duration_minutes: Math.min(60, Math.max(10, questions.length * 4)),
          drill: questions.map((q) => ({ question: q.question, kind: "prep" as const })),
        },
      });
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setStarting(false);
    }
  };

  const copyAll = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(asMarkdown(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — your browser blocked the clipboard.");
    }
  };

  return (
    <section aria-labelledby="prep-title" className="space-y-4">
      <Card className="gradient-border">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-aurora-500 text-white shadow-glow-sm">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 id="prep-title" className="font-display text-lg font-semibold">
              Prep from a job description
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Orbit predicts the questions this interviewer is likely to ask and drafts answers from your resume.
            </p>
          </div>
        </div>
        <form onSubmit={(e) => void generate(e)} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="Job description" htmlFor="prep-source">
              <Select id="prep-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {jds.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
                <option value="link">From a link…</option>
                <option value="paste">Paste a job description…</option>
              </Select>
            </Field>
            <Field label="Questions" htmlFor="prep-count">
              <Select id="prep-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {source === "link" && (
            <Field
              label="Link to the job posting"
              htmlFor="prep-link"
              hint="Company career pages and job boards like Greenhouse, Lever or Workday work best. Sites that need a sign-in (LinkedIn) can't be read — paste the text instead."
            >
              <div className="flex gap-2">
                <Input
                  id="prep-link"
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (/^https?:\/\/\S+\.\S+/.test(link.trim())) void importLink();
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => void importLink()}
                  disabled={importing || !/^https?:\/\/\S+\.\S+/.test(link.trim())}
                  className="shrink-0"
                >
                  <Link2 className="h-4 w-4" />
                  {importing ? "Reading…" : "Import"}
                </Button>
              </div>
            </Field>
          )}
          {source === "paste" && imported && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-indigo-500/10 px-3 py-2 text-sm text-indigo-900 dark:text-indigo-100">
              <span className="min-w-0 flex-1">
                Imported from <span className="font-medium">{new URL(imported.url).hostname.replace(/^www\./, "")}</span>
                {imported.title ? ` — ${imported.title}` : ""}. Check it’s the whole posting and trim anything that isn’t.
              </span>
              <Button size="sm" variant="secondary" onClick={() => void saveImported()} disabled={savingDoc || pasted.trim().length < 40}>
                <Save className="h-3.5 w-3.5" />
                {savingDoc ? "Saving…" : "Save to Documents"}
              </Button>
            </div>
          )}
          {source === "paste" && (
            <Field label="Paste the job posting" htmlFor="prep-text">
              <Textarea
                id="prep-text"
                rows={6}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                maxLength={20_000}
                placeholder="Paste the role, responsibilities and requirements…"
              />
            </Field>
          )}
          {!hasResume && (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              No resume yet — answers will use <span className="font-medium">[fill in]</span> prompts.{" "}
              <button type="button" onClick={() => navigate("/documents")} className={cx("font-medium underline", focusRing)}>
                Upload your resume
              </button>{" "}
              for answers from your real experience.
            </p>
          )}
          <Button type="submit" disabled={busy || source === "link" || (source === "paste" && pasted.trim().length < 40)}>
            <Wand2 className="h-4 w-4" />
            {busy ? "Reading the job description…" : result ? "Generate again" : "Generate my questions"}
          </Button>
          {busy && (
            <div className="space-y-2" aria-hidden="true">
              {[80, 64, 72].map((w) => (
                <div key={w} className="skeleton-line h-3 motion-safe:animate-shimmer" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </form>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      {result && !busy && (
        <div className="space-y-3 animate-fade-up">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold">
                {result.questions.length} likely questions
                {result.role ? ` · ${result.role}` : ""}
                {result.company ? ` at ${result.company}` : ""}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Tick up to {MAX_PRACTICE} to practise out loud.{" "}
                {!result.grounded_in_resume && "Answers use [fill in] prompts until you add a resume."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void copyAll()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy all"}
              </Button>
              <Button size="sm" disabled={picked.size === 0 || starting} onClick={() => void practise()}>
                <Target className="h-3.5 w-3.5" />
                {starting ? "Starting…" : `Practise ${picked.size} out loud`}
              </Button>
            </div>
          </div>

          <ol className="stagger space-y-2">
            {result.questions.map((q, i) => {
              const expanded = open === i;
              return (
                <li key={`${i}-${q.question}`} className="glass-panel rounded-2xl">
                  <div className="flex items-start gap-3 p-4">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={() => toggle(i)}
                      disabled={!picked.has(i) && picked.size >= MAX_PRACTICE}
                      aria-label={`Practise question ${i + 1}`}
                      className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : i)}
                      aria-expanded={expanded}
                      className={cx("min-w-0 flex-1 text-left", focusRing)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums text-zinc-400">{i + 1}</span>
                        <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", CATEGORY[q.category].tone)}>
                          {CATEGORY[q.category].label}
                        </span>
                      </span>
                      <span className="mt-1 block font-medium">{q.question}</span>
                      {q.why && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{q.why}</span>}
                    </button>
                    <ChevronDown
                      className={cx("mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform", expanded && "rotate-180")}
                      aria-hidden="true"
                    />
                  </div>
                  {expanded && (
                    <div className="animate-fade-in space-y-3 border-t border-zinc-200 px-4 pb-4 pt-3 text-sm dark:border-white/[0.06]">
                      {q.talking_points.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Talking points</p>
                          <ul className="mt-1 space-y-0.5">
                            {q.talking_points.map((t) => (
                              <li key={t} className="flex gap-2">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-400" aria-hidden="true" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Suggested answer</p>
                        <p className="mt-1 leading-relaxed text-zinc-800 dark:text-zinc-200">
                          <Spoken text={q.suggested_answer} />
                        </p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
