import { type ReactNode, useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type {
  AnswerLength,
  AnswerStyle,
  DocumentKind,
  ExperienceLevel,
  InterviewSessionContext,
  MockDifficulty,
  MockInterviewType,
  MockPersona,
  OrbitDocument,
  OrbitSession,
  ResponseTiming,
  SessionType,
  ThinkingLevel,
  User,
  Workspace,
  PreflightCheck,
} from "@orbit/types";
import {
  ApiError,
  Button,
  confirmDialog,
  CreditCard,
  Play,
  answerLanguages,
  cx,
  focusRing,
  interviewLanguages,
  loadAnswerLanguage,
  loadInterviewLanguage,
  offersLanguages,
  saveLiveLanguages,
  sampleOffer,
  loadExperience,
  loadResponseTiming,
  loadThinking,
  saveExperience,
  loadAnswerShape,
  saveAnswerShape,
  saveResponseTiming,
  saveThinking,
  StoryBankNote,
  ResumeMakerNote,
  safeLocal,
  contextDocumentIds,
  contextSessionFields,
  useMediaQuery,
  useMotion,
  wholeMinutes,
} from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, accessTokenExpiresAt, api } from "../api";
import { openBilling, useEntitlements } from "../credits";
import { friendlyAudioError, listAudioApps, listAudioDevices, listOutputDevices, type AudioApp, type NativeAudioDevice } from "../native";
import { PreflightPanel, type LocalAudioState } from "../PreflightPanel";
import { SignInAgain } from "../SignInAgain";
import { TitleBar } from "../TitleBar";
import { roughDuration } from "../token";
import { UpdateBanner } from "../UpdateBanner";
import { confirmSessionDuringUpdate, useUpdatePhase } from "../updates";
import { WorkspaceBar } from "../WorkspaceBar";
import { SESSION_TYPE_LABEL, sessionTitle } from "../format";
import { UpcomingInterviews } from "../UpcomingInterviews";
import { MIC_KEY, OUTPUT_KEY, checkChosenApp, nextSource, usesSystemAudio, type DesktopLaunch } from "../launch";
import { addSessionDocument, defaultSessionDocuments, sessionDocumentIds, toggleSessionDocument } from "../sessionDocs";
import type { Chrome } from "./Home";
import { AnswersStep, LENGTHS } from "./setup/AnswersStep";
import { AudioTest } from "./setup/AudioTest";
import { ContextStep } from "./setup/ContextStep";
import { ListenStep } from "./setup/ListenStep";
import { SESSION_TYPES, SessionStep } from "./setup/SessionStep";
import { setupSteps, shortDevice, type StepId } from "./setup/steps";
import { SetupSection, StepBadge } from "./setup/tiles";

const MAX_UPLOAD_MB = 10;

function docError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const IS_MAC = /Mac/i.test(navigator.userAgent);

const WORKSPACE_KEY = "orbit.workspaceId";
/** How often Setup looks for a microphone while it has none. */
const MIC_RECHECK_MS = 3000;
const savedOutput = () => safeLocal.getItem(OUTPUT_KEY) ?? "out:default";

/** Session types where the other side of a call is the point: losing their audio silently is the costly mistake. */
const CALL_TYPES: ReadonlySet<SessionType> = new Set(["interview", "coding", "meeting"]);

/** Why Start stopped to ask about the interviewer's app (shown by the Start button). */
type AppWarning = { kind: "idle"; app: AudioApp; playing: AudioApp } | { kind: "gone"; text: string };

const STEP_SECTIONS: Record<StepId, string> = {
  session: "step-session",
  listen: "step-listen",
  context: "step-context",
  answers: "step-answers",
};

/**
 * New session (DESIGN.md "The desktop app", D77): one page in four numbered steps, with a rail that says what each
 * has chosen and jumps to it, and Start always in reach at the bottom. 1 the kind of session (illustrated cards, the
 * role, Upcoming interviews from the tracker); 2 who Orbit hears (app and device tiles with live meters, the
 * microphone, the audio test); 3 the documents; 4 how it answers. A saved setup fills in all four.
 */
export function SetupScreen({
  user,
  chrome,
  notice,
  initialType,
  initialJobId,
  onSignedInAgain,
  onStart,
}: {
  user: User | null;
  chrome: Chrome;
  /** Account notice under the title bar (e.g. verify your email). */
  notice?: ReactNode;
  initialType?: SessionType;
  /** Home's "Prepare": this tracked interview is picked as Setup opens. */
  initialJobId?: string;
  onSignedInAgain: (user: User) => void;
  onStart: (session: OrbitSession, launch: DesktopLaunch) => void;
}) {
  const [type, setType] = useState<SessionType>(initialType ?? "interview");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  // The answer's length and style and Auto-answer: the last ones used on this device (they were forgotten each time).
  const [shape] = useState(loadAnswerShape);
  const [length, setLength] = useState<AnswerLength>(shape.length);
  const [experience, setExperience] = useState<ExperienceLevel>(loadExperience);
  const [style, setStyle] = useState<AnswerStyle>(shape.style);
  const [thinking, setThinking] = useState<ThinkingLevel>(loadThinking);
  const [autoAnswer, setAutoAnswer] = useState(shape.autoAnswer);
  useEffect(() => saveAnswerShape({ length, style, autoAnswer }), [length, style, autoAnswer]);
  const [responseTiming, setResponseTiming] = useState<ResponseTiming>(loadResponseTiming);
  // What the interviewer speaks and what answers are written in ("" = the same), when the server offers languages.
  const offered = user?.live_languages;
  const offeredKey = (offered ?? []).join(",");
  const [language, setLanguage] = useState(() => loadInterviewLanguage(offered));
  const [answerLanguage, setAnswerLanguage] = useState(() => loadAnswerLanguage(loadInterviewLanguage(offered), offered));
  useEffect(() => {
    // The account loads after the first render: apply the device's choice once the offered list is known.
    const list = offeredKey ? offeredKey.split(",") : undefined;
    const heard = loadInterviewLanguage(list);
    setLanguage(heard);
    setAnswerLanguage(loadAnswerLanguage(heard, list));
  }, [offeredKey]);
  const pickLanguages = (heard: string, answer: string) => {
    const a = answer === heard ? "" : answer;
    setLanguage(heard);
    setAnswerLanguage(a);
    saveLiveLanguages(heard, a);
  };
  const [docs, setDocs] = useState<OrbitDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadKind, setUploadKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [devices, setDevices] = useState<NativeAudioDevice[]>([]);
  const [outputs, setOutputs] = useState<NativeAudioDevice[]>([]);
  // Device ids are stable endpoint ids, so the last choice is remembered (a missing device falls back to the
  // default at capture time).
  const [micId, setMicIdState] = useState(() => safeLocal.getItem(MIC_KEY) ?? "");
  const setMicId = (id: string) => {
    setMicIdState(id);
    safeLocal.setItem(MIC_KEY, id);
  };
  // The user's own choice. Phone and mock sessions don't use interviewer audio; switching back to another type
  // brings the choice back instead of leaving it off for good.
  const [systemAudioChoice, setSystemAudioChoice] = useState(true);
  const interviewerAudioUsed = !IS_MAC && usesSystemAudio(type);
  const systemAudio = interviewerAudioUsed && systemAudioChoice;
  const [apps, setApps] = useState<AudioApp[]>([]);
  const appsRef = useRef<AudioApp[]>([]);
  // What to listen to: "app:<pid>" (one app), or an output: "out:default" | "out:communications" | "out:<id>".
  const [source, setSource] = useState<string>(savedOutput);
  const appTouched = useRef(false);
  const appPid = source.startsWith("app:") ? source.slice(4) : "";
  const systemDevice = source.startsWith("out:") ? source.slice(4) : undefined;
  const [appWarning, setAppWarning] = useState<AppWarning | null>(null);
  // An app the user chose to keep at Start although it was silent: not asked about again.
  const keptIdleApp = useRef<number | null>(null);
  const chooseSource = (value: string) => {
    appTouched.current = true;
    setSource(value);
    setAppWarning(null);
    if (value.startsWith("out:")) safeLocal.setItem(OUTPUT_KEY, value);
  };
  const showApps = (list: AudioApp[]) => {
    const previous = appsRef.current;
    appsRef.current = list;
    setApps(list);
    setSource((s) => nextSource(s, previous, list, appTouched.current, savedOutput()));
  };

  const [error, setError] = useState<string | null>(null);
  const micListError = useRef<string | null>(null);
  const readMics = useCallback(() => {
    listAudioDevices()
      .then((list) => {
        setDevices(list);
        // a read that failed before (its message is showing) worked this time
        setError((e) => (e !== null && e === micListError.current ? null : e));
      })
      .catch((err: unknown) => {
        micListError.current = friendlyAudioError(`Couldn't list audio devices: ${String(err)}`, "come back to this screen");
        setError(micListError.current);
      });
  }, []);
  // Stable (showApps only uses refs and state setters), so the focus listener below is added once.
  const refreshApps = useCallback(() => {
    readMics();
    if (IS_MAC) return;
    void listAudioApps().then(showApps);
    void listOutputDevices().then(setOutputs);
  }, [readMics]);
  // Back from the meeting app is when what's playing changes (the call started): read the lists again. Back from
  // Windows' sound settings, a microphone may be there now.
  useEffect(() => {
    window.addEventListener("focus", refreshApps);
    return () => window.removeEventListener("focus", refreshApps);
  }, [refreshApps]);
  // No microphone (or the list couldn't be read): look again every few seconds, so plugging a headset in clears the
  // "No microphone found" check that holds Start back, without leaving this screen.
  const noMic = devices.length === 0;
  useEffect(() => {
    if (!noMic) return;
    const t = window.setInterval(readMics, MIC_RECHECK_MS);
    return () => window.clearInterval(t);
  }, [noMic, readMics]);
  // Why Start didn't work, shown by the Start button (the screen scrolls; the general error sits far above it).
  const [startError, setStartError] = useState<{ text: string; buy: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const restartingToUpdate = useUpdatePhase() === "installing";
  // Start awaits a couple of things before `starting` disables the button: a second click meanwhile is ignored.
  const startBusy = useRef(false);
  const plan = useEntitlements();
  // The sign-in runs out at a fixed time; a session that outlives it can't reconnect or send screenshots until the
  // user signs in again. Warn while it could happen during the longest session the plan allows (plus a margin).
  const signInLeft = (() => {
    const expiresAt = accessTokenExpiresAt();
    return expiresAt === null ? null : expiresAt - Date.now();
  })();
  const signInEndsSoon =
    signInLeft !== null && signInLeft < ((plan?.limits.max_session_minutes ?? 240) + 30) * 60_000;
  const [mockPersona, setMockPersona] = useState<MockPersona>("hiring_manager");
  const [mockType, setMockType] = useState<MockInterviewType>("mixed");
  const [mockDifficulty, setMockDifficulty] = useState<MockDifficulty>("medium");
  const [mockMinutes, setMockMinutes] = useState(20);
  const [offer, setOffer] = useState("");
  const [offerCompany, setOfferCompany] = useState("");
  const [offerTarget, setOfferTarget] = useState("");
  // The account's country words the level and the sample offer; without one (offline), something neutral.
  const country = user?.country ?? null;
  const offerExample = country ? sampleOffer(country) : null;
  const isMock = type === "mock";
  const negotiation = isMock && mockType === "negotiation";
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => safeLocal.getItem(WORKSPACE_KEY));
  // An interview picked from the tracker: its role, company, round and documents, and the session is linked to it.
  const [job, setJob] = useState<InterviewSessionContext | null>(null);
  const jobRef = useRef(false);
  // Failing critical checks (server, AI, transcription, mic, minutes, verification): Start is disabled unless the user
  // explicitly overrides — a broken setup must never slide into a live interview by default.
  const [blockers, setBlockers] = useState<PreflightCheck[]>([]);
  const [overrideBlockers, setOverrideBlockers] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Stable, so the checks panel reports only when the failing set changes (a new function every render re-rendered
  // this screen in a loop).
  // Out of minutes: the server refuses the session whatever the checks say, so "Start anyway" can't help.
  const outOfMinutes = blockers.length > 0 && blockers.every((b) => b.id === "minutes");
  const onPreflight = useCallback((b: PreflightCheck[]) => {
    setBlockers(b);
    if (b.length === 0) setOverrideBlockers(false);
  }, []);

  const applyWorkspace = (ws: Workspace | null) => {
    setWorkspaceId(ws?.id ?? null);
    if (ws) safeLocal.setItem(WORKSPACE_KEY, ws.id);
    else safeLocal.removeItem(WORKSPACE_KEY);
    if (!ws) return;
    setType(ws.session_type);
    setRole(ws.role ?? "");
    setInstructions(ws.notes ?? "");
    if (ws.session_type !== "mock") {
      // The server only returns a language it offers (English otherwise).
      setLanguage(ws.language);
      setAnswerLanguage(ws.answer_language ?? "");
    }
    setLength(ws.length);
    setStyle(ws.style);
    setAutoAnswer(ws.auto_answer);
    setSelected(new Set(ws.document_ids));
  };
  // Restore the last-used setup once documents are loaded (its document ids replace the default selection). Opened
  // from one of Home's quick starts ("Coding"…), the type is the one clicked, whatever the last setup's was. Opened
  // for a tracked interview, that interview's context wins: the saved setup isn't restored over it.
  const restored = useRef(Boolean(initialJobId));
  useEffect(() => {
    if (restored.current || docs === null || !workspaceId) return;
    restored.current = true;
    api
      .listWorkspaces()
      .then((list) => {
        applyWorkspace(list.find((w) => w.id === workspaceId) ?? null);
        if (initialType) setType(initialType);
      })
      .catch(() => undefined);
  }, [docs, workspaceId, initialType]);

  useEffect(() => {
    api
      .listDocuments()
      .then((list) => {
        setDocs((prev) => prev ?? list);
        // A tracked interview applied first keeps its own documents.
        if (!jobRef.current) setSelected(defaultSessionDocuments(list));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t load documents."));
    refreshApps();
  }, [refreshApps]);

  const applyJob = async (ctx: InterviewSessionContext): Promise<void> => {
    jobRef.current = true;
    setJob(ctx);
    setRole(ctx.role);
    try {
      const list = await api.listDocuments(); // the server just saved the job's post and resume version
      setDocs(list);
      setSelected(new Set(contextDocumentIds(ctx, list)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load documents.");
    }
  };

  const refreshDocs = async (selectId?: string): Promise<void> => {
    const list = await api.listDocuments();
    setDocs(list);
    if (selectId) setSelected((prev) => addSessionDocument(prev, selectId));
  };

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const doc = await api.uploadDocument(file, uploadKind, file.name);
      await refreshDocs(doc.id);
    } catch (err) {
      setError(`Upload failed: ${docError(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const onPasteSave = async (): Promise<void> => {
    if (pasteText.trim().length < 20) {
      setError("Paste at least a few sentences (20+ characters).");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const kindLabel = { resume: "Resume", job_description: "Job description", notes: "Notes", other: "Document" }[uploadKind];
      const doc = await api.createTextDocument({ title: pasteTitle.trim() || kindLabel, kind: uploadKind, text: pasteText });
      await refreshDocs(doc.id);
      setPasteText("");
      setPasteTitle("");
      setPasteOpen(false);
    } catch (err) {
      setError(`Couldn't save: ${docError(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const onDeleteDoc = async (id: string): Promise<void> => {
    setError(null);
    const doc = docs?.find((d) => d.id === id);
    if (!(await confirmDialog({ title: `Delete “${doc?.title ?? "this document"}”?`, body: "It's removed from Documents too, with the facts Orbit read from it.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteDocument(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshDocs();
    } catch (err) {
      setError(`Couldn't delete: ${docError(err)}`);
    }
  };

  const toggleDoc = (id: string): void => setSelected((prev) => toggleSessionDocument(prev, id));

  const selectedDocs = (docs ?? []).filter((d) => selected.has(d.id));
  const micDevice = micId ? devices.find((d) => d.id === micId) : undefined;
  const outputName = (id: string | undefined) =>
    id === "communications"
      ? outputs.find((o) => o.isCommunications)?.name
      : id && id !== "default"
        ? outputs.find((o) => o.id === id)?.name
        : outputs.find((o) => o.isDefault)?.name;
  const selectedApp = appPid ? apps.find((a) => String(a.pid) === appPid) : undefined;
  // Browsers run every tab in one process tree, so "this app only" would overpromise for Chrome/Edge/Firefox.
  const selectedIsBrowser = selectedApp ? isBrowserExe(selectedApp.exe) : false;
  // The chosen app is silent while another one plays: the interview is most likely over there.
  const otherPlaying = selectedApp && !selectedApp.active ? apps.find((a) => a.active && a.pid !== selectedApp.pid) : undefined;
  const micName = (micDevice ?? devices.find((d) => d.isDefault) ?? devices[0])?.name ?? null;
  const interviewerName = appPid ? (selectedApp?.name ?? "The chosen app") : systemDevice === "communications" ? "Call audio" : (outputName(systemDevice) ?? "Default output");
  const localState: LocalAudioState = {
    micName,
    systemAudio,
    systemAudioUsed: usesSystemAudio(type),
    interviewerSource: appPid
      ? selectedIsBrowser
        ? `Capturing ${selectedApp?.name ?? "the browser"} (all its tabs)`
        : `Capturing ${selectedApp?.name ?? "the selected app"} only`
      : `Capturing ${outputName(systemDevice) ?? "the default output"}`,
    interviewerWarning:
      selectedApp && otherPlaying ? `${selectedApp.name} isn't playing any sound, but ${otherPlaying.name} is.` : null,
    hasResume: selectedDocs.some((d) => d.kind === "resume"),
    hasJobDescription: selectedDocs.some((d) => d.kind === "job_description"),
  };
  const languageLabel =
    !isMock && offersLanguages(offered)
      ? [interviewLanguages(offered).find((l) => l.value === language)?.label, answerLanguage ? `answers in ${answerLanguages(language, offered).find((l) => l.value === answerLanguage)?.label ?? answerLanguage}` : null]
          .filter(Boolean)
          .join(", ")
      : null;
  const steps = setupSteps({
    typeLabel: SESSION_TYPES.find((t) => t.value === type)?.label ?? SESSION_TYPE_LABEL[type],
    role,
    needsOffer: negotiation && offer.trim().length < 2,
    micName,
    interviewerUsed: interviewerAudioUsed,
    interviewerOn: systemAudio,
    interviewerName: systemAudio ? shortDevice(interviewerName) : null,
    interviewerWarning: localState.interviewerWarning,
    callType: CALL_TYPES.has(type),
    documents: selected.size,
    hasResume: localState.hasResume,
    isMock,
    answerSummary: [languageLabel, `${LENGTHS.find((l) => l.value === length)?.label ?? "Auto"} length`, isMock ? null : autoAnswer ? "Automatic" : "On request"].filter(Boolean).join(" · "),
  });
  const stepById = Object.fromEntries(steps.map((s) => [s.id, s]));
  /** Submit again once the state just set has rendered (start() reads it from the next render). */
  const startAgain = () => setTimeout(() => formRef.current?.requestSubmit(), 0);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (startBusy.current || (blockers.length > 0 && !overrideBlockers)) return;
    startBusy.current = true;
    try {
      await startSession();
    } finally {
      startBusy.current = false;
    }
  };

  const startSession = async () => {
    // An update that's about to restart Orbit would end the session: ask first.
    if (!(await confirmSessionDuringUpdate())) return;
    setAppWarning(null);
    // The app list can be minutes old: check against a fresh one that the chosen app is still there and is the one
    // playing. (An empty list is more likely a failed read than no audio at all: then don't second-guess.)
    let app = selectedApp;
    if (systemAudio && selectedApp) {
      const list = await listAudioApps();
      if (list.length > 0) {
        appsRef.current = list;
        setApps(list);
        const check = checkChosenApp(list, selectedApp.pid, selectedApp.exe);
        if (check.kind === "gone") {
          const fallback = savedOutput();
          setSource(fallback);
          setAppWarning({
            kind: "gone",
            text: `${selectedApp.name} isn't open any more, so Orbit will listen to ${outputName(fallback.slice(4)) ?? "the default output"} instead. Pick another app under Listen to, or press Start again.`,
          });
          return;
        }
        if (check.kind === "idle" && keptIdleApp.current !== check.app.pid) {
          setAppWarning(check);
          return;
        }
        app = check.app; // the same app, maybe restarted under a new PID
      }
    }
    setStarting(true);
    setError(null);
    setStartError(null);
    try {
      const session = await api.createSession({
        // Not the picker's label: the mock's ("Mock interview — the AI asks, you practise") would title every round.
        // From the tracker, the job's own ("Razorpay — Round 2 · Technical round").
        title: job ? job.title : sessionTitle(type, role),
        type,
        ...(job ? contextSessionFields(job) : {}),
        ...(role.trim() ? { role: role.trim() } : {}),
        // A mock interview's language is the practice one (the web Practice page); the copilot's is picked here.
        language: isMock ? "en" : language,
        ...(!isMock && answerLanguage ? { answer_language: answerLanguage } : {}),
        length,
        style,
        auto_answer: isMock ? false : autoAnswer,
        document_ids: sessionDocumentIds(selected, docs),
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(isMock
          ? {
              mock: {
                interview_type: mockType,
                difficulty: mockDifficulty,
                duration_minutes: mockMinutes,
                persona: negotiation ? "recruiter" : mockPersona,
                ...(negotiation
                  ? {
                      negotiation: {
                        offer: offer.trim(),
                        ...(offerCompany.trim() ? { company: offerCompany.trim() } : {}),
                        ...(offerTarget.trim() ? { target: offerTarget.trim() } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      });
      onStart(session, {
        systemAudio,
        ...(micId ? { micDeviceId: micId } : {}),
        ...(systemAudio && appPid ? { systemProcessId: app?.pid ?? Number(appPid) } : {}),
        ...(systemAudio && app ? { systemProcessExe: app.exe } : {}),
        ...(systemAudio && systemDevice ? { systemDevice } : {}),
      });
    } catch (err) {
      setStartError({
        text: err instanceof Error ? err.message : "Couldn’t start the session.",
        buy: err instanceof ApiError && err.status === 402,
      });
      setStarting(false);
    }
  };

  // ── The step rail: the step in view is the current one; a click scrolls to its section ───────────────────────
  const wide = useMediaQuery("(min-width: 768px)");
  const motion = useMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<StepId>("session");
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const sections = Object.entries(STEP_SECTIONS)
      .map(([id, el]) => [id as StepId, document.getElementById(el)] as const)
      .filter((x): x is readonly [StepId, HTMLElement] => x[1] !== null);
    const seen = new Map<StepId, number>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          const id = sections.find(([, el]) => el === r.target)?.[0];
          if (id) seen.set(id, r.isIntersecting ? r.intersectionRatio : 0);
        }
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setInView(best[0]);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const [, el] of sections) io.observe(el);
    return () => io.disconnect();
  }, []);
  const goTo = (id: StepId) => {
    const el = document.getElementById(STEP_SECTIONS[id]);
    el?.scrollIntoView({ behavior: motion === "full" ? "smooth" : "auto", block: "start" });
    el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  };

  const workspaceBar = (
    <WorkspaceBar
      selectedId={workspaceId}
      onSelect={applyWorkspace}
      current={{
        role: role.trim() || null,
        session_type: type,
        language: isMock ? "en" : language,
        answer_language: isMock ? null : answerLanguage || null,
        length,
        style,
        auto_answer: autoAnswer,
        notes: instructions.trim() || null,
        document_ids: sessionDocumentIds(selected, docs),
      }}
    />
  );
  const blocked = blockers.length > 0 && !overrideBlockers;
  const needsOffer = negotiation && offer.trim().length < 2;

  return (
    <div className="flex h-full flex-col">
      <TitleBar current={null} update={false} {...chrome} />
      {notice}
      <UpdateBanner />
      <form ref={formRef} onSubmit={(e) => void start(e)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {wide && (
            <nav aria-label="Setup steps" className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-200 bg-white px-3 py-5 dark:border-white/[0.07] dark:bg-zinc-950">
              <div className="px-2">
                <h1 className="text-lg font-semibold tracking-tight">New session</h1>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Four steps. Orbit remembers your choices.</p>
              </div>
              <ol className="space-y-1">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => goTo(s.id)}
                      aria-current={inView === s.id ? "step" : undefined}
                      className={cx(
                        "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-quick",
                        inView === s.id ? "bg-zinc-100 dark:bg-white/[0.06]" : "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
                        focusRing,
                      )}
                    >
                      <StepBadge n={i + 1} done={s.done} attention={s.attention} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{s.label}</span>
                        <span className={cx("block truncate text-xs", s.attention ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")}>{s.summary}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-auto">{workspaceBar}</div>
            </nav>
          )}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
              {!wide && (
                <div className="space-y-3">
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">New session</h1>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Four steps. Orbit remembers your choices.</p>
                  </div>
                  {workspaceBar}
                </div>
              )}

              <SetupSection
                id={STEP_SECTIONS.session}
                n={1}
                title="What kind of session?"
                line="Orbit tunes its answers to it."
                done={stepById.session?.done}
                attention={stepById.session?.attention}
              >
                <div className="space-y-4">
                  <UpcomingInterviews picked={job} initialId={initialJobId} onPick={(ctx) => void applyJob(ctx)} onClear={() => setJob(null)} />
                  <SessionStep
                    type={type}
                    onType={setType}
                    role={role}
                    onRole={setRole}
                    mock={{
                      persona: mockPersona,
                      setPersona: setMockPersona,
                      focus: mockType,
                      setFocus: setMockType,
                      difficulty: mockDifficulty,
                      setDifficulty: setMockDifficulty,
                      minutes: mockMinutes,
                      setMinutes: setMockMinutes,
                      offer,
                      setOffer,
                      company: offerCompany,
                      setCompany: setOfferCompany,
                      target: offerTarget,
                      setTarget: setOfferTarget,
                      offerExample,
                    }}
                  />
                </div>
              </SetupSection>

              <SetupSection
                id={STEP_SECTIONS.listen}
                n={2}
                title="Who should Orbit hear?"
                line="Nothing is captured until you press Start (or test your audio)."
                done={stepById.listen?.done}
                attention={stepById.listen?.attention}
              >
                <ListenStep
                  isMac={IS_MAC}
                  type={type}
                  interviewerUsed={interviewerAudioUsed}
                  systemAudio={systemAudio}
                  onSystemAudio={setSystemAudioChoice}
                  apps={apps}
                  outputs={outputs}
                  source={source}
                  onSource={chooseSource}
                  onRefresh={refreshApps}
                  selectedApp={selectedApp}
                  selectedIsBrowser={selectedIsBrowser}
                  otherPlaying={otherPlaying}
                  systemDevice={systemDevice}
                  devices={devices}
                  micId={micId}
                  onMic={setMicId}
                  test={
                    <AudioTest
                      micId={micId || undefined}
                      systemAudio={systemAudio}
                      systemProcessId={appPid ? Number(appPid) : undefined}
                      systemProcessExe={appPid ? selectedApp?.exe : undefined}
                      systemDevice={systemDevice}
                      micLabel={micName ?? "default"}
                      listenTo={appPid ? `app: ${selectedApp?.exe.split(/[\\/]/).pop() ?? "unknown"}` : `output: ${outputName(systemDevice) ?? "default"}`}
                      interviewerName={interviewerName}
                      devices={devices}
                      outputs={outputs}
                    />
                  }
                />
              </SetupSection>

              <SetupSection
                id={STEP_SECTIONS.context}
                n={3}
                title="What should answers draw on?"
                line="Your resume and the job post make answers specific to you."
                done={stepById.context?.done}
                attention={stepById.context?.attention}
              >
                <ContextStep
                  docs={docs}
                  selected={selected}
                  onToggle={toggleDoc}
                  onDelete={(id) => void onDeleteDoc(id)}
                  uploadKind={uploadKind}
                  onUploadKind={setUploadKind}
                  uploading={uploading}
                  fileInputRef={fileInputRef}
                  onFilePicked={(e) => void onFilePicked(e)}
                  pasteOpen={pasteOpen}
                  onPasteOpen={setPasteOpen}
                  pasteTitle={pasteTitle}
                  onPasteTitle={setPasteTitle}
                  pasteText={pasteText}
                  onPasteText={setPasteText}
                  onPasteSave={() => void onPasteSave()}
                  maxUploadMb={MAX_UPLOAD_MB}
                  notes={
                    <div className="space-y-1">
                      <StoryBankNote api={api} onManage={() => void openUrl(`${WEB_URL}/documents/stories`)} />
                      <ResumeMakerNote api={api} onOpen={() => void openUrl(`${WEB_URL}/resume-ai`)} />
                    </div>
                  }
                />
              </SetupSection>

              <SetupSection id={STEP_SECTIONS.answers} n={4} title="How should Orbit answer?" line="You can change these during the session too." done>
                <AnswersStep
                  isMock={isMock}
                  offered={offered}
                  language={language}
                  answerLanguage={answerLanguage}
                  onLanguages={pickLanguages}
                  length={length}
                  onLength={setLength}
                  autoAnswer={autoAnswer}
                  onAutoAnswer={setAutoAnswer}
                  responseTiming={responseTiming}
                  onResponseTiming={(t) => {
                    setResponseTiming(t);
                    saveResponseTiming(t);
                  }}
                  style={style}
                  onStyle={setStyle}
                  experience={experience}
                  onExperience={(level) => {
                    setExperience(level);
                    saveExperience(level);
                  }}
                  thinking={thinking}
                  onThinking={(t) => {
                    setThinking(t);
                    saveThinking(t);
                  }}
                  country={country}
                  instructions={instructions}
                  onInstructions={setInstructions}
                />
              </SetupSection>

              {error && (
                <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-white px-5 py-3 dark:border-white/[0.07] dark:bg-zinc-950">
          <div className="mx-auto max-w-5xl space-y-2">
            {signInEndsSoon && signInLeft !== null && (
              <div className="overflow-hidden rounded-lg">
                <SignInAgain
                  email={user?.email ?? null}
                  message={
                    signInLeft <= 0
                      ? "Your sign-in has expired. Sign in again to start a session."
                      : `Your sign-in expires in ${roughDuration(signInLeft)}, maybe during this session. Sign in again now so nothing interrupts it.`
                  }
                  onSignedIn={onSignedInAgain}
                />
              </div>
            )}
            {/* Not folded into the checklist's tips: an interview that can't hear the interviewer is the costly mistake. */}
            {interviewerAudioUsed && !systemAudio && CALL_TYPES.has(type) && (
              <div role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <span className="flex-1">Interviewer audio is off: Orbit only hears your microphone, not the other side of the call.</span>
                <button type="button" onClick={() => setSystemAudioChoice(true)} className={cx("shrink-0 font-medium underline", focusRing)}>
                  Turn it on
                </button>
              </div>
            )}
            {appWarning?.kind === "idle" && (
              <div role="alert" className="space-y-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <p>
                  {appWarning.app.name} isn't playing any sound, but {appWarning.playing.name} is. If your interview is in{" "}
                  {appWarning.playing.name}, Orbit won't hear the interviewer.
                </p>
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      chooseSource(`app:${appWarning.playing.pid}`);
                      startAgain();
                    }}
                    className={cx("font-medium underline", focusRing)}
                  >
                    Listen to {appWarning.playing.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      keptIdleApp.current = appWarning.app.pid;
                      setAppWarning(null);
                      startAgain();
                    }}
                    className={cx("underline", focusRing)}
                  >
                    Start with {appWarning.app.name}
                  </button>
                </span>
              </div>
            )}
            {appWarning?.kind === "gone" && (
              <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                {appWarning.text}
              </p>
            )}
            {startError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                <span className="flex-1">{startError.text}</span>
                {startError.buy && (
                  <button type="button" onClick={() => openBilling()} className={cx("shrink-0 font-medium underline", focusRing)}>
                    Buy minutes
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <PreflightPanel local={localState} onStatus={onPreflight} />
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 sm:w-72">
                {/* The system's primary button: its press, a spinner with "Starting…" at the same width, and why it can't
                    start yet (the words on it say it; the tooltip repeats it for a negotiation without the offer). */}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={starting}
                  loadingText="Starting…"
                  disabled={restartingToUpdate || needsOffer || blocked}
                  disabledReason={needsOffer && !restartingToUpdate && !blocked ? "Add the offer you were given first" : undefined}
                >
                  {!restartingToUpdate && !blocked && <Play className="h-4 w-4" aria-hidden />}
                  {restartingToUpdate
                    ? "Restarting to update…"
                    : blocked
                      ? outOfMinutes
                        ? "Out of interview minutes"
                        : `Fix ${blockers.length} problem${blockers.length === 1 ? "" : "s"} to start`
                      : "Start Session"}
                </Button>
                {outOfMinutes && !starting && (
                  <Button className="w-full" variant="secondary" onClick={() => openBilling()}>
                    <CreditCard className="h-4 w-4" />
                    Buy interview minutes
                  </Button>
                )}
                {blocked && !starting && !outOfMinutes && (
                  <button
                    type="button"
                    onClick={() => {
                      void confirmDialog({
                        title: "Start with problems?",
                        body: `${blockers.map((b) => `${b.label}: ${b.detail}`).join(" ")} The session may not hear or answer you — only continue if you're sure the check is wrong.`,
                        confirmLabel: "Start anyway",
                        danger: true,
                      }).then((ok) => {
                        if (!ok) return;
                        setOverrideBlockers(true);
                        setTimeout(() => formRef.current?.requestSubmit(), 0);
                      });
                    }}
                    className={cx("w-full text-center text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
                  >
                    Start without these checks
                  </button>
                )}
                {plan?.credits && <MinutesLeft left={plan.credits.interview_minutes_left} onBuy={() => openBilling()} />}
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

const BROWSER_EXES = new Set(["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe"]);
function isBrowserExe(exe: string): boolean {
  return BROWSER_EXES.has(exe.split(/[\\/]/).pop()?.toLowerCase() ?? "");
}

/** "42 interview minutes left" by the Start button, with the way to buy more; amber when a session would soon run out. */
function MinutesLeft({ left, onBuy }: { left: number; onBuy: () => void }) {
  const n = wholeMinutes(left);
  if (n === 0) return null; // the checks already say so, with the way to buy more
  return (
    <p className={cx("text-center text-xs tabular-nums", n < 10 ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")}>
      {n} interview minute{n === 1 ? "" : "s"} left ·{" "}
      <button type="button" onClick={onBuy} className={cx("rounded font-medium underline-offset-2 hover:underline", focusRing)}>
        Buy more ↗
      </button>
    </p>
  );
}
