import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Resume, ResumeGapVerdict, ResumeInterviewQuestion, ResumePrepGroup, ResumeQuestionsResponse, ResumeSkillGapResponse } from "@orbit/types";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  MAX_PRACTICE,
  MOCK_INTERVIEW_ENABLED,
  cx,
  defaultPractice,
  focusRing,
  practiceDocuments,
  practiceDrill,
  toast,
  practiceMinutes,
  prepText,
  questionText,
  skillGapText,
  storyFromQuestion,
} from "@orbit/ui";
import { Button, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import type { LiveLaunchState } from "../SessionSetup";
import { AiCostNote, AiErrorNote, isUpgradeError, useAllowance } from "./allowance";
import { useBackend } from "./backend";
import { resumeToText } from "./model";

/**
 * Interview prep that grows out of the resume: the questions an interviewer will ask about it (with outlines from
 * it and what to defend), the skill gap against the job post, and the step into Orbit's interview tools: practise the
 * questions with the AI interviewer, or save a behavioural answer to the story bank. Results stay while the editor
 * is open (the editor holds them: see usePrepState); nothing is stored on the server.
 */
export interface PrepState {
  questions: ResumeQuestionsResponse | null;
  picked: string[];
  gaps: ResumeSkillGapResponse | null;
  /** What each result was made from (the resume and job post), to say when the resume changed since. */
  questionsFor: string | null;
  gapsFor: string | null;
}

const EMPTY: PrepState = { questions: null, picked: [], gaps: null, questionsFor: null, gapsFor: null };

/** The tab's results, kept by the editor so they survive switching tabs. */
export function usePrepState(): [PrepState, Dispatch<SetStateAction<PrepState>>] {
  return useState<PrepState>(EMPTY);
}

const TYPE: Record<ResumeInterviewQuestion["type"], { label: string; tone: string }> = {
  behavioral: { label: "Behavioral", tone: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  technical: { label: "Technical", tone: "bg-aurora-400/10 text-aurora-700 dark:text-aurora-300" },
  role: { label: "Role fit", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  motivation: { label: "Motivation", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

const GROUP_KIND: Record<ResumePrepGroup["kind"], string> = { role: "Role", project: "Project", job: "Job post", general: "Overall" };

const VERDICT: Record<ResumeGapVerdict, { label: string; tone: string }> = {
  related: { label: "You have related experience", tone: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300" },
  prepare: { label: "Prepare", tone: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25 dark:text-indigo-300" },
  dont_claim: { label: "Don't claim it", tone: "bg-rose-500/10 text-rose-800 ring-rose-500/25 dark:text-rose-300" },
};

const madeFrom = (r: Resume): string => JSON.stringify([r.data, r.job_text]);

export function InterviewPrep({ resume, prep, onShowJob }: { resume: Resume; prep: [PrepState, Dispatch<SetStateAction<PrepState>>]; onShowJob: () => void }) {
  const [state, setState] = prep;
  const hasJob = Boolean(resume.job_text.trim());
  return (
    <div className="space-y-4">
      <QuestionsPanel resume={resume} state={state} setState={setState} hasJob={hasJob} onShowJob={onShowJob} />
      <GapPanel resume={resume} state={state} setState={setState} hasJob={hasJob} onShowJob={onShowJob} />
    </div>
  );
}

function QuestionsPanel({ resume, state, setState, hasJob, onShowJob }: {
  resume: Resume;
  state: PrepState;
  setState: Dispatch<SetStateAction<PrepState>>;
  hasJob: boolean;
  onShowJob: () => void;
}) {
  const backend = useBackend();
  const { refresh } = useAllowance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const result = state.questions;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const questions = await backend.tools.resumeQuestions(resume.data, resume.job_text);
      setState((s) => ({ ...s, questions, picked: defaultPractice(questions), questionsFor: madeFrom(resume) }));
    } catch (err) {
      setError({ text: errorText(err), upgrade: isUpgradeError(err) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <>
      <Panel title="Questions from my resume">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          The questions an interviewer is most likely to ask about this resume: 2 to 4 for each role and project
          {hasJob ? ", plus a few from the job post" : ""}. Each comes with an answer outline from your resume and where
          they'll push. Nothing is made up: where your resume doesn't say something, it tells you what to add.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void ask()}>
            <Sparkles className="h-4 w-4" /> {busy ? "Reading your resume…" : result ? "Ask again" : "Find my likely questions"}
          </Button>
          {!hasJob && (
            <Button variant="ghost" onClick={onShowJob}>
              <Upload className="h-4 w-4" /> Add a job post for questions about it
            </Button>
          )}
        </div>
        <AiCostNote className="mt-2" />
        {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
      </Panel>
      {busy && <Spinner label="Reading your resume the way an interviewer does" state="searching" />}
      {result && !busy && <QuestionList resume={resume} result={result} state={state} setState={setState} />}
    </>
  );
}

function QuestionList({ resume, result, state, setState }: {
  resume: Resume;
  result: ResumeQuestionsResponse;
  state: PrepState;
  setState: Dispatch<SetStateAction<PrepState>>;
}) {
  const navigate = useNavigate();
  const [openAll, setOpenAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = new Set(state.picked);
  const stale = state.questionsFor !== madeFrom(resume);

  const toggle = (id: string) =>
    setState((s) => ({
      ...s,
      picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : s.picked.length < MAX_PRACTICE ? [...s.picked, id] : s.picked,
    }));

  // The step into Orbit's interview tools: a mock interview that asks these questions, grounded in this resume.
  const practise = async () => {
    setStarting(true);
    setError(null);
    try {
      const drill = practiceDrill(result.questions, picked);
      const documentIds = await practiceDocuments(api, { title: resume.title, resumeText: resumeToText(resume.data), jobText: resume.job_text });
      const role = result.role.trim().slice(0, 300);
      const session = await api.createSession({
        title: `Resume practice${role ? ` — ${role}` : ""}`.slice(0, 300),
        type: "mock",
        ...(role ? { role } : {}),
        language: "en",
        length: "standard",
        style: "natural",
        auto_answer: false,
        document_ids: documentIds,
        mock: { duration_minutes: practiceMinutes(drill.length), drill },
      });
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      {stale && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> You've changed the resume or the job post since these were written. Ask again for questions that match.
        </p>
      )}
      {MOCK_INTERVIEW_ENABLED && (
        <section aria-label="Practise in a mock interview" className="gradient-border rounded-2xl bg-white/70 p-4 dark:bg-white/[0.03]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Target className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold">Practise these in a mock interview</h3>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
                Orbit's AI interviewer asks the ones you tick, out loud and in order, and follows up where you'd have to
                defend a claim. You get a graded review afterwards. Your resume and job post are saved to Documents so it
                can ask about them.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button disabled={!picked.size || starting} onClick={() => void practise()}>
                  <Target className="h-4 w-4" /> {starting ? "Starting…" : `Practise ${picked.size} out loud`}
                </Button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Tick up to {MAX_PRACTICE} below · about {practiceMinutes(picked.size)} minutes · uses interview minutes
                </span>
              </div>
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            </div>
          </div>
        </section>
      )}
      <Panel
        title={`${result.questions.length} likely question${result.questions.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={() => setOpenAll((v) => !v)}>
              {openAll ? "Hide outlines" : "Show all outlines"}
            </Button>
            <CopyButton text={prepText(result)} label="Copy all" />
          </div>
        }
      >
        <div className="space-y-5">
          {result.groups.map((g) => {
            const questions = result.questions.filter((q) => q.group === g.id);
            if (!questions.length) return null;
            return (
              <section key={g.id} aria-label={g.label}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{GROUP_KIND[g.kind]}</span>
                  <h4 className="min-w-0 flex-1 text-sm font-semibold">{g.label}</h4>
                  <CopyButton text={prepText(result, g.id)} label="Copy" small />
                </div>
                <ul className="space-y-2">
                  {questions.map((q, i) => (
                    <QuestionCard
                      key={q.id}
                      q={q}
                      startOpen={openAll || (g === result.groups[0] && i === 0)}
                      picked={picked.has(q.id)}
                      canPick={picked.has(q.id) || picked.size < MAX_PRACTICE}
                      onPick={() => toggle(q.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function QuestionCard({ q, startOpen, picked, canPick, onPick }: { q: ResumeInterviewQuestion; startOpen: boolean; picked: boolean; canPick: boolean; onPick: () => void }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? startOpen;
  const story = storyFromQuestion(q);
  const [saved, setSaved] = useState<"idle" | "busy" | "done" | "error">("idle");
  const saveStory = () => {
    if (!story) return;
    setSaved("busy");
    api
      .createStory(story)
      .then(() => setSaved("done"))
      .catch(() => setSaved("error"));
  };
  return (
    <li className="rounded-xl border border-zinc-200 transition-colors hover:border-indigo-400/50 dark:border-white/10">
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={picked}
          disabled={!canPick}
          onChange={onPick}
          aria-label={`Practise: ${q.question}`}
          title={canPick ? "Practise this one in the mock interview" : `Up to ${MAX_PRACTICE} at a time`}
          className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        <button type="button" onClick={() => setOpen(!expanded)} aria-expanded={expanded} className={cx("min-w-0 flex-1 text-left", focusRing)}>
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", TYPE[q.type].tone)}>{TYPE[q.type].label}</span>
          <span className="mt-1 block text-sm font-medium">{q.question}</span>
        </button>
        <ChevronDown className={cx("mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform", expanded && "rotate-180")} aria-hidden />
      </div>
      {expanded && (
        <div className="animate-fade-in space-y-3 border-t border-zinc-200 px-3 pb-3 pt-2.5 text-sm dark:border-white/[0.06]">
          {q.outline.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Answer outline, from your resume</p>
              <ul className="mt-1 space-y-1">
                {q.outline.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={cx("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", p.ask ? "bg-amber-500" : "bg-aurora-400")} aria-hidden />
                    <span className={p.ask ? "text-amber-900 dark:text-amber-200" : undefined}>
                      {p.label && <span className="font-medium">{p.label}: </span>}
                      {p.ask && <span className="sr-only">You add: </span>}
                      {p.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.missing.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Only you can add</p>
              <ul className="mt-1 space-y-1 text-amber-900 dark:text-amber-200">
                {q.missing.map((m) => (
                  <li key={m} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.defend && (
            <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-950 dark:text-amber-100">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">Be ready to defend: </span>
                {q.defend}
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={questionText(q)} label="Copy" small />
            {story &&
              (saved === "done" ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5" /> Saved to{" "}
                  <Link to="/documents/stories" className="font-medium underline">
                    your stories
                  </Link>
                  : fill in the [bracketed] parts there.
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saved === "busy"}
                  onClick={saveStory}
                  title="Add this answer to your story bank, so live interviews can use it too"
                >
                  <BookOpen className="h-3.5 w-3.5" /> {saved === "error" ? "Couldn't save, try again" : saved === "busy" ? "Saving…" : "Save to my stories"}
                </Button>
              ))}
          </div>
        </div>
      )}
    </li>
  );
}

function GapPanel({ resume, state, setState, hasJob, onShowJob }: {
  resume: Resume;
  state: PrepState;
  setState: Dispatch<SetStateAction<PrepState>>;
  hasJob: boolean;
  onShowJob: () => void;
}) {
  const backend = useBackend();
  const { refresh } = useAllowance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const result = state.gaps;

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const gaps = await backend.tools.resumeSkillGap(resume.data, resume.job_text);
      setState((s) => ({ ...s, gaps, gapsFor: madeFrom(resume) }));
    } catch (err) {
      setError({ text: errorText(err), upgrade: isUpgradeError(err) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <>
      <Panel title="Skill gap for this job" action={result?.gaps.length ? <CopyButton text={skillGapText(result.gaps)} label="Copy all" /> : undefined}>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          For each skill or requirement the job post asks for that your resume doesn't show: whether you have related
          experience and how to say it, what to prepare, or what not to claim. It starts from the same missing keywords
          as the ATS score.
        </p>
        {!hasJob ? (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
            Add the job post first: the gap is worked out against it.
            <Button size="sm" variant="secondary" onClick={onShowJob}>
              <Upload className="h-3.5 w-3.5" /> Add a job post
            </Button>
          </p>
        ) : (
          <>
            <Button disabled={busy} onClick={() => void check()}>
              <Sparkles className="h-4 w-4" /> {busy ? "Checking…" : result ? "Check again" : "Check my skill gap"}
            </Button>
            <AiCostNote className="mt-2" />
          </>
        )}
        {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
        {result && !busy && (
          <div className="mt-4 space-y-3">
            {state.gapsFor !== madeFrom(resume) && (
              <p role="status" className="text-xs text-amber-800 dark:text-amber-200">You've changed the resume or the job post since this check. Check again to update it.</p>
            )}
            {result.gaps.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" /> Nothing missing: your resume shows what this job post asks for.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.gaps.map((g) => (
                  <li key={g.skill} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{g.skill}</span>
                      <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", VERDICT[g.verdict].tone)}>{VERDICT[g.verdict].label}</span>
                      {!g.keyword && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">From the job post's requirements</span>}
                    </div>
                    {g.verdict === "related" && (
                      <>
                        <p className="mt-1.5 text-zinc-800 dark:text-zinc-200">
                          <span className="font-medium">Say it like: </span>“{g.say}”
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">From your resume: {g.evidence}</p>
                      </>
                    )}
                    {g.prepare && (
                      <p className="mt-1.5 text-zinc-700 dark:text-zinc-300">
                        {g.verdict === "related" && <span className="font-medium">To prepare: </span>}
                        {g.prepare}
                      </p>
                    )}
                    {g.verdict === "dont_claim" && g.note && <p className="mt-1.5 text-zinc-700 dark:text-zinc-300">{g.note}</p>}
                  </li>
                ))}
              </ul>
            )}
            {result.matched.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Already on your resume</p>
                <ul className="flex flex-wrap gap-1.5">
                  {result.matched.map((k) => (
                    <li key={k} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-800 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
      {busy && <Spinner label="Comparing your resume with the job post" state="weaving" />}
    </>
  );
}

function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  return (
    <Button
      size="sm"
      variant={small ? "ghost" : "secondary"}
      className="whitespace-nowrap"
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

/** The editor's panel (ResumeEditor.tsx), for the same look. */
function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
