import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AnswerLength, OrbitDocument, OrbitSession, SessionType, User } from "@orbit/types";
import { AUDIO_CHANNEL } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "../api";
import { listAudioDevices, startCapture, stopCapture, type NativeAudioDevice } from "../native";
import { TitleBar } from "../TitleBar";
import type { DesktopLaunch } from "./Live";

const TYPES: Array<{ value: SessionType; label: string }> = [
  { value: "interview", label: "Interview" },
  { value: "coding", label: "Coding interview" },
  { value: "meeting", label: "Professional meeting" },
  { value: "assessment", label: "Online assessment practice" },
  { value: "phone", label: "Phone / room audio" },
];

export const IS_MAC = /Mac/i.test(navigator.userAgent);

const control =
  "block w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900";

function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

export function SetupScreen({
  user,
  onSignOut,
  onStart,
}: {
  user: User | null;
  onSignOut: () => void;
  onStart: (session: OrbitSession, launch: DesktopLaunch) => void;
}) {
  const [type, setType] = useState<SessionType>("interview");
  const [role, setRole] = useState("");
  const [length, setLength] = useState<AnswerLength>("short");
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [docs, setDocs] = useState<OrbitDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<NativeAudioDevice[]>([]);
  const [micId, setMicId] = useState("");
  const [systemAudio, setSystemAudio] = useState(!IS_MAC);
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
    listAudioDevices()
      .then(setDevices)
      .catch((err: unknown) => setError(`Couldn’t list audio devices: ${String(err)}`));
  }, []);

  useEffect(() => {
    if (type === "phone") setSystemAudio(false);
  }, [type]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setError(null);
    try {
      const session = await api.createSession({
        title: `${TYPES.find((t) => t.value === type)?.label ?? "Session"}${role.trim() ? ` — ${role.trim()}` : ""}`,
        type,
        ...(role.trim() ? { role: role.trim() } : {}),
        language: "en",
        length,
        style: "bullets",
        auto_answer: autoAnswer,
        document_ids: [...selected],
      });
      onStart(session, { systemAudio, ...(micId ? { micDeviceId: micId } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start the session.");
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <button type="button" onClick={onSignOut} className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          Sign out
        </button>
      </TitleBar>
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

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Context documents</legend>
            {docs === null ? (
              <p className="text-xs text-zinc-500">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No documents yet.{" "}
                <button type="button" onClick={() => void openUrl(`${WEB_URL}/documents`)} className="text-indigo-600 underline dark:text-indigo-400">
                  Upload your resume
                </button>
              </p>
            ) : (
              docs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    disabled={d.status !== "ready"}
                    checked={selected.has(d.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1 truncate">{d.title}</span>
                  <span className="text-zinc-500">{d.kind.replace("_", " ")}</span>
                </label>
              ))
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
                      : "Captures what your speakers play (WASAPI loopback), kept separate from your mic."}
                </span>
              </span>
            </label>
            <AudioTest micId={micId || undefined} systemAudio={systemAudio} />
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

function AudioTest({ micId, systemAudio }: { micId?: string; systemAudio: boolean }) {
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
      const info = await startCapture({ ...(micId ? { micDeviceId: micId } : {}), systemAudio }, (ev) => {
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
