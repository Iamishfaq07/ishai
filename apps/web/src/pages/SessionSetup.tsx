import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  AnswerLength,
  AnswerStyle,
  DocumentKind,
  OrbitDocument,
  PreflightCheck,
  ResponseTiming,
  SessionType,
  ThinkingLevel,
  Workspace,
} from "@orbit/types";
import {
  ANSWER_STYLES,
  RESPONSE_TIMINGS,
  THINKING_LEVELS,
  loadResponseTiming,
  loadThinking,
  saveResponseTiming,
  saveThinking,
  PreflightPanel,
  Rocket,
  addFrame,
  newChannelStats,
  summarizeChannel,
  type ChannelSummary,
  type Verdict,
  WorkspaceBar,
  confirmDialog,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Meter, PageHeader, Select, Spinner, Textarea, Toggle } from "../components/ui";
import { API_URL, api } from "../lib/api";
import {
  captureStream,
  levelFromRms,
  listMicrophones,
  openDisplayAudio,
  openMicrophone,
  supportsDisplayAudio,
  useMicPermission,
  type AudioCapture,
} from "../lib/audio";
import { SESSION_TYPE_LABEL, errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

const LENGTHS: Array<{ value: AnswerLength; label: string }> = [
  { value: "short", label: "Short (~30 s spoken)" },
  { value: "standard", label: "Standard (~1 min)" },
  { value: "detailed", label: "Detailed (~2 min)" },
];

const SELECTABLE_TYPES: SessionType[] = ["interview", "meeting", "coding", "assessment", "phone"];
const KIND_ORDER: Record<DocumentKind, number> = { resume: 0, job_description: 1, notes: 2, other: 3 };

const WORKSPACE_KEY = "orbit.workspaceId";

/** What only the browser can check before a session: microphone access, tab audio, and the chosen documents. */
function browserChecks(o: {
  permission: ReturnType<typeof useMicPermission>;
  micCount: number;
  systemAudio: boolean;
  type: SessionType;
  docs: OrbitDocument[];
  selected: Set<string>;
}): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  out.push(
    o.permission === "denied"
      ? {
          id: "mic",
          label: "Microphone",
          status: "fail",
          severity: "blocker",
          detail: "Blocked in this browser.",
          fix: "Allow the microphone from the lock icon in the address bar, then Re-check.",
        }
      : o.permission === "granted" && o.micCount === 0
        ? {
            id: "mic",
            label: "Microphone",
            status: "fail",
            severity: "blocker",
            detail: "No microphone found.",
            fix: "Plug one in (or pick another input in your system settings), then Re-check.",
          }
        : o.permission === "granted"
          ? { id: "mic", label: "Microphone", status: "ok", detail: "Allowed." }
          : {
              id: "mic",
              label: "Microphone",
              status: "warn",
              detail: "Your browser will ask for access when the session starts.",
              fix: "Press Test microphone now to allow it ahead of time.",
            },
  );
  out.push(
    o.type === "phone"
      ? { id: "system", label: "Interviewer audio", status: "ok", detail: "Phone / room mode: your microphone hears both sides." }
      : !supportsDisplayAudio()
        ? {
            id: "system",
            label: "Interviewer audio",
            status: "warn",
            detail: "This browser can't share tab audio, so Orbit only hears your microphone.",
            fix: "Use Chrome or Edge on a computer, or the Orbit desktop app.",
          }
        : !o.systemAudio
          ? {
              id: "system",
              label: "Interviewer audio",
              status: "warn",
              detail: "Off — Orbit only hears your microphone.",
              fix: "Turn on Interviewer audio so Orbit can tell who's speaking.",
            }
          : { id: "system", label: "Interviewer audio", status: "ok", detail: "You'll share the meeting tab when the session starts." },
  );
  const picked = o.docs.filter((d) => o.selected.has(d.id));
  out.push(
    picked.some((d) => d.kind === "resume")
      ? { id: "resume", label: "Resume", status: "ok", detail: "Selected." }
      : {
          id: "resume",
          label: "Resume",
          status: "warn",
          detail: "None selected.",
          fix: "Add or tick your resume so answers use your real background.",
        },
  );
  out.push(
    picked.some((d) => d.kind === "job_description")
      ? { id: "jd", label: "Job description", status: "ok", detail: "Selected." }
      : {
          id: "jd",
          label: "Job description",
          status: "warn",
          detail: "None selected.",
          fix: "Optional: add the job description so answers fit the role.",
        },
  );
  return out;
}

export interface LiveLaunchState {
  micDeviceId?: string;
  systemAudio: boolean;
}

export function SessionSetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialType = (params.get("type") as SessionType | null) ?? "interview";
  const docs = useAsync(() => api.listDocuments(), []);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<SessionType>(SELECTABLE_TYPES.includes(initialType) ? initialType : "interview");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState("en");
  const [answerLanguage, setAnswerLanguage] = useState("en");
  const [length, setLength] = useState<AnswerLength>("standard");
  const [style, setStyle] = useState<AnswerStyle>("natural");
  const [thinking, setThinking] = useState<ThinkingLevel>(loadThinking);
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [responseTiming, setResponseTiming] = useState<ResponseTiming>(loadResponseTiming);
  const [systemAudio, setSystemAudio] = useState(type !== "phone");
  const [selectedDocs, setSelectedDocs] = useState<Set<string> | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const micPermission = useMicPermission();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WORKSPACE_KEY);
    } catch {
      return null;
    }
  });
  // Failing critical checks (server, AI, transcription, microphone, minutes): Start stays disabled unless the user
  // explicitly overrides — a broken setup must never slide into a live interview by default.
  const [blockers, setBlockers] = useState<PreflightCheck[]>([]);
  const [overrideBlockers, setOverrideBlockers] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const onPreflight = useCallback((b: PreflightCheck[]) => {
    setBlockers(b);
    if (b.length === 0) setOverrideBlockers(false);
  }, []);

  const applyWorkspace = (ws: Workspace | null) => {
    setWorkspaceId(ws?.id ?? null);
    try {
      if (ws) localStorage.setItem(WORKSPACE_KEY, ws.id);
      else localStorage.removeItem(WORKSPACE_KEY);
    } catch {
      // storage unavailable — the choice still applies to this session
    }
    if (!ws) return;
    if (SELECTABLE_TYPES.includes(ws.session_type)) setType(ws.session_type);
    setRole(ws.role ?? "");
    setInstructions(ws.notes ?? "");
    setLanguage(ws.language);
    setAnswerLanguage(ws.answer_language ?? ws.language);
    setLength(ws.length);
    setStyle(ws.style);
    setAutoAnswer(ws.auto_answer);
    setSelectedDocs(new Set(ws.document_ids));
  };
  // Restore the last-used setup once documents are loaded (its document ids replace the default selection).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !docs.data || !workspaceId) return;
    restored.current = true;
    api
      .listWorkspaces()
      .then((list) => applyWorkspace(list.find((w) => w.id === workspaceId) ?? null))
      .catch(() => undefined);
  }, [docs.data, workspaceId]);

  // Default selection: every ready resume + JD (spec §23 — not every document).
  useEffect(() => {
    if (!docs.data || selectedDocs !== null) return;
    setSelectedDocs(new Set(docs.data.filter((d) => d.status === "ready" && (d.kind === "resume" || d.kind === "job_description")).map((d) => d.id)));
  }, [docs.data, selectedDocs]);

  useEffect(() => {
    if (type === "phone") setSystemAudio(false);
  }, [type]);

  const refreshMics = async () => {
    try {
      setMics(await listMicrophones());
    } catch {
      setMics([]);
    }
  };
  useEffect(() => {
    void refreshMics();
    navigator.mediaDevices?.addEventListener("devicechange", refreshMics);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshMics);
     
  }, []);

  const toggleDoc = (id: string) =>
    setSelectedDocs((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setError(null);
    try {
      const session = await api.createSession({
        title: title.trim() || `${SESSION_TYPE_LABEL[type]}${role.trim() ? ` — ${role.trim()}` : ""}`,
        type,
        ...(role.trim() ? { role: role.trim() } : {}),
        language,
        ...(answerLanguage !== language ? { answer_language: answerLanguage } : {}),
        length,
        style,
        auto_answer: autoAnswer,
        document_ids: [...(selectedDocs ?? [])],
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      const launch: LiveLaunchState = { systemAudio, ...(micId ? { micDeviceId: micId } : {}) };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setStarting(false);
    }
  };

  const sortedDocs = [...(docs.data ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const localChecks = browserChecks({
    permission: micPermission,
    micCount: mics.filter((m) => m.deviceId).length,
    systemAudio,
    type,
    docs: docs.data ?? [],
    selected: selectedDocs ?? new Set(),
  });
  const blocked = blockers.length > 0 && !overrideBlockers;

  return (
    <div>
      <PageHeader icon={Rocket} title="New live session" subtitle="Pick your context and audio, then start. You can change answer length live." />
      <form ref={formRef} onSubmit={(e) => void start(e)} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <WorkspaceBar
            api={api}
            selectedId={workspaceId}
            onSelect={applyWorkspace}
            current={{
              role: role.trim() || null,
              session_type: type,
              language,
              answer_language: answerLanguage !== language ? answerLanguage : null,
              length,
              style,
              auto_answer: autoAnswer,
              notes: instructions.trim() || null,
              document_ids: [...(selectedDocs ?? [])],
            }}
          />
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Session name" htmlFor="title">
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme — onsite round 2" />
              </Field>
              <Field label="Session type" htmlFor="type">
                <Select id="type" value={type} onChange={(e) => setType(e.target.value as SessionType)}>
                  {SELECTABLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SESSION_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role / goal" htmlFor="role">
                <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Security Engineer" />
              </Field>
              <Field label="Answer style" htmlFor="style">
                <Select id="style" value={style} onChange={(e) => setStyle(e.target.value as AnswerStyle)}>
                  {ANSWER_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label} — {s.hint}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Answer length" htmlFor="length">
                <Select id="length" value={length} onChange={(e) => setLength(e.target.value as AnswerLength)}>
                  {LENGTHS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Thinking" htmlFor="thinking">
                <Select
                  id="thinking"
                  value={thinking}
                  onChange={(e) => {
                    const t = e.target.value as ThinkingLevel;
                    setThinking(t);
                    saveThinking(t);
                  }}
                >
                  {THINKING_LEVELS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} — {t.hint}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Listen in" htmlFor="language">
                <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Answer in" htmlFor="answer-language">
                <Select id="answer-language" value={answerLanguage} onChange={(e) => setAnswerLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="AI model" htmlFor="model" hint="Model routing is automatic: faster for behavioral, deeper for system design and coding.">
                <Select id="model" disabled value="default">
                  <option value="default">DeepSeek (default)</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Field
                label="Custom instructions (optional)"
                htmlFor="instructions"
                hint="Applied to every answer in this session, and saved with the setup."
              >
                <Textarea
                  id="instructions"
                  rows={2}
                  maxLength={1000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Mention I'm relocating to Berlin. Use British spelling. Keep examples from my fintech work."
                />
              </Field>
            </div>
            <div className="mt-5">
              <Toggle
                checked={autoAnswer}
                onChange={setAutoAnswer}
                label="Auto answer"
                description="On: answer each complete interviewer question automatically. Off: nothing is generated until you press Answer."
              />
            </div>
            {autoAnswer && (
              <div className="mt-4 max-w-sm">
                <Field label="Wait before answering" htmlFor="response-timing">
                  <Select
                    id="response-timing"
                    value={responseTiming}
                    onChange={(e) => {
                      const t = e.target.value as ResponseTiming;
                      setResponseTiming(t);
                      saveResponseTiming(t);
                    }}
                  >
                    {RESPONSE_TIMINGS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} — {t.hint}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">Context documents</h2>
            <p className="mb-4 text-sm text-zinc-500">Only checked documents are searched during this session.</p>
            {docs.loading ? (
              <Spinner />
            ) : docs.error ? (
              <ErrorNote onRetry={docs.reload}>{errorText(docs.error)}</ErrorNote>
            ) : sortedDocs.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No documents yet.{" "}
                <button type="button" className="font-medium text-indigo-600 underline dark:text-indigo-400" onClick={() => navigate("/documents")}>
                  Upload your resume
                </button>{" "}
                for grounded answers — or start without.
              </p>
            ) : (
              <ul className="space-y-2">
                {sortedDocs.map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        disabled={d.status !== "ready"}
                        checked={selectedDocs?.has(d.id) ?? false}
                        onChange={() => toggleDoc(d.id)}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="flex-1 truncate">{d.title}</span>
                      <span className="text-xs text-zinc-500">{d.status === "ready" ? d.kind.replace("_", " ") : d.status}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-semibold">Audio</h2>
            <div className="space-y-5">
              <Field label="Microphone (you)" htmlFor="mic">
                <Select id="mic" value={micId} onChange={(e) => setMicId(e.target.value)}>
                  <option value="">System default</option>
                  {mics
                    .filter((m) => m.deviceId && m.deviceId !== "default")
                    .map((m) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label || "Microphone"}
                      </option>
                    ))}
                </Select>
              </Field>
              <MicTest deviceId={micId || undefined} onGranted={() => void refreshMics()} />
              <PermissionLine permission={micPermission} />

              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <Toggle
                  checked={systemAudio}
                  onChange={setSystemAudio}
                  disabled={!supportsDisplayAudio() || type === "phone"}
                  label="Interviewer audio (tab share)"
                  description={
                    type === "phone"
                      ? "Phone / room mode listens through your microphone only."
                      : supportsDisplayAudio()
                        ? "In the browser, you’ll share the meeting tab with “Share tab audio” on. Only audio is used — no video is recorded."
                        : "This browser can’t capture tab audio. Use Chrome/Edge or the desktop app."
                  }
                />
                {systemAudio && supportsDisplayAudio() && <SystemAudioTest />}
              </div>
              <p className="text-xs text-zinc-500">
                For the most reliable interviewer capture (any app, not just a browser tab), use the Orbit desktop app.
              </p>
            </div>
          </Card>

          <PreflightPanel api={api} healthUrl={`${API_URL}/health`} local={localChecks} onStatus={onPreflight} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" size="lg" className="w-full" disabled={starting || blocked}>
            {starting
              ? "Starting…"
              : blocked
                ? `Fix ${blockers.length} problem${blockers.length === 1 ? "" : "s"} to start`
                : "Start Session"}
          </Button>
          {blocked && !starting && (
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
              className={cx(
                "w-full text-center text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200",
                focusRing,
              )}
            >
              Start without these checks
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function PermissionLine({ permission }: { permission: ReturnType<typeof useMicPermission> }) {
  if (permission === "granted") return <p className="text-xs text-emerald-600 dark:text-emerald-400">Microphone permission granted.</p>;
  if (permission === "denied")
    return (
      <p className="text-xs text-rose-600 dark:text-rose-400">
        Microphone blocked. Allow it from the lock icon in your browser’s address bar, then reload.
      </p>
    );
  return <p className="text-xs text-zinc-500">Your browser will ask for microphone access when you test or start.</p>;
}

const TEST_LIMIT_MS = 30_000; // the mic indicator shouldn't stay on because someone forgot the test

const VERDICT_STYLE: Record<Verdict, string> = {
  waiting: "text-zinc-500 dark:text-zinc-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  silent: "text-amber-600 dark:text-amber-400",
  too_loud: "text-amber-600 dark:text-amber-400",
  dropouts: "text-rose-600 dark:text-rose-400",
  no_audio: "text-rose-600 dark:text-rose-400",
};

/**
 * A level meter plus the same diagnosis the desktop app gives (delivery, dropouts, silence, loudness), measured in
 * the browser from the capture frames. Nothing is sent to the server.
 */
function useLevelCapture(kind: "mic" | "system") {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ChannelSummary | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const stats = useRef(newChannelStats());
  const startedAt = useRef(0);

  const stop = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setActive(false);
    setLevel(0);
  };

  const start = async (open: () => Promise<MediaStream>) => {
    stop();
    setError(null);
    setSummary(null);
    try {
      const stream = await open();
      stats.current = newChannelStats();
      startedAt.current = performance.now();
      captureRef.current = await captureStream(stream, (f) => {
        setLevel(levelFromRms(f.rms));
        stats.current = addFrame(stats.current, f.rms, performance.now());
      });
      stream.getAudioTracks()[0]?.addEventListener("ended", stop);
      setActive(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  // Re-diagnose twice a second while testing; stop on its own after 30 s.
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      const now = performance.now();
      setSummary(summarizeChannel(stats.current, startedAt.current, now, kind));
      if (now - startedAt.current > TEST_LIMIT_MS) stop();
    }, 500);
    return () => clearInterval(tick);
  }, [active, kind]);

  useEffect(() => () => captureRef.current?.stop(), []);
  return { level, active, error, summary, start, stop };
}

function TestResult({ summary }: { summary: ChannelSummary | null }) {
  if (!summary) return null;
  return (
    <p role="status" className={cx("text-xs", VERDICT_STYLE[summary.verdict])}>
      {summary.advice}
    </p>
  );
}

function MicTest({ deviceId, onGranted }: { deviceId?: string; onGranted: () => void }) {
  const t = useLevelCapture("mic");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            t.active
              ? t.stop()
              : void t.start(async () => {
                  const s = await openMicrophone(deviceId);
                  onGranted();
                  return s;
                })
          }
        >
          {t.active ? "Stop test" : "Test microphone"}
        </Button>
        <div className="flex-1">
          <Meter level={t.level} label="Microphone" />
        </div>
      </div>
      <TestResult summary={t.summary} />
      {t.error && <p className="text-xs text-rose-600 dark:text-rose-400">{t.error}</p>}
    </div>
  );
}

function SystemAudioTest() {
  const t = useLevelCapture("system");
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => (t.active ? t.stop() : void t.start(openDisplayAudio))}>
          {t.active ? "Stop test" : "Test tab audio"}
        </Button>
        <div className="flex-1">
          <Meter level={t.level} label="Tab audio" />
        </div>
      </div>
      <TestResult summary={t.summary} />
      {t.error && <p className="text-xs text-rose-600 dark:text-rose-400">{t.error}</p>}
    </div>
  );
}
