import { useEffect, useRef, useState } from "react";
import { AUDIO_CHANNEL } from "@orbit/types";
import {
  Button,
  Headphones,
  Mic,
  MorphLabel,
  addFrame,
  cx,
  diagnosticsReport,
  focusRing,
  newChannelStats,
  summarizeChannel,
  type ChannelSummary,
  type DiagnosticsEvent,
  type Verdict,
} from "@orbit/ui";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  deviceStatusText,
  friendlyAudioError,
  newCaptureId,
  startCapture,
  stopCapture,
  type NativeAudioDevice,
} from "../../native";

const TEST_LIMIT_MS = 30_000; // the mic indicator shouldn't stay on because someone forgot the test

const VERDICT_STYLE: Record<Verdict, string> = {
  waiting: "text-zinc-500",
  ok: "text-emerald-700 dark:text-emerald-400",
  silent: "text-amber-700 dark:text-amber-400",
  too_loud: "text-amber-700 dark:text-amber-400",
  dropouts: "text-rose-700 dark:text-rose-400",
  no_audio: "text-rose-700 dark:text-rose-400",
};

function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

/**
 * "Test audio": live meters plus diagnostics (§23): delivery, dropouts, silence and loudness per channel,
 * measured locally from the capture frames. Nothing is sent to the server. "Copy diagnostics" produces a
 * shareable report with measurements and settings only. Capture runs only while the test does (30 s at most).
 */
export function AudioTest({
  micId,
  systemAudio,
  systemProcessId,
  systemProcessExe,
  systemDevice,
  micLabel,
  listenTo,
  interviewerName,
  devices,
  outputs,
}: {
  micId?: string;
  systemAudio: boolean;
  systemProcessId?: number | undefined;
  systemProcessExe?: string | undefined;
  systemDevice?: string | undefined;
  micLabel: string;
  listenTo: string;
  /** What the interviewer meter is labelled with ("Zoom", "Default output"). */
  interviewerName: string;
  devices: NativeAudioDevice[];
  outputs: NativeAudioDevice[];
}) {
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [note, setNote] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<{ mic: ChannelSummary; system: ChannelSummary | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);
  // The test's capture (0: none), so stopping the test can never stop a live session's capture.
  const captureId = useRef(0);
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
    const id = captureId.current;
    captureId.current = 0;
    if (id) await stopCapture(id).catch(() => undefined);
  };

  const start = async () => {
    setNote(null);
    setCopied(false);
    stats.current = { mic: newChannelStats(), system: newChannelStats() };
    events.current = [];
    setSummaries(null);
    const id = newCaptureId();
    captureId.current = id;
    try {
      runningRef.current = true;
      const options = {
        captureId: id,
        ...(micId ? { micDeviceId: micId } : {}),
        systemAudio,
        ...(systemProcessId ? { systemProcessId } : {}),
        ...(systemProcessExe ? { systemProcessExe } : {}),
        ...(systemDevice ? { systemDevice } : {}),
      };
      const t0 = performance.now();
      startedAt.current = t0;
      const log = (channel: "mic" | "system", kind: "status" | "error", detail: string) =>
        events.current.length < 50 &&
        events.current.push({ t: Math.round((performance.now() - t0) / 100) / 10, channel, kind, detail });
      const info = await startCapture(options, (ev) => {
        if (!runningRef.current || captureId.current !== id) return;
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
          setNote(friendlyAudioError(ev.message, "press Test audio again"));
        }
      });
      if (captureId.current !== id) return; // stopped (or the screen closed) while it was starting
      if (info.micError) {
        log("mic", "error", info.micError);
        setNote(friendlyAudioError(info.micError, "press Test audio again"));
      }
      if (systemAudio && info.systemError) {
        log("system", "error", info.systemError);
        setNote(friendlyAudioError(info.systemError, "press Test audio again"));
      }
      setRunning(true);
    } catch (err) {
      if (captureId.current !== id) return; // stopped while starting: nothing went wrong
      runningRef.current = false;
      captureId.current = 0;
      events.current.push({ t: 0, channel: "mic", kind: "error", detail: String(err) });
      setNote(friendlyAudioError(err, "press Test audio again"));
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
      // Its own capture only: by now the live session may already be starting its own.
      if (captureId.current) void stopCapture(captureId.current);
      captureId.current = 0;
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
    <div className="rounded-xl bg-zinc-500/[0.05] p-3.5 ring-1 ring-inset ring-zinc-200 dark:bg-white/[0.03] dark:ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Test your audio</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Speak, and play something in your meeting app. Listens for up to 30 seconds; nothing is sent anywhere.
          </p>
        </div>
        {summaries && !running && (
          <button
            type="button"
            onClick={() => void copy()}
            title="Copies a report with measurements and device settings only: no audio, transcript or account details"
            className={cx("rounded-lg px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10", focusRing)}
          >
            <MorphLabel show={copied ? "copied" : "idle"} states={{ idle: "Copy diagnostics", copied: "Copied" }} />
          </button>
        )}
        <Button variant="secondary" size="sm" onClick={() => void (running ? stop() : start())} aria-pressed={running}>
          <MorphLabel show={running ? "on" : "off"} states={{ off: "Test audio", on: "Stop test" }} />
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Meter icon={Mic} label="You" source={micLabel} level={levels[0]} summary={summaries?.mic ?? null} />
        {systemAudio && <Meter icon={Headphones} label="Interviewer" source={interviewerName} level={levels[1]} summary={summaries?.system ?? null} />}
      </div>
      {note && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{note}</p>}
    </div>
  );
}

function Meter({ icon: Icon, label, source, level, summary }: { icon: typeof Mic; label: string; source: string; level: number; summary: ChannelSummary | null }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs">
        <Icon className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="truncate text-zinc-500 dark:text-zinc-400">{source}</span>
      </p>
      <div
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"
      >
        <div className="h-full w-full origin-left rounded-full bg-emerald-500" style={{ transform: `scaleX(${level})` }} />
      </div>
      {summary && (
        <div role="status" className="mt-1.5 text-xs">
          <p className={VERDICT_STYLE[summary.verdict]}>{summary.advice}</p>
          {/* The measurements are for support: in a tooltip and in "Copy diagnostics", not in the way. */}
          {summary.verdict !== "waiting" && (
            <p
              className="tabular-nums text-zinc-500"
              title={`received ${pct(summary.delivery)} · dropouts ${summary.dropouts} · silent ${pct(summary.silentShare)}${
                summary.averageDbfs !== null ? ` · avg ${summary.averageDbfs} dBFS, peak ${summary.peakDbfs} dBFS` : ""
              }`}
            >
              Tested for {summary.seconds}s
            </p>
          )}
        </div>
      )}
    </div>
  );
}
