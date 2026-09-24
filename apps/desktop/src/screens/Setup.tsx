import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { AnswerLength, AnswerStyle, DocumentKind, OrbitDocument, OrbitSession, SessionType, User } from "@orbit/types";
import { AUDIO_CHANNEL } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "../api";
import { listAudioApps, listAudioDevices, startCapture, stopCapture, type AudioApp, type NativeAudioDevice } from "../native";
import { TitleBar } from "../TitleBar";
import { UpdateBanner } from "../UpdateBanner";
import type { DesktopLaunch } from "./Live";

const TYPES: Array<{ value: SessionType; label: string }> = [
  { value: "interview", label: "Interview" },
  { value: "coding", label: "Coding interview" },
  { value: "meeting", label: "Professional meeting" },
  { value: "assessment", label: "Online assessment practice" },
  { value: "phone", label: "Phone / room audio" },
];

const STYLES: Array<{ value: AnswerStyle; label: string }> = [
  { value: "bullets", label: "Bullets" },
  { value: "star", label: "STAR (behavioral)" },
  { value: "technical", label: "Technical depth" },
  { value: "executive", label: "Executive" },
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

function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

export function SetupScreen({
  user,
  initialType,
  onSignOut,
  onStart,
  onBack,
  onOpenDocuments,
  onOpenHistory,
  onOpenSettings,
}: {
  user: User | null;
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
  const [style, setStyle] = useState<AnswerStyle>("bullets");
  const [language, setLanguage] = useState("en");
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [docs, setDocs] = useState<OrbitDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadKind, setUploadKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [devices, setDevices] = useState<NativeAudioDevice[]>([]);
  const [micId, setMicId] = useState("");
  const [systemAudio, setSystemAudio] = useState(!IS_MAC);
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [appPid, setAppPid] = useState<string>(""); // "" = all system audio
  const appTouched = useRef(false);

  const refreshApps = () => {
    void listAudioApps().then((list) => {
      setApps(list);
      if (appTouched.current) {
        // keep the user's choice unless that app has gone away
        setAppPid((pid) => (pid && !list.some((a) => String(a.pid) === pid) ? "" : pid));
        return;
      }
      const meeting = list.find((a) => MEETING_APPS.has(a.exe.toLowerCase()));
      setAppPid(meeting ? String(meeting.pid) : "");
    });
  };
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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
    if (type === "phone") setSystemAudio(false);
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

  const start = async (e: FormEvent) => {
    e.preventDefault();
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
        auto_answer: autoAnswer,
        document_ids: [...selected],
      });
      onStart(session, {
        systemAudio,
        ...(micId ? { micDeviceId: micId } : {}),
        ...(systemAudio && appPid ? { systemProcessId: Number(appPid) } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start the session.");
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <button type="button" onClick={onBack} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          ← Home
        </button>
        <button type="button" onClick={onOpenDocuments} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          Documents
        </button>
        <button type="button" onClick={onOpenHistory} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          History
        </button>
        <button type="button" onClick={onOpenSettings} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          Settings
        </button>
        <button type="button" onClick={onSignOut} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          Sign out
        </button>
      </TitleBar>
      <UpdateBanner />
      <form onSubmit={(e) => void start(e)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <p className="text-xs text-zinc-500">{user ? `Signed in as ${user.email}` : "Offline — some data may be unavailable."}</p>

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

          <label className="block space-y-1">
            <span className="text-xs font-medium">Role / goal</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Security Engineer" className={cx(control, focusRing)} />
          </label>

          <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-xs font-medium">Context documents</legend>
            <p className="text-[11px] text-zinc-500">Add your resume and the job description so answers are specific to you. Checked documents are used this session.</p>

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
            <p className="text-[11px] text-zinc-400">PDF, DOCX, TXT or MD, up to {MAX_UPLOAD_MB} MB.</p>

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
                      className={cx("rounded px-1 text-zinc-400 hover:text-rose-600", focusRing)}
                    >
                      ✕
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
            <label className="flex items-end gap-2 pb-1.5 text-xs font-medium">
              <input type="checkbox" checked={autoAnswer} onChange={(e) => setAutoAnswer(e.target.checked)} />
              Auto answer
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Answer style</span>
              <select value={style} onChange={(e) => setStyle(e.target.value as AnswerStyle)} className={cx(control, focusRing)}>
                {STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
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
                <option value="">System default</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.isDefault ? " (default)" : ""}
                  </option>
                ))}
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
                    value={appPid}
                    onChange={(e) => {
                      appTouched.current = true;
                      setAppPid(e.target.value);
                    }}
                    aria-label="Interviewer audio source"
                    className={cx(control, focusRing)}
                  >
                    <option value="">All system audio</option>
                    {apps.map((a) => (
                      <option key={a.pid} value={String(a.pid)}>
                        {a.name}
                        {a.active ? " — playing" : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={refreshApps} title="Refresh app list" aria-label="Refresh app list" className={cx("rounded-lg border border-zinc-200 px-2 text-xs dark:border-zinc-800", focusRing)}>
                    ↻
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {appPid
                    ? "Only this app is captured — games, music and notifications are ignored."
                    : "Everything your PC plays is captured. Pick your meeting app to ignore other sounds."}
                </p>
              </div>
            )}
            <AudioTest micId={micId || undefined} systemAudio={systemAudio} systemProcessId={appPid ? Number(appPid) : undefined} />
          </div>

          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="submit"
            disabled={starting}
            className={cx("w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
          >
            {starting ? "Starting…" : "Start Session"}
          </button>
          <button
            type="button"
            onClick={() => void openUrl(`${WEB_URL}/sessions`)}
            className={cx("mt-2 w-full text-center text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
          >
            History, documents & billing open in your browser
          </button>
        </div>
      </form>
    </div>
  );
}

function AudioTest({ micId, systemAudio, systemProcessId }: { micId?: string; systemAudio: boolean; systemProcessId?: number | undefined }) {
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [note, setNote] = useState<string | null>(null);
  const runningRef = useRef(false);

  const stop = async () => {
    runningRef.current = false;
    setRunning(false);
    setLevels([0, 0]);
    await stopCapture().catch(() => undefined);
  };

  const start = async () => {
    setNote(null);
    try {
      runningRef.current = true;
      const info = await startCapture({ ...(micId ? { micDeviceId: micId } : {}), systemAudio, ...(systemProcessId ? { systemProcessId } : {}) }, (ev) => {
        if (!runningRef.current) return;
        if (ev.kind === "frame") {
          setLevels((prev) => {
            const next: [number, number] = [prev[0], prev[1]];
            next[ev.channel === AUDIO_CHANNEL.mic ? 0 : 1] = levelFromRms(ev.rms);
            return next;
          });
        } else {
          setNote(ev.message);
        }
      });
      if (systemAudio && info.systemError) setNote(info.systemError);
      setRunning(true);
    } catch (err) {
      runningRef.current = false;
      setNote(String(err));
    }
  };

  useEffect(
    () => () => {
      if (runningRef.current) void stopCapture();
    },
    [],
  );

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void (running ? stop() : start())}
        className={cx("rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900", focusRing)}
      >
        {running ? "Stop test" : "Test audio"}
      </button>
      <LevelRow label="Mic" level={levels[0]} />
      {systemAudio && <LevelRow label="System" level={levels[1]} />}
      {note && <p className="text-[11px] text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}

function LevelRow({ label, level }: { label: string; level: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
      <span className="w-12">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-label={`${label} level`}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
    </div>
  );
}
