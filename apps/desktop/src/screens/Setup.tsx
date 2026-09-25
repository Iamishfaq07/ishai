import { type ReactNode, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type {
  AnswerLength,
  AnswerStyle,
  DocumentKind,
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
import { AUDIO_CHANNEL } from "@orbit/types";
import {
  confirmDialog,
  ArrowLeft,
  FileText,
  HistoryIcon,
  LogOut,
  SettingsIcon,
  RefreshCw,
  Trash2,
  ANSWER_STYLES,
  RESPONSE_TIMINGS,
  THINKING_LEVELS,
  cx,
  focusRing,
  loadResponseTiming,
  loadThinking,
  saveResponseTiming,
  saveThinking,
  addFrame,
  diagnosticsReport,
  newChannelStats,
  summarizeChannel,
  type ChannelSummary,
  type DiagnosticsEvent,
  type Verdict,
} from "@orbit/ui";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "../api";
import {
  deviceStatusText,
  listAudioApps,
  listAudioDevices,
  listOutputDevices,
  startCapture,
  stopCapture,
  type AudioApp,
  type NativeAudioDevice,
} from "../native";
import { PreflightPanel, type LocalAudioState } from "../PreflightPanel";
import { TitleBar } from "../TitleBar";
import { UpdateBanner } from "../UpdateBanner";
import { WorkspaceBar } from "../WorkspaceBar";
import type { DesktopLaunch } from "./Live";

const TYPES: Array<{ value: SessionType; label: string }> = [
  { value: "interview", label: "Interview" },
  { value: "coding", label: "Coding interview" },
  { value: "meeting", label: "Professional meeting" },
  { value: "assessment", label: "Online assessment practice" },
  { value: "phone", label: "Phone / room audio" },
  { value: "mock", label: "Mock interview — the AI asks, you practise" },
];

const PERSONAS: Array<{ value: MockPersona; label: string }> = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "engineer", label: "Senior engineer" },
  { value: "staff_engineer", label: "Staff engineer" },
  { value: "executive", label: "Executive" },
];
const MOCK_TYPES: Array<{ value: MockInterviewType; label: string }> = [
  { value: "mixed", label: "Mixed" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "system_design", label: "System design" },
  { value: "coding", label: "Coding" },
];

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
];

const DOC_KINDS: Array<{ value: DocumentKind; label: string }> = [
  { value: "resume", label: "Resume" },
  { value: "job_description", label: "Job description" },
  { value: "notes", label: "Notes" },
  { value: "other", label: "Other" },
];

const MAX_UPLOAD_MB = 10;

function docError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const IS_MAC = /Mac/i.test(navigator.userAgent);
/** Meeting apps pre-selected as the interviewer audio source when they're running. */
const MEETING_APPS = new Set(["zoom.exe", "ms-teams.exe", "teams.exe", "webexmta.exe", "ciscocollabhost.exe", "skype.exe", "slack.exe", "discord.exe"]);

const control =
  "block w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900";

const MIC_KEY = "orbit.micDeviceId";
const WORKSPACE_KEY = "orbit.workspaceId";
const OUTPUT_KEY = "orbit.outputSource";

/** " (Speakers — Realtek)" for the current default / communications output, if known. */
function defaultName(outputs: NativeAudioDevice[], communications: boolean): string {
  const d = outputs.find((o) => (communications ? o.isCommunications : o.isDefault));
  return d ? ` (${d.name})` : "";
}

function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

export function SetupScreen({
  user,
  notice,
  initialType,
  onSignOut,
  onStart,
  onBack,
  onOpenDocuments,
  onOpenHistory,
  onOpenSettings,
}: {
  user: User | null;
  /** Account notice under the title bar (e.g. verify your email). */
  notice?: ReactNode;
  initialType?: SessionType;
  onSignOut: () => void;
  onStart: (session: OrbitSession, launch: DesktopLaunch) => void;
  onBack: () => void;
  onOpenDocuments: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}) {
  const [type, setType] = useState<SessionType>(initialType ?? "interview");
  const [role, setRole] = useState("");
  const [length, setLength] = useState<AnswerLength>("short");
  const [style, setStyle] = useState<AnswerStyle>("natural");
  const [thinking, setThinking] = useState<ThinkingLevel>(loadThinking);
  const [language, setLanguage] = useState("en");
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [responseTiming, setResponseTiming] = useState<ResponseTiming>(loadResponseTiming);
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
  const [micId, setMicIdState] = useState(() => localStorage.getItem(MIC_KEY) ?? "");
  const setMicId = (id: string) => {
    setMicIdState(id);
    localStorage.setItem(MIC_KEY, id);
  };
  const [systemAudio, setSystemAudio] = useState(!IS_MAC);
  const [apps, setApps] = useState<AudioApp[]>([]);
  // What to listen to: "app:<pid>" (one app), or an output: "out:default" | "out:communications" | "out:<id>".
  const [source, setSource] = useState<string>(() => localStorage.getItem(OUTPUT_KEY) ?? "out:default");
  const appTouched = useRef(false);
  const appPid = source.startsWith("app:") ? source.slice(4) : "";
  const systemDevice = source.startsWith("out:") ? source.slice(4) : undefined;
  const chooseSource = (value: string) => {
    appTouched.current = true;
    setSource(value);
    if (value.startsWith("out:")) localStorage.setItem(OUTPUT_KEY, value);
  };

  const refreshApps = () => {
    void listAudioApps().then((list) => {
      setApps(list);
      const savedOutput = localStorage.getItem(OUTPUT_KEY) ?? "out:default";
      if (appTouched.current) {
        // keep the user's choice unless that app has gone away
        setSource((s) => (s.startsWith("app:") && !list.some((a) => `app:${a.pid}` === s) ? savedOutput : s));
        return;
      }
      const meeting = list.find((a) => MEETING_APPS.has(a.exe.toLowerCase()));
      setSource(meeting ? `app:${meeting.pid}` : savedOutput);
    });
    void listOutputDevices().then(setOutputs);
  };
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mockPersona, setMockPersona] = useState<MockPersona>("hiring_manager");
  const [mockType, setMockType] = useState<MockInterviewType>("mixed");
  const [mockDifficulty, setMockDifficulty] = useState<MockDifficulty>("medium");
  const [mockMinutes, setMockMinutes] = useState(20);
  const isMock = type === "mock";
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem(WORKSPACE_KEY));
  // Failing critical checks (server, AI, transcription, mic, minutes, verification): Start is disabled unless the user
  // explicitly overrides — a broken setup must never slide into a live interview by default.
  const [blockers, setBlockers] = useState<PreflightCheck[]>([]);
  const [overrideBlockers, setOverrideBlockers] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const applyWorkspace = (ws: Workspace | null) => {
    setWorkspaceId(ws?.id ?? null);
    if (ws) localStorage.setItem(WORKSPACE_KEY, ws.id);
    else localStorage.removeItem(WORKSPACE_KEY);
    if (!ws) return;
    setType(ws.session_type);
    setRole(ws.role ?? "");
    setLanguage(ws.language);
    setLength(ws.length);
    setStyle(ws.style);
    setAutoAnswer(ws.auto_answer);
    setSelected(new Set(ws.document_ids));
  };
  // Restore the last-used setup once documents are loaded (its document ids replace the default selection).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || docs === null || !workspaceId) return;
    restored.current = true;
    api
      .listWorkspaces()
      .then((list) => applyWorkspace(list.find((w) => w.id === workspaceId) ?? null))
      .catch(() => undefined);
  }, [docs, workspaceId]);

  useEffect(() => {
    api
      .listDocuments()
      .then((list) => {
        setDocs(list);
        setSelected(
          new Set(list.filter((d) => d.status === "ready" && (d.kind === "resume" || d.kind === "job_description")).map((d) => d.id)),
        );
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t load documents."));
    if (!IS_MAC) refreshApps();
    listAudioDevices()
      .then(setDevices)
      .catch((err: unknown) => setError(`Couldn’t list audio devices: ${String(err)}`));
  }, []);

  useEffect(() => {
    if (type === "phone" || type === "mock") setSystemAudio(false);
  }, [type]);

  const refreshDocs = async (selectId?: string): Promise<void> => {
    const list = await api.listDocuments();
    setDocs(list);
    if (selectId) setSelected((prev) => new Set(prev).add(selectId));
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
      const kindLabel = DOC_KINDS.find((k) => k.value === uploadKind)?.label ?? "Document";
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

  const toggleDoc = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  const localState: LocalAudioState = {
    micName: (micDevice ?? devices.find((d) => d.isDefault) ?? devices[0])?.name ?? null,
    systemAudio,
    interviewerSource: appPid
      ? selectedIsBrowser
        ? `Capturing ${selectedApp?.name ?? "the browser"} (all its tabs)`
        : `Capturing ${selectedApp?.name ?? "the selected app"} only`
      : `Capturing ${outputName(systemDevice) ?? "the default output"}`,
    hasResume: selectedDocs.some((d) => d.kind === "resume"),
    hasJobDescription: selectedDocs.some((d) => d.kind === "job_description"),
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (blockers.length > 0 && !overrideBlockers) return;
    setStarting(true);
    setError(null);
    try {
      const session = await api.createSession({
        title: `${TYPES.find((t) => t.value === type)?.label ?? "Session"}${role.trim() ? ` — ${role.trim()}` : ""}`,
        type,
        ...(role.trim() ? { role: role.trim() } : {}),
        language,
        length,
        style,
        auto_answer: isMock ? false : autoAnswer,
        document_ids: [...selected],
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(isMock
          ? { mock: { interview_type: mockType, difficulty: mockDifficulty, duration_minutes: mockMinutes, persona: mockPersona } }
          : {}),
      });
      onStart(session, {
        systemAudio,
        ...(micId ? { micDeviceId: micId } : {}),
        ...(systemAudio && appPid ? { systemProcessId: Number(appPid) } : {}),
        ...(systemAudio && systemDevice ? { systemDevice } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start the session.");
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <button type="button" onClick={onBack} className={cx("inline-flex items-center gap-1 rounded px-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </button>
        <button type="button" onClick={onOpenDocuments} title="Documents" aria-label="Documents" className={cx("rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <FileText className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenHistory} title="History" aria-label="History" className={cx("rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <HistoryIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenSettings} title="Settings" aria-label="Settings" className={cx("rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <SettingsIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out" className={cx("rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <LogOut className="h-4 w-4" />
        </button>
      </TitleBar>
      {notice}
      <UpdateBanner />
      <form ref={formRef} onSubmit={(e) => void start(e)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <p className="text-xs text-zinc-500">{user ? `Signed in as ${user.email}` : "Offline — some data may be unavailable."}</p>

          <WorkspaceBar
            selectedId={workspaceId}
            onSelect={applyWorkspace}
            current={{
              role: role.trim() || null,
              session_type: type,
              language,
              length,
              style,
              auto_answer: autoAnswer,
              document_ids: [...selected],
            }}
          />

          <label className="block space-y-1">
            <span className="text-xs font-medium">Session type</span>
            <select value={type} onChange={(e) => setType(e.target.value as SessionType)} className={cx(control, focusRing)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {isMock && (
            <fieldset className="grid grid-cols-2 gap-2 rounded-xl border border-indigo-200/60 bg-indigo-50/40 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
              <legend className="px-1 text-xs font-medium">Mock interview</legend>
              <p className="col-span-2 text-xs text-zinc-500">The AI interviewer asks out loud, follows up on what you say, and you get a graded review at the end. Only your microphone is used.</p>
              <label className="space-y-1"><span className="text-xs">Interviewer</span>
                <select value={mockPersona} onChange={(e) => setMockPersona(e.target.value as MockPersona)} className={cx(control, focusRing)}>
                  {PERSONAS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select></label>
              <label className="space-y-1"><span className="text-xs">Focus</span>
                <select value={mockType} onChange={(e) => setMockType(e.target.value as MockInterviewType)} className={cx(control, focusRing)}>
                  {MOCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></label>
              <label className="space-y-1"><span className="text-xs">Difficulty</span>
                <select value={mockDifficulty} onChange={(e) => setMockDifficulty(e.target.value as MockDifficulty)} className={cx(control, focusRing)}>
                  <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </select></label>
              <label className="space-y-1"><span className="text-xs">Length</span>
                <select value={mockMinutes} onChange={(e) => setMockMinutes(Number(e.target.value))} className={cx(control, focusRing)}>
                  {[10, 20, 30, 45].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </select></label>
            </fieldset>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium">Role / goal</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Security Engineer" className={cx(control, focusRing)} />
          </label>

          <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-xs font-medium">Context documents</legend>
            <p className="text-xs text-zinc-500">Add your resume and the job description so answers are specific to you. Checked documents are used this session.</p>

            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value as DocumentKind)}
                aria-label="Document type"
                className={cx(control, focusRing, "w-auto flex-none")}
              >
                {DOC_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => void onFilePicked(e)}
                className="hidden"
                id="doc-file"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className={cx("rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
              >
                {uploading ? "Uploading…" : "Upload file"}
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => setPasteOpen((v) => !v)}
                className={cx("rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-800", focusRing)}
              >
                Paste text
              </button>
            </div>
            <p className="text-xs text-zinc-400">PDF, DOCX, TXT or MD, up to {MAX_UPLOAD_MB} MB.</p>

            {pasteOpen && (
              <div className="space-y-1.5 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
                <input
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className={cx(control, focusRing, "text-xs")}
                />
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste the job description, your resume text, or notes…"
                  rows={4}
                  className={cx(control, focusRing, "text-xs")}
                />
                <button
                  type="button"
                  disabled={uploading || pasteText.trim().length < 20}
                  onClick={() => void onPasteSave()}
                  className={cx("rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
                >
                  Save
                </button>
              </div>
            )}

            {docs === null ? (
              <p className="text-xs text-zinc-500">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-zinc-500">No documents yet — upload your resume above.</p>
            ) : (
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      disabled={d.status !== "ready"}
                      checked={selected.has(d.id)}
                      onChange={() => toggleDoc(d.id)}
                      aria-label={`Use ${d.title}`}
                    />
                    <span className="flex-1 truncate">{d.title}</span>
                    <span className="text-zinc-500">{d.status === "ready" ? d.kind.replace("_", " ") : d.status}</span>
                    <button
                      type="button"
                      onClick={() => void onDeleteDoc(d.id)}
                      aria-label={`Delete ${d.title}`}
                      title="Delete"
                      className={cx("rounded p-1 text-zinc-400 hover:text-rose-600", focusRing)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Answer length</span>
              <select value={length} onChange={(e) => setLength(e.target.value as AnswerLength)} className={cx(control, focusRing)}>
                <option value="short">Short (~30s)</option>
                <option value="standard">Standard (~60s)</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Answering</span>
              <select
                value={autoAnswer ? "auto" : "manual"}
                onChange={(e) => setAutoAnswer(e.target.value === "auto")}
                className={cx(control, focusRing)}
              >
                <option value="auto">Automatic</option>
                <option value="manual">When I click Answer</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium">Thinking</span>
            <select
              value={thinking}
              onChange={(e) => {
                const t = e.target.value as ThinkingLevel;
                setThinking(t);
                saveThinking(t);
              }}
              className={cx(control, focusRing)}
            >
              {THINKING_LEVELS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.hint}
                </option>
              ))}
            </select>
          </label>

          {autoAnswer && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">Wait before answering</span>
              <select
                value={responseTiming}
                onChange={(e) => {
                  const t = e.target.value as ResponseTiming;
                  setResponseTiming(t);
                  saveResponseTiming(t);
                }}
                className={cx(control, focusRing)}
              >
                {RESPONSE_TIMINGS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Answer style</span>
              <select value={style} onChange={(e) => setStyle(e.target.value as AnswerStyle)} className={cx(control, focusRing)}>
                {ANSWER_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} — {s.hint}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={cx(control, focusRing)}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Microphone (you)</span>
              <select value={micId} onChange={(e) => setMicId(e.target.value)} className={cx(control, focusRing)}>
                <option value="">System default{devices.find((d) => d.isDefault) ? ` (${devices.find((d) => d.isDefault)!.name})` : ""}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.isDefault ? " (default)" : ""}
                  </option>
                ))}
                {micId && devices.length > 0 && !devices.some((d) => d.id === micId) && (
                  <option value={micId}>Saved microphone (not connected — will use default)</option>
                )}
              </select>
            </label>
            <label className={cx("flex items-start gap-2 text-xs", (IS_MAC || type === "phone") && "opacity-60")}>
              <input
                type="checkbox"
                checked={systemAudio}
                disabled={IS_MAC || type === "phone"}
                onChange={(e) => setSystemAudio(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Interviewer audio (system output)</span>
                <span className="block text-zinc-500">
                  {IS_MAC
                    ? "macOS system audio capture (ScreenCaptureKit) isn’t implemented yet — Orbit will listen through your microphone."
                    : type === "phone"
                      ? "Phone / room mode uses your microphone only."
                      : "Kept separate from your mic, so Orbit knows who's speaking."}
                </span>
              </span>
            </label>
            {systemAudio && !IS_MAC && (
              <div className="space-y-1">
                <span className="text-xs font-medium">Listen to</span>
                <div className="flex gap-1.5">
                  <select
                    value={source}
                    onChange={(e) => chooseSource(e.target.value)}
                    aria-label="Interviewer audio source"
                    className={cx(control, focusRing)}
                  >
                    {apps.length > 0 && (
                      <optgroup label="Just one app (recommended)">
                        {apps.map((a) => (
                          <option key={a.pid} value={`app:${a.pid}`}>
                            {a.name}
                            {a.active ? " — playing" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Everything an output plays">
                      <option value="out:default">Default output{defaultName(outputs, false)}</option>
                      <option value="out:communications">Call audio — communications device{defaultName(outputs, true)}</option>
                      {outputs.map((d) => (
                        <option key={d.id} value={`out:${d.id}`}>
                          {d.name}
                        </option>
                      ))}
                      {systemDevice && !["default", "communications"].includes(systemDevice) &&
                        !outputs.some((d) => d.id === systemDevice) && (
                          <option value={source}>Saved device (not connected — will use default)</option>
                        )}
                    </optgroup>
                  </select>
                  <button type="button" onClick={refreshApps} title="Refresh app list" aria-label="Refresh app list" className={cx("inline-flex items-center rounded-lg border border-zinc-200 px-2 text-xs dark:border-zinc-800", focusRing)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  {appPid && selectedIsBrowser
                    ? "Captures this browser's audio. Other tabs playing sound in the same browser will be heard too — close or mute them."
                    : appPid
                    ? "Only this app is captured — games, music and notifications are ignored."
                    : systemDevice === "communications"
                      ? "Captures the device Windows uses for calls (often your headset). Everything it plays is heard."
                      : "Everything this output plays is captured. Pick your meeting app to ignore other sounds."}
                  {!appPid && " If a device is unplugged, Orbit switches to the default and back by itself."}
                </p>
              </div>
            )}
            <AudioTest
              micId={micId || undefined}
              systemAudio={systemAudio}
              systemProcessId={appPid ? Number(appPid) : undefined}
              systemDevice={systemDevice}
              micLabel={localState.micName ?? "default"}
              listenTo={appPid ? `app: ${selectedApp?.exe.split(/[\\/]/).pop() ?? "unknown"}` : `output: ${outputName(systemDevice) ?? "default"}`}
              devices={devices}
              outputs={outputs}
            />
          </div>

          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <PreflightPanel
            local={localState}
            onStatus={(b) => {
              setBlockers(b);
              if (b.length === 0) setOverrideBlockers(false);
            }}
          />
          <button
            type="submit"
            disabled={starting || (blockers.length > 0 && !overrideBlockers)}
            className={cx("w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
          >
            {starting
              ? "Starting…"
              : blockers.length > 0 && !overrideBlockers
                ? `Fix ${blockers.length} problem${blockers.length === 1 ? "" : "s"} to start`
                : "Start Session"}
          </button>
          {blockers.length > 0 && !overrideBlockers && !starting && (
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
          <button
            type="button"
            onClick={() => void openUrl(`${WEB_URL}/sessions`)}
            className={cx("mt-2 w-full text-center text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
          >
            History, documents & billing open in your browser
          </button>
        </div>
      </form>
    </div>
  );
}

const TEST_LIMIT_MS = 30_000; // the mic indicator shouldn't stay on because someone forgot the test

const VERDICT_STYLE: Record<Verdict, string> = {
  waiting: "text-zinc-500",
  ok: "text-emerald-600 dark:text-emerald-400",
  silent: "text-amber-600 dark:text-amber-400",
  too_loud: "text-amber-600 dark:text-amber-400",
  dropouts: "text-rose-600 dark:text-rose-400",
  no_audio: "text-rose-600 dark:text-rose-400",
};

/**
 * "Test audio": live meters plus diagnostics (§23): delivery, dropouts, silence and loudness per channel,
 * measured locally from the capture frames. Nothing is sent to the server. "Copy diagnostics" produces a
 * shareable report with measurements and settings only.
 */
function AudioTest({
  micId,
  systemAudio,
  systemProcessId,
  systemDevice,
  micLabel,
  listenTo,
  devices,
  outputs,
}: {
  micId?: string;
  systemAudio: boolean;
  systemProcessId?: number | undefined;
  systemDevice?: string | undefined;
  micLabel: string;
  listenTo: string;
  devices: NativeAudioDevice[];
  outputs: NativeAudioDevice[];
}) {
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [note, setNote] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<{ mic: ChannelSummary; system: ChannelSummary | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);
  const stats = useRef({ mic: newChannelStats(), system: newChannelStats() });
  const startedAt = useRef(0);
  const events = useRef<DiagnosticsEvent[]>([]);

  const measure = () => {
    const now = performance.now();
    setSummaries({
      mic: summarizeChannel(stats.current.mic, startedAt.current, now, "mic"),
      system: systemAudio ? summarizeChannel(stats.current.system, startedAt.current, now, "system") : null,
    });
  };

  const stop = async () => {
    if (runningRef.current) measure();
    runningRef.current = false;
    setRunning(false);
    setLevels([0, 0]);
    await stopCapture().catch(() => undefined);
  };

  const start = async () => {
    setNote(null);
    setCopied(false);
    stats.current = { mic: newChannelStats(), system: newChannelStats() };
    events.current = [];
    setSummaries(null);
    try {
      runningRef.current = true;
      const options = {
        ...(micId ? { micDeviceId: micId } : {}),
        systemAudio,
        ...(systemProcessId ? { systemProcessId } : {}),
        ...(systemDevice ? { systemDevice } : {}),
      };
      const t0 = performance.now();
      startedAt.current = t0;
      const log = (channel: "mic" | "system", kind: "status" | "error", detail: string) =>
        events.current.length < 50 &&
        events.current.push({ t: Math.round((performance.now() - t0) / 100) / 10, channel, kind, detail });
      const info = await startCapture(options, (ev) => {
        if (!runningRef.current) return;
        const channel = ev.channel === AUDIO_CHANNEL.mic ? "mic" : "system";
        if (ev.kind === "frame") {
          addFrame(stats.current[channel], ev.rms, performance.now());
          setLevels((prev) => {
            const next: [number, number] = [prev[0], prev[1]];
            next[channel === "mic" ? 0 : 1] = levelFromRms(ev.rms);
            return next;
          });
        } else if (ev.kind === "status") {
          log(channel, "status", `${ev.state}: ${ev.device}`);
          const text = deviceStatusText(ev);
          if (text) setNote(text);
        } else {
          log(channel, "error", ev.message);
          setNote(ev.message);
        }
      });
      if (info.micError) log("mic", "error", info.micError);
      if (systemAudio && info.systemError) {
        log("system", "error", info.systemError);
        setNote(info.systemError);
      }
      setRunning(true);
    } catch (err) {
      runningRef.current = false;
      setNote(String(err));
    }
  };

  // Re-measure twice a second while running; stop by itself at the limit.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      measure();
      if (performance.now() - startedAt.current >= TEST_LIMIT_MS) void stop();
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(
    () => () => {
      if (runningRef.current) void stopCapture();
    },
    [],
  );

  const copy = async () => {
    if (!summaries) return;
    const report = diagnosticsReport({
      appVersion: await getVersion().catch(() => null),
      userAgent: navigator.userAgent,
      selection: { mic: micLabel, listenTo },
      devices: {
        mics: devices.map((d) => ({ name: d.name, isDefault: d.isDefault })),
        outputs: outputs.map((d) => ({ name: d.name, isDefault: d.isDefault })),
      },
      channels: summaries,
      events: events.current,
    });
    await writeText(report);
    setCopied(true);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void (running ? stop() : start())}
          className={cx("rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900", focusRing)}
        >
          {running ? "Stop test" : "Test audio"}
        </button>
        {summaries && !running && (
          <button
            type="button"
            onClick={() => void copy()}
            title="Copies a report with measurements and device settings only: no audio, transcript or account details"
            className={cx("rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}
          >
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
        )}
      </div>
      <LevelRow label="Mic" level={levels[0]} />
      {summaries && <ChannelResult summary={summaries.mic} />}
      {systemAudio && <LevelRow label="System" level={levels[1]} />}
      {systemAudio && summaries?.system && <ChannelResult summary={summaries.system} />}
      {note && <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}

function ChannelResult({ summary: s }: { summary: ChannelSummary }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div role="status" className="pl-14 text-xs">
      <p className={VERDICT_STYLE[s.verdict]}>{s.advice}</p>
      {s.verdict !== "waiting" && (
        <p className="text-zinc-500 tabular-nums">
          {s.seconds}s · received {pct(s.delivery)} · dropouts {s.dropouts} · silent {pct(s.silentShare)}
          {s.averageDbfs !== null && ` · avg ${s.averageDbfs} dBFS, peak ${s.peakDbfs} dBFS`}
        </p>
      )}
    </div>
  );
}

function LevelRow({ label, level }: { label: string; level: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span className="w-12">{label}</span>
      <div
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
    </div>
  );
}

const BROWSER_EXES = new Set(["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe"]);
function isBrowserExe(exe: string): boolean {
  return BROWSER_EXES.has(exe.split(/[\\/]/).pop()?.toLowerCase() ?? "");
}
