import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AnswerLength, AnswerStyle, DocumentKind, ResponseTiming, SessionType, ThinkingLevel } from "@orbit/types";
import {
  ANSWER_STYLES,
  RESPONSE_TIMINGS,
  THINKING_LEVELS,
  loadResponseTiming,
  loadThinking,
  saveResponseTiming,
  saveThinking,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Meter, PageHeader, Select, Spinner, Toggle } from "../components/ui";
import { api } from "../lib/api";
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
      });
      const launch: LiveLaunchState = { systemAudio, ...(micId ? { micDeviceId: micId } : {}) };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setStarting(false);
    }
  };

  const sortedDocs = [...(docs.data ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  return (
    <div>
      <PageHeader title="New live session" subtitle="Pick your context and audio, then start. You can change answer length live." />
      <form onSubmit={(e) => void start(e)} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
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

          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" size="lg" className="w-full" disabled={starting}>
            {starting ? "Starting…" : "Start Session"}
          </Button>
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

function useLevelCapture() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);

  const stop = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setActive(false);
    setLevel(0);
  };

  const start = async (open: () => Promise<MediaStream>) => {
    stop();
    setError(null);
    try {
      const stream = await open();
      captureRef.current = await captureStream(stream, (f) => setLevel(levelFromRms(f.rms)));
      stream.getAudioTracks()[0]?.addEventListener("ended", stop);
      setActive(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => () => captureRef.current?.stop(), []);
  return { level, active, error, start, stop };
}

function MicTest({ deviceId, onGranted }: { deviceId?: string; onGranted: () => void }) {
  const t = useLevelCapture();
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
      {t.error && <p className="text-xs text-rose-600 dark:text-rose-400">{t.error}</p>}
    </div>
  );
}

function SystemAudioTest() {
  const t = useLevelCapture();
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
      {t.error && <p className="text-xs text-rose-600 dark:text-rose-400">{t.error}</p>}
    </div>
  );
}
