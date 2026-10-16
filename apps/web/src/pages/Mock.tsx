import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CreateSessionRequest, MockDifficulty, MockInterviewType, MockPersona } from "@orbit/types";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "../components/ui";
import {
  ChevronDown,
  Code2,
  Banknote,
  IndianRupee,
  MOCK_INTERVIEW_ENABLED,
  Sparkles,
  Target,
  UserRound,
  Users,
  UsersRound,
  Video,
  cx,
  focusRing,
  isIndia,
  practiceDocumentIds,
  sampleOffer,
  type LucideIcon,
  readChoice,
  safeLocal,
} from "@orbit/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { matchStyle, withCompany } from "../lib/companyStyle";
import { LoopMemoryNote } from "../components/LoopMemoryNote";
import { useAuth } from "../lib/auth";
import { loadAnswers } from "../lib/onboarding";
import { useAsync } from "../lib/useAsync";
import { CompanyGuide } from "./CompanyGuide";
import { PRESETS, isPresetId, presetSession, presetTitle, roleForPractice, type PresetId } from "./mockPresets";
import { useCountry } from "../lib/country";
import { CountryField } from "../components/CountryField";
import { PrepSection } from "./Prep";
import { PracticeQueueCard } from "./PracticeQueue";
import { ProgressSection } from "./Progress";
import type { LiveLaunchState } from "./SessionSetup";
import { PracticeMock } from "../components/productArt";
import { usePrepContext } from "../lib/prepContext";

const NO_JD = "none";
/** The free, no-login warm-up (pages/Warmup.tsx; the route is App.tsx's). */
const WARMUP_PATH = "/warmup";

const TYPES: Array<{ value: MockInterviewType; label: string }> = [
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "system_design", label: "System design" },
  { value: "coding", label: "Coding" },
  { value: "mixed", label: "Mixed" },
  { value: "negotiation", label: "Salary negotiation" },
];

const PRESET_ICON: Record<PresetId, LucideIcon> = { hr5: Users, tmay10: UserRound, tech15: Code2, panel15: UsersRound, oneway10: Video, salary: IndianRupee };

/**
 * Practice: the AI plays interviewer (spoken with the browser's voice), you answer by voice. A mock starts in one tap
 * from a preset (`?preset=` highlights one, `?role=` names the role, `?jd=` picks the job post); the full form is under
 * "Customise". Then your progress and the weekly goal, and prep from a job post.
 */
const LANGUAGE_KEY = "orbit.practiceLanguage";
const LANGUAGE_LABEL: Record<string, string> = { en: "English", hi: "हिन्दी (Hindi)", hinglish: "Hinglish (Hindi + English)" };

export function MockPage() {
  // The AI interviewer isn't built yet — show a coming-soon state instead of a form that dead-ends.
  if (!MOCK_INTERVIEW_ENABLED) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <PageHeader icon={Target} title="Mock interview" subtitle="Coming soon" />
        <p className="mt-4 text-sm text-zinc-500">
          The AI interviewer that asks you questions is still in the works. For now, start a normal session and
          use Orbit live, or practice by pasting questions into Chat.
        </p>
      </div>
    );
  }
  return <MockSetup />;
}

function MockSetup() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  // The role for the technical round: a link's (`?role=`, a tracked job), else the Jobs AI profile's first title,
  // else the role from the welcome questions (still there if the profile hasn't saved yet).
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const [params, setParams] = useSearchParams();
  const [context, updateContext] = usePrepContext(params, setParams, user?.id);
  const knownRole = roleForPractice(context.role, profile.data?.prefs.titles[0], user ? loadAnswers(user.id)?.role : "");
  const highlighted = params.get("preset");
  const country = useCountry();
  // The company being practised for (`?company=`, or typed): a known one is asked in its style, with its guide shown.
  const styles = useAsync(() => api.interviewStyles(), [], "interview-styles");
  const company = context.company;
  const setCompany = (value: string) => updateContext({ company: value });
  const guide = matchStyle(styles.data ?? [], company);
  // Hindi and Hinglish mocks, when the server offers them (ORBIT_MULTILINGUAL); English otherwise and by default.
  const languages = user?.practice_languages?.length ? user.practice_languages : ["en"];
  const [language, setLanguageState] = useState(() => readChoice(safeLocal, LANGUAGE_KEY, languages, "en"));
  const practiceLanguage = languages.includes(language) ? language : "en";
  const setLanguage = (value: string) => {
    setLanguageState(value);
    safeLocal.setItem(LANGUAGE_KEY, value);
  };

  // Which job description the interviewer asks about: the one a link asked for (Jobs → Prepare: `?jd=`), else the
  // newest (like Prep), or none.
  const jds = (docs.data ?? []).filter((d) => d.kind === "job_description" && d.status === "ready");
  const [jdChoice, setJdChoice] = useState<string | null>(() => params.get("jd"));
  const jdId = jdChoice === NO_JD ? null : (jds.find((d) => d.id === jdChoice) ?? jds[0])?.id ?? null;
  const [starting, setStarting] = useState<PresetId | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = async (req: CreateSessionRequest, which: PresetId | "custom") => {
    setStarting(which);
    setError(null);
    try {
      const session = await api.createSession(
        withCompany({ ...req, ...context, role: req.role || knownRole, language: practiceLanguage }, company),
      );
      const launchState: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launchState });
    } catch (err) {
      setError(errorText(err));
      setStarting(null);
    }
  };
  const contextDocs = () => {
    const resumeDoc = params.get("resume_document_id");
    const selected = practiceDocumentIds(docs.data ?? [], jdId);
    return resumeDoc && (docs.data ?? []).some((d) => d.id === resumeDoc && d.status === "ready")
      ? [...new Set([resumeDoc, ...(jdId ? [jdId] : []), ...selected.filter((id) => (docs.data ?? []).find((d) => d.id === id)?.kind !== "resume")])]
      : selected;
  };

  // A link to one preset (Home's "Do a 5-minute HR round", a follow-up's "Practise now") brings it into view.
  const presetRefs = useRef<Partial<Record<PresetId, HTMLButtonElement | null>>>({});
  useEffect(() => {
    if (isPresetId(highlighted)) presetRefs.current[highlighted]?.scrollIntoView({ block: "center" });
  }, [highlighted]);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] xl:gap-10">
      <div className="max-w-3xl space-y-8">
        <PageHeader icon={Target} title="Practice" subtitle="Practise out loud with an AI interviewer, then read your report." />
        <PracticeQueueCard />

        <section aria-labelledby="quick-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="quick-title" className="font-display text-lg font-semibold">
                Start a mock in one tap
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Uses your interview minutes. Only your microphone is used.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company (optional)" htmlFor="mock-company" hint={guide ? `Asked the way ${guide.name} interviews.` : "Name a company to practise in its interview style."}>
              <Input id="mock-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={isIndia(country) ? "e.g. Amazon, TCS, Flipkart" : "e.g. Amazon, Google, Deloitte"}
                     maxLength={120} list="mock-company-styles" autoComplete="off" />
              <datalist id="mock-company-styles">
                {(styles.data ?? []).map((s) => (
                  <option key={s.slug} value={s.name} />
                ))}
              </datalist>
            </Field>
            <CountryField id="mock-country" hint="Sets the salary currency and the wording of the HR round." />
            <Field label="Interview stage" htmlFor="mock-stage">
              <Input id="mock-stage" value={context.interview_stage} onChange={(e) => updateContext({ interview_stage: e.target.value })} placeholder="e.g. Technical round, final panel" maxLength={80} />
            </Field>
            {languages.length > 1 && (
              <Field label="Language" htmlFor="mock-language" hint="The interviewer asks, and your review is written, in this language. Answer in whatever mix feels natural.">
                <Select id="mock-language" value={practiceLanguage} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l] ?? l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {jds.length > 0 && (
              <Field label="Practise for" htmlFor="mock-jd">
                <Select id="mock-jd" value={jdId ?? NO_JD} onChange={(e) => setJdChoice(e.target.value)}>
                  {jds.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                  <option value={NO_JD}>No job post: just my resume</option>
                </Select>
              </Field>
            )}
          </div>
          <LoopMemoryNote company={company} />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PRESETS.map((p) => {
              const Icon = p.id === "salary" && !isIndia(country) ? Banknote : PRESET_ICON[p.id];
              const busy = starting === p.id;
              return (
                <li key={p.id}>
                  <button
                    ref={(el) => {
                      presetRefs.current[p.id] = el;
                    }}
                    type="button"
                    disabled={starting !== null}
                    onClick={() => void launch(presetSession(p.id, knownRole, contextDocs(), country), p.id)}
                    className={cx(
                      "glass-panel lift flex h-full w-full flex-col items-start gap-1.5 rounded-2xl p-3.5 text-left hover:border-indigo-400/40 disabled:cursor-wait disabled:opacity-70 sm:p-4 dark:hover:border-indigo-400/30",
                      highlighted === p.id && "ring-2 ring-indigo-500",
                      focusRing,
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-aurora-400/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-300">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">{p.minutes} min</span>
                    </span>
                    <span className="font-display text-sm font-semibold leading-snug sm:text-base">{busy ? "Starting…" : presetTitle(p, country)}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{p.blurb(knownRole, country)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
          {guide && <CompanyGuide style={guide} />}
          <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden />
            <span>
              Out of minutes, or just warming up?{" "}
              <Link to={WARMUP_PATH} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
                Try the free warm-up
              </Link>
              : five questions with instant tips, typed or spoken, no minutes used.
            </span>
          </p>
        </section>

        <CustomMock
          knownRole={knownRole}
          onRoleChange={(role) => updateContext({ role })}
          company={company}
          open={params.has("customise")}
          busy={starting !== null}
          onStart={(req) => void launch({ ...req, document_ids: contextDocs() }, "custom")}
        />

        <ProgressSection />
        <PrepSection docs={docs.data} onDocumentAdded={(d) => docs.setData((prev) => [d, ...(prev ?? [])])} />
      </div>
      {/* Wide screens: what a round ends with, beside the ways to start one. */}
      <aside className="hidden xl:block" aria-label="What you get after a round">
        <div className="sticky top-24 space-y-3 pt-24">
          <PracticeMock />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            After each round: a score out of 10, what worked, and the answers worth redoing.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** "Customise": every setting of a mock interview, for when a preset isn't it. The job post is the one picked above. */
function CustomMock({
  knownRole,
  onRoleChange,
  company,
  open,
  busy,
  onStart,
}: {
  knownRole: string;
  onRoleChange: (role: string) => void;
  /** From the Company field above: the negotiation's recruiter works there; any other round asks in its style. */
  company: string;
  open: boolean;
  busy: boolean;
  onStart: (req: CreateSessionRequest) => void;
}) {
  // Frame 1 already shows the role a link or the profile gave (no empty field that fills in a moment later).
  const [role, setRole] = useState(() => knownRole);
  const editedRole = useRef(false);
  useEffect(() => {
    if (!editedRole.current && knownRole) setRole(knownRole);
  }, [knownRole]);
  const [interviewType, setInterviewType] = useState<MockInterviewType>("mixed");
  const [difficulty, setDifficulty] = useState<MockDifficulty>("medium");
  const [duration, setDuration] = useState(20);
  const [persona, setPersona] = useState<MockPersona>("hiring_manager");
  const [offer, setOffer] = useState("");
  const [target, setTarget] = useState("");
  const negotiation = interviewType === "negotiation";
  const sample = sampleOffer(useCountry());

  const start = (e: FormEvent) => {
    e.preventDefault();
    const r = role.trim() || knownRole;
    onStart({
      title: negotiation
        ? `Negotiation — ${company.trim() || r || "offer"}`
        : `Mock — ${r || TYPES.find((t) => t.value === interviewType)?.label || "Interview"}`,
      type: "mock",
      ...(r ? { role: r } : {}),
      language: "en",
      length: "standard",
      style: "natural",
      auto_answer: false,
      document_ids: [],
      mock: {
        interview_type: interviewType,
        difficulty,
        duration_minutes: duration,
        persona: negotiation ? "recruiter" : persona,
        ...(negotiation
          ? {
              negotiation: {
                offer: offer.trim(),
                ...(target.trim() ? { target: target.trim() } : {}),
              },
            }
          : {}),
      },
    });
  };

  return (
    <details open={open} className="group">
      <summary
        className={cx(
          "flex cursor-pointer list-none items-center gap-2 rounded-xl py-1 font-display text-base font-semibold text-zinc-800 dark:text-zinc-100 [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
        Customise
        <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">role, type, interviewer and length</span>
      </summary>
      <Card className="mt-3">
        <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">Orbit asks, listens, follows up, and gives you a short report at the end.</p>
        <form onSubmit={start} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="mock-role">
              <Input id="mock-role" value={role} onChange={(e) => { editedRole.current = true; setRole(e.target.value); onRoleChange(e.target.value); }} placeholder={knownRole || "e.g. Data Analyst"} maxLength={120} />
            </Field>
            <Field label="Interview type" htmlFor="mock-type">
              <Select id="mock-type" value={interviewType} onChange={(e) => setInterviewType(e.target.value as MockInterviewType)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {!negotiation && (
              <Field label="Interviewer" htmlFor="mock-persona">
                <Select id="mock-persona" value={persona} onChange={(e) => setPersona(e.target.value as MockPersona)}>
                  <option value="recruiter">Recruiter (HR)</option>
                  <option value="hiring_manager">Hiring manager</option>
                  <option value="engineer">Senior engineer</option>
                  <option value="staff_engineer">Staff engineer</option>
                  <option value="executive">Executive</option>
                </Select>
              </Field>
            )}
            <Field label={negotiation ? "Recruiter" : "Difficulty"} htmlFor="mock-difficulty">
              <Select id="mock-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as MockDifficulty)}>
                <option value="easy">{negotiation ? "Flexible — has budget room" : "Easy"}</option>
                <option value="medium">{negotiation ? "Realistic — some room, pushes back" : "Medium"}</option>
                <option value="hard">{negotiation ? "Tough — tight budget, applies pressure" : "Hard"}</option>
              </Select>
            </Field>
            {negotiation && (
              <>
                <Field label="The offer" htmlFor="mock-offer" hint={`What the recruiter presents, e.g. “${sample.offer}”.`}>
                  <Input id="mock-offer" required value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} placeholder={sample.offer} />
                </Field>
                <Field label="Your target (optional)" htmlFor="mock-target" hint="The recruiter doesn’t know it — your review uses it to judge how close you got.">
                  <Input id="mock-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} placeholder={sample.target} />
                </Field>
              </>
            )}
            <Field label="Duration" htmlFor="mock-duration">
              <Select id="mock-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[5, 10, 20, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-zinc-500">
            {negotiation
              ? "The AI plays a recruiter who has just made you this offer. Negotiate out loud; your review grades how you anchored, justified and handled pushback. Only your microphone is used."
              : "Uses your resume and the job post picked above for context. Only your microphone is used."}
          </p>
          <Button type="submit" disabled={busy || (negotiation && offer.trim().length < 2)}>
            {busy ? "Starting…" : negotiation ? "Start the negotiation" : "Start mock interview"}
          </Button>
          {negotiation && offer.trim().length < 2 && <p className="text-xs text-zinc-500 dark:text-zinc-400">Type the offer to start.</p>}
        </form>
      </Card>
    </details>
  );
}
