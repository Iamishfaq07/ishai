import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbitSession } from "@orbit/types";
import {
  ApiError,
  LivePanel,
  answerAsText,
  base64ToBlob,
  cx,
  focusRing,
  loadHotkeys,
  loadResponseTiming,
  loadCodingLanguage,
  loadThinking,
  selectDisplayedAnswer,
  useAnswerHistory,
  useLiveSession,
  type PanelMode,
  VISION_ENABLED,
} from "@orbit/ui";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { API_URL, api } from "../api";
import {
  REGION_CAPTURED_EVENT,
  base64ToBytes,
  deviceStatusText,
  openRegionSelector,
  startCapture,
  stopCapture,
  type RegionCapturedPayload,
} from "../native";
import { requestClose } from "../CloseDialog";
import { useShortcutHandler, type GlobalAction } from "../globalShortcuts";
import { GlassButton } from "../GlassControls";
import { WindowButtons } from "../TitleBar";
import { applyPanelMode, setAlwaysOnTop } from "../windowing";

export interface DesktopLaunch {
  micDeviceId?: string;
  systemAudio: boolean;
  /** Capture only this app's audio (process tree); undefined = an output device. */
  systemProcessId?: number;
  /** Output to capture when no app is chosen: "default" | "communications" | endpoint id. */
  systemDevice?: string;
}

const MODE_KEY = "orbit.desktop.panelMode";
const PIN_KEY = "orbit.desktop.alwaysOnTop";

export function LiveScreen({
  session,
  launch,
  onExit,
}: {
  session: OrbitSession;
  launch: DesktopLaunch;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<PanelMode>(() => (localStorage.getItem(MODE_KEY) as PanelMode | null) ?? "compact");
  const [onTop, setOnTop] = useState(() => localStorage.getItem(PIN_KEY) !== "false");
  const [hotkeys] = useState(loadHotkeys);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [shotNote, setShotNote] = useState<string | null>(null);

  const { live, actions, client } = useLiveSession({
    apiBaseUrl: API_URL,
    sessionId: session.id,
    getTicket: async () => (await api.liveTicket(session.id)).ticket,
    initialSettings: {
      auto_answer: session.auto_answer,
      length: session.length,
      style: session.style,
      response_timing: loadResponseTiming(),
      thinking: loadThinking(),
      ...(loadCodingLanguage() ? { coding_language: loadCodingLanguage()! } : {}),
    },
  });

  // ── Window behaviour ──────────────────────────────────────────────────
  const changeMode = (next: PanelMode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
    void applyPanelMode(next);
  };
  useEffect(() => {
    localStorage.setItem(PIN_KEY, String(onTop));
    void setAlwaysOnTop(onTop);
  }, [onTop]);

  // ── Native audio capture → live socket ────────────────────────────────
  const pausedRef = useRef(false);
  // Mock interviews: the mic is muted while the AI interviewer speaks (its voice comes out of the speakers).
  const interviewerSpeakingRef = useRef(false);
  const onInterviewerSpeaking = useCallback((speaking: boolean) => {
    interviewerSpeakingRef.current = speaking;
  }, []);
  pausedRef.current = live.state === "paused" || live.state === "ended";

  const startAudio = useCallback(async () => {
    setCaptureNote(null);
    try {
      const info = await startCapture(
        {
          systemAudio: launch.systemAudio,
          ...(launch.micDeviceId ? { micDeviceId: launch.micDeviceId } : {}),
          ...(launch.systemProcessId ? { systemProcessId: launch.systemProcessId } : {}),
          ...(launch.systemDevice ? { systemDevice: launch.systemDevice } : {}),
        },
        (ev) => {
          if (ev.kind === "frame") {
            if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudioBytes(ev.channel, base64ToBytes(ev.pcm));
          } else if (ev.kind === "status") {
            // Device came back / switched: clear the "disconnected" note after a moment.
            const text = deviceStatusText(ev);
            setCaptureNote(text);
            if (text && (ev.state === "restored" || ev.state === "switched")) {
              window.setTimeout(() => setCaptureNote((n) => (n === text ? null : n)), 4000);
            }
          } else {
            setCaptureNote(ev.message);
          }
        },
      );
      const notes: string[] = [];
      if (launch.systemAudio && info.systemError) notes.push(`${info.systemError} Listening through your microphone only.`);
      if (info.micError) notes.push(`${info.micError} The interviewer is still captured.`);
      if (notes.length) setCaptureNote(notes.join(" "));
    } catch (err) {
      setCaptureNote(`Audio capture failed: ${String(err)}`);
    }
  }, [client, launch.micDeviceId, launch.systemAudio, launch.systemProcessId, launch.systemDevice]);

  useEffect(() => {
    void startAudio();
    return () => {
      void stopCapture();
    };
  }, [startAudio]);

  // ── Screenshot (native region selector window) ────────────────────────
  const uploadShot = useCallback(
    async (pngBase64: string) => {
      setShotNote(null);
      try {
        await api.uploadScreenshot(session.id, base64ToBlob(pngBase64));
      } catch (err) {
        setShotNote(
          err instanceof ApiError && err.isNotImplemented
            ? "Screenshot analysis isn’t enabled on this server yet — paste the problem into Chat instead."
            : `Couldn’t send screenshot: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [session.id],
  );

  useEffect(() => {
    const unlisten = listen<RegionCapturedPayload>(REGION_CAPTURED_EVENT, (event) => {
      void uploadShot(event.payload.pngBase64);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [uploadShot]);

  const screenshot = useCallback(() => {
    openRegionSelector().catch((err: unknown) => setShotNote(`Screenshot failed: ${String(err)}`));
  }, []);

  // ── Global shortcuts (registered app-wide; see globalShortcuts.ts) ────
  const answerHistory = useAnswerHistory(live, actions);
  const shortcutState = useRef({ actions, screenshot, answerHistory, live });
  shortcutState.current = { actions, screenshot, answerHistory, live };
  const onShortcut = useCallback((action: GlobalAction) => {
    const { actions: a, screenshot: shot, answerHistory: h, live: l } = shortcutState.current;
    if (action === "answer") a.answer();
    else if (action === "screenshot") shot();
    else if (action === "prevAnswer") h.step(-1);
    else if (action === "nextAnswer") h.step(1);
    else if (action === "togglePause") a.togglePause();
    else if (action === "copyAnswer") {
      const shown = selectDisplayedAnswer(l);
      // Tauri clipboard: works while another app is focused (navigator.clipboard needs page focus).
      if (shown?.has_content) void writeText(answerAsText(shown.answer)).catch(() => undefined);
    }
  }, []);
  useShortcutHandler(onShortcut);

  // ── End ───────────────────────────────────────────────────────────────
  const [ending, setEnding] = useState(false);
  const end = () => {
    // Ending finalizes the session + report; the compact always-on-top window makes End easy to misclick.
    if (!window.confirm("End this session? The transcript and summary will be saved to History.")) return;
    setEnding(true);
    actions.end();
  };
  useEffect(() => {
    if (!ending && live.state !== "ended") return;
    void stopCapture();
    const done = () => onExit();
    if (live.state === "ended") {
      const t = setTimeout(done, 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      api.endSession(session.id).catch(() => undefined).finally(done);
    }, 3000);
    return () => clearTimeout(t);
  }, [ending, live.state, onExit, session.id]);

  const win = getCurrentWindow();
  const notice =
    captureNote || shotNote ? (
      <div className="space-y-px">
        {captureNote && (
          <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="flex-1">{captureNote}</span>
            <button type="button" onClick={() => void startAudio()} className={cx("font-medium underline", focusRing)}>
              Retry
            </button>
          </div>
        )}
        {shotNote && (
          <div className="flex items-center gap-2 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <span className="flex-1">{shotNote}</span>
            <button type="button" onClick={() => setShotNote(null)} aria-label="Dismiss" className={cx("px-1", focusRing)}>
              ×
            </button>
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <LivePanel
      mockInterview={session.type === "mock"}
      onInterviewerSpeaking={onInterviewerSpeaking}
      live={live}
      actions={actions}
      mode={mode}
      onModeChange={changeMode}
      onEnd={end}
      onReconnect={() => client.connect()}
      onScreenshot={VISION_ENABLED ? screenshot : undefined}
      screenshotUnavailableReason="Screenshot analysis isn’t enabled yet."
      hotkeys={hotkeys}
      title={session.title}
      dragRegion
      notice={notice}
      headerEnd={
        <>
          <button
            type="button"
            onClick={() => setOnTop((v) => !v)}
            aria-pressed={onTop}
            title={onTop ? "Always on top: on" : "Always on top: off"}
            className={cx(
              "rounded px-1.5 text-xs",
              onTop ? "text-indigo-600 dark:text-indigo-300" : "text-zinc-400",
              "hover:bg-zinc-100 dark:hover:bg-zinc-800",
              focusRing,
            )}
          >
            📌
          </button>
          <GlassButton />
          <WindowButtons minimize={() => void win.minimize()} hide={requestClose} />
        </>
      }
    />
  );
}
