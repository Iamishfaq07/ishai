import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ResumeQuestionsResponse, ResumeSummary } from "@orbit/types";
import {
  ArrowRight,
  MOCK_INTERVIEW_ENABLED,
  Sparkles,
  Target,
  WorkingState,
  buttonClass,
  cx,
  defaultPractice,
  focusRing,
  practiceDocuments,
  practiceDrill,
  practiceMinutes,
} from "@orbit/ui";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorText } from "../../lib/format";
import { useWelcomeGrant } from "../../lib/welcome";
import type { LiveLaunchState } from "../SessionSetup";
import { AiCostNote, AiErrorNote, AllowanceContext, isUpgradeError, useResumeAllowance } from "../resume/allowance";
import { QuestionCard } from "../resume/InterviewPrep";
import { resumeToText } from "../resume/model";
import { RESUME_AI_HOME } from "../resume/paths";
import type { BankKind } from "./content";
import type { BankCompany, BankRole } from "./types";

/**
 * What the AI is given about the interview: the guide itself (its rounds, what interviewers listen for and its
 * practice questions), in place of a job post. Nothing beyond what the page already shows.
 */
export function guideBrief(kind: BankKind, entry: BankCompany | BankRole): string {
  const company = kind === "company";
  const lines = [
    company ? `Interviews at ${entry.name}, as candidates commonly report them (it varies by team, level and year).` : `${entry.name} interviews, as candidates commonly report them (it varies by employer and level).`,
    entry.summary,
    `Stages: ${entry.rounds.map((r, i) => `${i + 1}. ${r}`).join(" ")}`,
    `What interviewers listen for: ${entry.looks_for.join("; ")}.`,
    `Practice questions in the style of these interviews: ${entry.questions.slice(0, 12).map((q) => q.text).join(" ")}`,
  ];
  return lines.join("\n");
}

/**
 * "Your <company> questions, from your resume": the AI reads the visitor's resume against this guide and writes the
 * questions they're most likely to get, each with an answer outline from their own resume and where they'll be pushed
 * (Resume AI's interview prep, one resume credit). Then one tap practises them out loud with the AI interviewer.
 */
export function MyQuestions({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const { user } = useAuth();
  const name = entry.name;
  const company = kind === "company";
  const title = company ? `Your ${name} questions, from your resume` : `Your ${name.toLowerCase()} questions, from your resume`;
  return (
    <section id="my-questions" aria-labelledby="my-questions-title" className="mt-10 scroll-mt-24 rounded-2xl border mk-line mk-surface p-6">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI, for you
      </p>
      <h2 id="my-questions-title" className="mk-h3 mt-2 text-zinc-950 dark:text-white">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        The questions above are for everyone. Orbit's AI reads your resume against this guide and writes the questions
        you're most likely to get{company ? ` at ${name}` : ""}: each with an answer outline from your own experience,
        what only you can add, and where the interviewer will push. Nothing is made up.
      </p>
      {user ? <ForYou kind={kind} entry={entry} /> : <SignedOut />}
    </section>
  );
}

function SignedOut() {
  const welcome = useWelcomeGrant();
  const back = `${useLocation().pathname}#my-questions`;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <Link to="/register" state={{ from: back }} className={buttonClass("primary", "md")}>
        <Sparkles className="h-4 w-4" aria-hidden /> Get my questions free
      </Link>
      <Link to="/login" state={{ from: back }} className={cx("rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        I have an account
      </Link>
      <p className="w-full text-xs text-zinc-600 dark:text-zinc-400">
        {welcome?.resume_credits ? `A free account comes with ${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}; this uses 1. ` : "Uses 1 AI credit. "}
        You'll need a resume in Orbit: upload yours or build one.
      </p>
    </div>
  );
}

function ForYou({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const allowance = useResumeAllowance();
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const [result, setResult] = useState<ResumeQuestionsResponse | null>(null);
  const [openAll, setOpenAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const company = kind === "company";

  useEffect(() => {
    api.listResumes().then((all) => {
      const sorted = [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setResumes(sorted);
      setChosen((c) => c || sorted[0]?.id || "");
    }, (err: unknown) => setError({ text: errorText(err), upgrade: false }));
  }, []);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const resume = await api.getResume(chosen);
      setResult(await api.resumeQuestions(resume.data, guideBrief(kind, entry)));
    } catch (err) {
      setError({ text: errorText(err), upgrade: isUpgradeError(err) });
    } finally {
      setBusy(false);
      allowance.refresh();
    }
  };

  // Out loud with the AI interviewer: the first few of these, grounded in the resume and this guide.
  const practise = async () => {
    if (!result) return;
    setStarting(true);
    setError(null);
    try {
      const resume = await api.getResume(chosen);
      const drill = practiceDrill(result.questions, new Set(defaultPractice(result)));
      const documentIds = await practiceDocuments(api, { title: resume.title, resumeText: resumeToText(resume.data), jobText: guideBrief(kind, entry) });
      const session = await api.createSession({
        title: `${entry.name} practice`.slice(0, 300),
        type: "mock",
        ...(company ? { company: entry.name } : { role: entry.name }),
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
      setError({ text: errorText(err), upgrade: false });
      setStarting(false);
    }
  };

  if (resumes === null && !error) return <p role="status" className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Looking for your resumes…</p>;
  if (resumes && resumes.length === 0) {
    return (
      <p className="mt-5 text-sm text-zinc-700 dark:text-zinc-300">
        First, add your resume: upload it or build one in a few minutes.{" "}
        <Link to={RESUME_AI_HOME} className={cx("inline-flex items-center gap-1 rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          Go to Resume <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </p>
    );
  }

  const jobLabel = company ? `${entry.name}'s interviews` : `${entry.name} interviews`;
  return (
    <AllowanceContext.Provider value={allowance}>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        {resumes && resumes.length > 1 && (
          <label className="text-sm">
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Resume</span>
            <select value={chosen} onChange={(e) => { setChosen(e.target.value); setResult(null); }}
              className={cx("mt-1 min-h-10 max-w-[18rem] rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/15 dark:bg-zinc-900", focusRing)}>
              {resumes.map((r) => <option key={r.id} value={r.id}>{r.title || r.name || "Untitled resume"}</option>)}
            </select>
          </label>
        )}
        <Button disabled={busy || !chosen} onClick={() => void ask()}>
          <Sparkles className="h-4 w-4" aria-hidden /> {busy ? "Reading your resume…" : result ? "Ask again" : "Find my likely questions"}
        </Button>
      </div>
      <AiCostNote className="mt-2" />
      {error && <AiErrorNote className="mt-2" error={error.text} upgrade={error.upgrade} />}
      {busy && <div className="mt-4"><WorkingState compact kind="reading" label={`Reading your resume the way ${company ? `a ${entry.name} interviewer` : "an interviewer"} does`} /></div>}
      {result && !busy && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-950 dark:text-white">{result.questions.length} likely question{result.questions.length === 1 ? "" : "s"}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpenAll((v) => !v)}>{openAll ? "Hide outlines" : "Show all outlines"}</Button>
              {MOCK_INTERVIEW_ENABLED && (
                <Button size="sm" disabled={starting} onClick={() => void practise()}>
                  <Target className="h-4 w-4" aria-hidden /> {starting ? "Starting…" : "Practise these out loud"}
                </Button>
              )}
            </div>
          </div>
          {result.groups.map((g) => {
            const questions = result.questions.filter((q) => q.group === g.id);
            if (!questions.length) return null;
            return (
              <section key={g.id} aria-label={g.kind === "job" ? jobLabel : g.label}>
                <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{g.kind === "job" ? jobLabel : g.label}</h3>
                <ul className="space-y-2">
                  {questions.map((q, i) => <QuestionCard key={q.id} q={q} startOpen={openAll || (g === result.groups[0] && i === 0)} />)}
                </ul>
              </section>
            );
          })}
          {MOCK_INTERVIEW_ENABLED && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Practise these out loud: Orbit's AI interviewer asks the first {defaultPractice(result).length}, follows up where you'd have to defend a claim and grades every answer. Uses interview minutes.
            </p>
          )}
        </div>
      )}
    </AllowanceContext.Provider>
  );
}
