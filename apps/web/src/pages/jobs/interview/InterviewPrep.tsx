import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  InterviewPrepUpdate,
  InterviewPrepView,
  InterviewRoundType,
  JobTrackerEntry,
  MockConfig,
  ResumeAiAllowance,
  ResumeQuestionsResponse,
} from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarIcon,
  FileText,
  InterviewDayScene,
  ListChecks,
  LoadGate,
  MOCK_INTERVIEW_ENABLED,
  ROUND_TYPES,
  Rocket,
  Sparkles,
  Target,
  contextDocumentIds,
  contextSessionFields,
  cx,
  dateTimeInput,
  defaultPractice,
  focusRing,
  fromDateTimeInput,
  interviewWhen,
  mockForRound,
  practiceDrill,
  practiceMinutes,
  toast,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../../../components/ui";
import { api } from "../../../lib/api";
import { matchStyle } from "../../../lib/companyStyle";
import { errorText, formatDate } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { CompanyGuide } from "../../CompanyGuide";
import type { LiveLaunchState } from "../../SessionSetup";
import { RESUME_AI_HOME, resumePath } from "../../resume/paths";
import { scoreTone } from "../../resume/product";
import { linkButton, textLink } from "../links";
import { jobPath } from "../paths";
import { copilotPath } from "./links";

/**
 * The Mission Room's Interview tab: one tracked job prepared for its interview (apps/api/orbit_api/job_portal/
 * interview.py). When and which round, the job post, the resume version that was sent, the likely questions (one
 * resume credit, said before it's spent), the stories that fit, the company's guide, a practice round with all of
 * it, and the copilot started with it loaded. Nothing here is guessed: the round, the version and the date are picked.
 */
export function InterviewPrepPanel({ entry, onEntry }: { entry: JobTrackerEntry; onEntry: () => void }) {
  const prep = useAsync(() => api.interviewPrep(entry.id), [entry.id], `interview-prep:${entry.id}`);
  const styles = useAsync(() => api.interviewStyles(), [], "interview-styles");
  const guide = matchStyle(styles.data ?? [], entry.company);
  const v = prep.data;
  const save = async (patch: InterviewPrepUpdate, done?: string): Promise<boolean> => {
    try {
      const next = await api.updateInterviewPrep(entry.id, patch);
      prep.setData(() => next);
      onEntry();
      if (done) toast({ message: done, tone: "success" });
      return true;
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
      return false;
    }
  };

  return (
    <LoadGate loading={prep.loading && !v} variant="card" count={3} label="Loading your interview prep">
      {prep.error && !v ? (
        <ErrorNote onRetry={prep.reload}>{errorText(prep.error)}</ErrorNote>
      ) : v ? (
        <div className="space-y-4">
          <WhenCard view={v} onSave={save} />
          <LaunchCard view={v} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
            <JobPostCard view={v} onSave={save} />
            <ResumeCard view={v} onSave={save} />
          </div>
          <QuestionsCard view={v} onGenerated={prep.reload} />
          <StoriesCard view={v} />
          {guide && <CompanyGuide style={guide} inMock={false} />}
          <RoundsCard view={v} />
        </div>
      ) : null}
    </LoadGate>
  );
}

const h2 = "font-display text-base font-semibold";
const muted = "text-sm text-zinc-600 dark:text-zinc-400";

/** The interview's date and time and which round it is: the tracker's next date, with a time. */
function WhenCard({ view, onSave }: { view: InterviewPrepView; onSave: (p: InterviewPrepUpdate, done?: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(!view.round.at && !view.round.type);
  const [at, setAt] = useState(dateTimeInput(view.round.at));
  const [type, setType] = useState<InterviewRoundType | "">(view.round.type ?? "");
  const [number, setNumber] = useState(view.round.number ? String(view.round.number) : "");
  // Saving a date for a job that's only saved or applied: they've been invited, so offer to move it (ticked).
  const invited = view.status === "saved" || view.status === "applied";
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const n = Number.parseInt(number, 10);
    const when = fromDateTimeInput(at);
    const ok = await onSave(
      {
        at: when,
        round_type: type || null,
        round_number: Number.isFinite(n) && n >= 1 && n <= 20 ? n : null,
        ...(invited && move && when ? { status: "interviewing" as const } : {}),
      },
      "Interview saved",
    );
    setBusy(false);
    if (ok) setEditing(false);
  };
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={cx(h2, "flex items-center gap-2")}>
            <CalendarIcon className="h-4 w-4 text-sky-500" aria-hidden /> {view.round.label || "Your interview"}
          </h2>
          <p className={cx("mt-1", muted)}>
            {view.round.at ? interviewWhen(view.round.at) : "No date yet. Add it so Home and your prep plan count down to it."}
          </p>
        </div>
        {!view.round.at && <InterviewDayScene className="-my-4 ml-auto hidden w-28 shrink-0 sm:block" />}
        {!editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4 dark:border-white/10">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem]">
            <Field label="Date and time" htmlFor="iv-at">
              <Input id="iv-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            <Field label="Round" htmlFor="iv-type" hint={ROUND_TYPES.find((r) => r.value === type)?.hint}>
              <Select id="iv-type" value={type} onChange={(e) => setType(e.target.value as InterviewRoundType | "")}>
                <option value="">Not sure yet</option>
                {ROUND_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Round no." htmlFor="iv-number">
              <Input id="iv-number" type="number" inputMode="numeric" min={1} max={20} value={number} placeholder="1" onChange={(e) => setNumber(e.target.value)} />
            </Field>
          </div>
          {invited && fromDateTimeInput(at) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
              Move it to Interviewing on your tracker
            </label>
          )}
          <div className="flex justify-end gap-2">
            {(view.round.at || view.round.type) && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button size="sm" loading={busy} onClick={() => void submit()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** The two ways in: the copilot with this job loaded, or a practice round on it first. */
function LaunchCard({ view }: { view: InterviewPrepView }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const practise = async () => {
    setBusy(true);
    try {
      const session = await startPractice(view);
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session}`, { state: launch });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="iv-launch" className="glass-panel gradient-border rounded-2xl p-5">
      <h2 id="iv-launch" className="font-display text-lg font-semibold">
        On the day
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        The copilot starts with this job's post, the resume you sent and {view.guide ? `the ${view.guide} guide` : "the role"} loaded, so answers are about you and this job.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={copilotPath(view.entry_id)} className={linkButton("primary", "md")}>
          <Rocket className="h-4 w-4" aria-hidden /> Start copilot for this interview
        </Link>
        {MOCK_INTERVIEW_ENABLED && (
          <Button variant="secondary" loading={busy} onClick={() => void practise()}>
            <Target className="h-4 w-4" aria-hidden /> Practise this interview
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Both use interview minutes while they run, by the second. Nothing is spent until you start.
      </p>
    </section>
  );
}

/**
 * A mock interview for this job: its documents (saved once by the server), the interviewer for the round type, the
 * company's style, and with `drill` the picked likely questions. Returns the new session's id.
 */
async function startPractice(view: InterviewPrepView, drill?: NonNullable<MockConfig["drill"]>): Promise<string> {
  const ctx = await api.interviewSessionContext(view.entry_id);
  // Only what stops a document loading (a full plan, a post Orbit doesn't have): the rest the prep view already says.
  const missing = ctx.notes.find((n) => n.includes("isn't loaded"));
  if (missing) toast({ message: missing, tone: "neutral" });
  const docs = ctx.resume_included ? [] : await api.listDocuments();
  const session = await api.createSession({
    title: `Practice: ${ctx.title}`.slice(0, 300),
    type: "mock",
    ...contextSessionFields(ctx),
    language: "en",
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: contextDocumentIds(ctx, docs),
    mock: {
      ...mockForRound(view.round.type),
      difficulty: "medium",
      duration_minutes: drill?.length ? practiceMinutes(drill.length) : 20,
      company: ctx.company,
      ...(drill?.length ? { drill } : {}),
    },
  });
  return session.id;
}

/** The post, as Orbit may show it (its summary and a link: D43), and the copy saved for the copilot. */
function JobPostCard({ view, onSave }: { view: InterviewPrepView; onSave: (p: InterviewPrepUpdate, done?: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const j = view.job;
  return (
    <Card>
      <h2 className={cx(h2, "flex items-center gap-2")}>
        <FileText className="h-4 w-4 text-zinc-500" aria-hidden /> The job post
      </h2>
      {j.snippet && <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{j.snippet}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {j.live && (
          <Link to={jobPath(j.listing_id)} className={textLink}>
            Job page
          </Link>
        )}
        {j.url && (
          <a href={j.url} target="_blank" rel="noopener noreferrer" className={cx(textLink, "inline-flex items-center gap-0.5")}>
            Original post <ArrowUpRight className="h-3 w-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
      <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
        {j.document_title
          ? `Saved for the copilot as “${j.document_title}”.`
          : j.has_text
            ? "Saved to your Documents for the copilot when you start."
            : "Orbit doesn't have this post. Paste it below so the copilot and the questions fit the role."}
      </p>
      {!j.has_text && (
        <div className="mt-3 space-y-2">
          <label className="sr-only" htmlFor="iv-post">
            The job post
          </label>
          <Textarea id="iv-post" rows={5} maxLength={20000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the job description from the job's page" className="!text-sm" />
          <Button
            size="sm"
            disabled={text.trim().length < 40}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              if (await onSave({ job_text: text.trim() }, "Job post saved")) setText("");
              setBusy(false);
            }}
          >
            Save the post
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The resume version this interview uses: the one sent, by default; any other one the user picks. */
function ResumeCard({ view, onSave }: { view: InterviewPrepView; onSave: (p: InterviewPrepUpdate, done?: string) => Promise<boolean> }) {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const [busy, setBusy] = useState(false);
  const r = view.version;
  const linked = view.versions.find((x) => x.kind === "resume");
  const others = (resumes.data ?? []).filter((x) => x.id !== linked?.id);
  const pick = async (value: string) => {
    if (!value) return;
    setBusy(true);
    const [kind, id] = value.split(":") as [string, string];
    await onSave(kind === "other" ? { resume_id: id } : { version: kind === "resume" ? "resume" : id }, "Resume picked");
    setBusy(false);
  };
  const current = r ? (r.kind === "snapshot" ? `snap:${r.id}` : "resume:") : "";
  return (
    <Card>
      <h2 className={cx(h2, "flex items-center gap-2")}>
        <BookOpen className="h-4 w-4 text-zinc-500" aria-hidden /> The resume you sent
      </h2>
      {r ? (
        <div className="mt-3 flex items-center gap-3">
          <span className={cx("inline-flex h-8 min-w-10 items-center justify-center rounded-lg px-1.5 text-sm font-semibold tabular-nums ring-1", scoreTone(r.score))}>{r.score}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {r.kind === "resume" ? (
                <Link to={resumePath(r.id)} className={cx("hover:underline", focusRing)}>
                  {r.title}
                </Link>
              ) : (
                r.title
              )}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {r.kind === "snapshot" ? `Sent ${formatDate(r.at)}${r.note ? ` · ${r.note}` : ""}` : `As it is now · edited ${formatDate(r.at)}`}
            </p>
          </div>
        </div>
      ) : (
        <p className={cx("mt-1", muted)}>
          {view.resume_missing ? "The resume linked to this job was deleted. " : "None linked yet. "}
          Pick the one you sent: the copilot and the questions use it.
          {resumes.data?.length === 0 && (
            <>
              {" "}
              <Link to={RESUME_AI_HOME} className={textLink}>
                Make one in Resume AI
              </Link>
            </>
          )}
        </p>
      )}
      <label className="mt-4 block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{r ? "Use another version" : "Pick a resume"}</span>
        <Select value={current} disabled={busy} onChange={(e) => void pick(e.target.value)}>
          {!r && <option value="">Choose…</option>}
          {view.versions.map((x) =>
            x.kind === "snapshot" ? (
              <option key={x.id} value={`snap:${x.id}`}>
                Sent {formatDate(x.at)}: {x.title} ({x.score})
              </option>
            ) : (
              <option key={x.id} value="resume:">
                {x.title}, as it is now ({x.score})
              </option>
            ),
          )}
          {others.map((x) => (
            <option key={x.id} value={`other:${x.id}`}>
              {x.title} ({x.score})
            </option>
          ))}
        </Select>
      </label>
      {view.versions.every((x) => x.kind !== "snapshot") && r && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Freeze it as sent on the Resume kit tab, so editing it later doesn't change what you prepare from.
        </p>
      )}
    </Card>
  );
}

/** "Uses 1 resume credit. You have 3.": said before the questions are asked for. */
function creditLine(a: ResumeAiAllowance | null): string {
  if (!a) return "Uses 1 resume credit.";
  if (a.unlimited) return "Included in your plan.";
  return a.credits_left > 0 ? `Uses 1 resume credit. You have ${a.credits_left}.` : "Uses 1 resume credit. You have none left.";
}

/**
 * The questions likely for this job (Resume AI's interview prep, one credit), kept on the job so they're paid for
 * once; Regenerate is another credit, and says so. Then a mock round on the ones picked.
 */
function QuestionsCard({ view, onGenerated }: { view: InterviewPrepView; onGenerated: () => void }) {
  const navigate = useNavigate();
  const allowance = useAsync(() => api.resumeAllowance(), [], "resume-allowance");
  const saved = view.questions ?? null;
  const [out, setOut] = useState<ResumeQuestionsResponse | null>(() => saved?.result ?? null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(saved ? defaultPractice(saved.result) : []));
  const [busy, setBusy] = useState<"ask" | "practise" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = allowance.data;
  const none = Boolean(a && !a.unlimited && a.credits_left <= 0);
  const ask = async () => {
    setBusy("ask");
    setError(null);
    try {
      const result = await api.interviewQuestions(view.entry_id);
      setOut(result);
      setPicked(new Set(defaultPractice(result)));
      allowance.reload();
      onGenerated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const practise = async () => {
    if (!out) return;
    setBusy("practise");
    try {
      const id = await startPractice(view, practiceDrill(out.questions, picked));
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };
  return (
    <Card>
      <h2 className={cx(h2, "flex items-center gap-2")}>
        <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden /> Likely questions
      </h2>
      {!out ? (
        <>
          <p className={cx("mt-1", muted)}>
            The questions an interviewer is likely to ask you for this job, from {view.version ? "the resume you sent" : "your resume"} and the post, each with an outline from your own lines and where they'll push.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void ask()} loading={busy === "ask"} disabled={!view.version || none}>
              <Sparkles className="h-4 w-4" aria-hidden /> Get likely questions
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{view.version ? creditLine(a) : `Pick the resume you sent first. ${creditLine(a)}`}</span>
            {none && (
              <Link to={`/billing?pack=${a?.upgrade?.pack ?? ""}`} className={textLink}>
                Get credits
              </Link>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={cx("mt-1", muted)}>Tick the ones to practise: the AI interviewer asks them in order and follows up where they'd push.</p>
          {saved && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Prepared {formatDate(saved.generated_at)}
                {saved.stale ? ", from another resume version than the one picked now" : ""}. Kept here: seeing them again is free.
              </span>
              <Button size="sm" variant="ghost" onClick={() => void ask()} loading={busy === "ask"} disabled={!view.version || none}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Regenerate
              </Button>
              <span>{creditLine(a)}</span>
              {none && (
                <Link to={`/billing?pack=${a?.upgrade?.pack ?? ""}`} className={textLink}>
                  Get credits
                </Link>
              )}
            </div>
          )}
          <div className="mt-3 space-y-4">
            {out.groups.map((g) => {
              const qs = out.questions.filter((q) => q.group === g.id);
              if (!qs.length) return null;
              return (
                <section key={g.id} aria-label={g.label}>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">{g.label}</h3>
                  <ul className="mt-2 space-y-2">
                    {qs.map((q) => (
                      <li key={q.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
                        <label className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={picked.has(q.id)}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (next.has(q.id)) next.delete(q.id);
                                else next.add(q.id);
                                return next;
                              })
                            }
                            className="mt-0.5 h-4 w-4 flex-none rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium">{q.question}</span>
                        </label>
                        {(q.outline.length > 0 || q.defend) && (
                          <details className="mt-1.5 pl-6 text-xs text-zinc-600 dark:text-zinc-400">
                            <summary className={cx("cursor-pointer select-none font-medium text-indigo-600 dark:text-indigo-300", focusRing)}>Outline</summary>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4">
                              {q.outline.map((p, i) => (
                                <li key={i} className={p.ask ? "italic" : undefined}>
                                  {p.label ? `${p.label}: ` : ""}
                                  {p.text}
                                </li>
                              ))}
                            </ul>
                            {q.defend && <p className="mt-1">Be ready to defend: {q.defend}</p>}
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {MOCK_INTERVIEW_ENABLED && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void practise()} loading={busy === "practise"} disabled={picked.size === 0}>
                <Target className="h-4 w-4" aria-hidden /> Practise {picked.size} {picked.size === 1 ? "question" : "questions"}
              </Button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Uses interview minutes while it runs.</span>
            </div>
          )}
        </>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

/** Stories from the bank that fit what the job asks for (matched on their words), and a way to add one. */
function StoriesCard({ view }: { view: InterviewPrepView }) {
  return (
    <Card>
      <h2 className={cx(h2, "flex items-center gap-2")}>
        <ListChecks className="h-4 w-4 text-emerald-500" aria-hidden /> Stories to tell
      </h2>
      {view.stories.length > 0 ? (
        <>
          <p className={cx("mt-1", muted)}>From your story bank, for what this job asks for. The copilot can use every story in your bank.</p>
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-white/10">
            {view.stories.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">for: {s.requirement}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={cx("mt-1", muted)}>
          {view.stories_total === 0
            ? "Your story bank is empty. A few real examples in STAR form make behavioural answers yours."
            : view.requirements.length
              ? `None of your ${view.stories_total} stories mention what this job asks for (${view.requirements.slice(0, 3).join(", ")}). Add one if you have a real example.`
              : "Check your fit on the job page to see what it asks for, then match stories to it."}
        </p>
      )}
      <Link to="/documents/stories" className={cx("mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        Open your story bank <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </Card>
  );
}

/** Practice and live rounds started from this job, each with its scorecard once the report is written. */
function RoundsCard({ view }: { view: InterviewPrepView }) {
  if (!view.rounds.length) return null;
  return (
    <Card>
      <h2 className={h2}>Rounds so far</h2>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-white/10">
        {view.rounds.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {[r.practice ? "Practice" : "Live round", r.stage, formatDate(r.at)].filter(Boolean).join(" · ")}
              </span>
            </span>
            {r.score !== null && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium tabular-nums text-indigo-800 dark:text-indigo-200">{r.score}/5</span>}
            {r.status === "ended" && (
              <Link to={`/sessions/${r.id}`} className={textLink}>
                {r.practice ? "Review" : "Summary and wrap-up"}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
