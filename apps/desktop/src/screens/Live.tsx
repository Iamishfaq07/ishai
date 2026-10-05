import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CHANNEL, type OrbitSession } from "@orbit/types";
import {
  Button,
  CreditCard,
  OrbitLogo,
  Pin,
  PinOff,
  X,
  ApiError,
  CompanionShare,
  useAnswerRatings,
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
  confirmDialog,
} from "@orbit/ui";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, WEB_URL, api } from "../api";
import {
  REGION_CAPTURED_EVENT,
  base64ToBytes,
  deviceStatusText,
  friendlyAudioError,
  newCaptureId,
  openRegionSelector,
  startCapture,
  stopCapture,
  type RegionCapturedPayload,
} from "../native";
import { requestClose } from "../CloseDialog";
import { useShortcutHandler, type GlobalAction } from "../globalShortcuts";
import { GlassButton } from "../GlassControls";
import type { DesktopLaunch } from "../launch";
import { WindowButtons } from "../TitleBar";
import { setLiveSession } from "../updates";
import { applyPanelMode, setAlwaysOnTop } from "../windowing";

const MODE_KEY = "orbit.desktop.panelMode";
const PIN_KEY = "orbit.desktop.alwaysOnTop";

/** What's wrong with audio, kept per source: the interviewer's audio coming up must not clear the mic's warning. */
type CaptureNotes = Partial<Record<"start" | "mic" | "system", string | null>>;

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
  const [captureNotes, setCaptureNotes] = useState<CaptureNotes>({});
  const [shotNote, setShotNote] = useState<string | null>(null);

  const ratings = useAnswerRatings(api, session.id);
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
  // An update never installs (restarting Orbit) while this screen is open.
  useEffect(() => {
    setLiveSession(true);
    return () => setLiveSession(false);
  }, []);

  // ── Native audio capture → live socket ────────────────────────────────
  const pausedRef = useRef(false);
  // Mock interviews: the mic is muted while the AI interviewer speaks (its voice comes out of the speakers).
  const interviewerSpeakingRef = useRef(false);
  const onInterviewerSpeaking = useCallback((speaking: boolean) => {
    interviewerSpeakingRef.current = speaking;
  }, []);
  pausedRef.current = live.state === "paused" || live.state === "ended";

  // The capture this screen owns (0: none). Each start (Retry) gets a new id, so a stop only ever ends this screen's
  // own capture, and events from one that was replaced are ignored.
  const captureId = useRef(0);
  const startAudio = useCallback(async () => {
    const id = newCaptureId();
    captureId.current = id;
    const current = () => captureId.current === id;
    const note = (key: keyof CaptureNotes, text: string | null) => {
      if (current()) setCaptureNotes((n) => ({ ...n, [key]: text }));
    };
    setCaptureNotes({});
    try {
      const info = await startCapture(
        {
          captureId: id,
          systemAudio: launch.systemAudio,
          ...(launch.micDeviceId ? { micDeviceId: launch.micDeviceId } : {}),
          ...(launch.systemProcessId ? { systemProcessId: launch.systemProcessId } : {}),
          ...(launch.systemProcessExe ? { systemProcessExe: launch.systemProcessExe } : {}),
          ...(launch.systemDevice ? { systemDevice: launch.systemDevice } : {}),
        },
        (ev) => {
          if (!current()) return;
          if (ev.kind === "frame") {
            if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudioBytes(ev.channel, base64ToBytes(ev.pcm));
            return;
          }
          const key = ev.channel === AUDIO_CHANNEL.mic ? "mic" : "system";
          if (ev.kind === "status") {
            // Device (or the meeting app) came back / switched: clear the "disconnected" note after a moment.
            const text = deviceStatusText(ev);
            note(key, text);
            if (text && (ev.state === "restored" || ev.state === "switched")) {
              window.setTimeout(() => setCaptureNotes((n) => (n[key] === text ? { ...n, [key]: null } : n)), 4000);
            }
          } else {
            note(key, friendlyAudioError(ev.message));
          }
        },
      );
      if (launch.systemAudio && info.systemError) {
        note("system", `${friendlyAudioError(info.systemError)} Until then Orbit hears your microphone only.`);
      }
      if (info.micError) note("mic", `${friendlyAudioError(info.micError)} The interviewer is still heard.`);
    } catch (err) {
      note("start", friendlyAudioError(err));
    }
  }, [client, launch.micDeviceId, launch.systemAudio, launch.systemProcessId, launch.systemProcessExe, launch.systemDevice]);

  useEffect(() => {
    void startAudio();
    return () => {
      void stopCapture(captureId.current);
      captureId.current = 0;
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
    openRegionSelector().catch((err: unknown) => {
      console.warn("Screenshot failed:", err);
      setShotNote("Couldn't take the screenshot. Try again.");
    });
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
  const end = async () => {
    // Ending finalizes the session + report; the compact always-on-top window makes End easy to misclick.
    if (!(await confirmDialog({ title: "End this session?", body: "The transcript and report are saved to History.", confirmLabel: "End session", danger: true }))) return;
    setEnding(true);
    actions.end();
  };
  // Ended by running out of minutes (or the session time limit): say so and offer the fix, instead of dropping the
  // user on Home a moment later with no explanation.
  const limitEnded = live.state === "ended" && Boolean(live.usage?.limitReached) && !ending;
  const buyMinutes = useCallback(() => void openUrl(`${WEB_URL}/billing`), []);
  useEffect(() => {
    if (!ending && live.state !== "ended") return;
    void stopCapture(captureId.current);
    const done = () => onExit();
    if (limitEnded) return;
    if (live.state === "ended") {
      const t = setTimeout(done, 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      api.endSession(session.id).catch(() => undefined).finally(done);
    }, 3000);
    return () => clearTimeout(t);
  }, [ending, live.state, limitEnded, onExit, session.id]);

  const win = getCurrentWindow();
  const captureLines = [captureNotes.start, captureNotes.mic, captureNotes.system].filter((t): t is string => Boolean(t));
  const notice =
    captureLines.length > 0 || shotNote ? (
      <div className="space-y-px">
        {captureLines.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="flex-1">
              {captureLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </span>
            <button type="button" onClick={() => void startAudio()} className={cx("font-medium underline", focusRing)}>
              Retry
            </button>
          </div>
        )}
        {shotNote && (
          <div className="flex items-center gap-2 bg-rose-50 px-4 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <span className="flex-1">{shotNote}</span>
            <button type="button" onClick={() => setShotNote(null)} aria-label="Dismiss" className={cx("px-1", focusRing)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    ) : undefined;

  if (limitEnded) {
    const outOfMinutes = live.usage?.reason !== "session";
    return (
      <div className="flex h-full flex-col">
        <div data-tauri-drag-region="" className="flex h-10 shrink-0 items-center justify-end px-2">
          <WindowButtons minimize={() => void win.minimize()} hide={requestClose} />
        </div>
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-8 text-center">
          <OrbitLogo size={36} />
          <h1 className="font-display text-lg font-semibold tracking-tight">
            {outOfMinutes ? "You're out of interview minutes" : "This session reached its time limit"}
          </h1>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-300">
            {outOfMinutes
              ? "So the session has ended. Your transcript and report are saved in History. Buy a pack to keep going: minutes land in your account as soon as the payment is approved."
              : "So it has ended. Your transcript and report are saved in History. Start a new session to keep going."}
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {outOfMinutes && (
              <Button onClick={buyMinutes}>
                <CreditCard className="h-4 w-4" />
                Buy minutes
              </Button>
            )}
            <Button variant={outOfMinutes ? "secondary" : "primary"} onClick={onExit}>
              Back to home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LivePanel
      mockInterview={session.type === "mock"}
      ratings={ratings}
      onInterviewerSpeaking={onInterviewerSpeaking}
      live={live}
      actions={actions}
      mode={mode}
      onModeChange={changeMode}
      onEnd={end}
      onReconnect={() => client.connect()}
      onEndOtherSession={async (id) => {
        await api.endSession(id);
      }}
      onBuyMinutes={buyMinutes}
      onScreenshot={VISION_ENABLED ? screenshot : undefined}
      screenshotUnavailableReason="Screenshot analysis isn’t enabled yet."
      hotkeys={hotkeys}
      title={session.title}
      dragRegion
      notice={notice}
      headerEnd={
        <>
          <CompanionShare api={api} sessionId={session.id} webUrl={WEB_URL} disabled={live.state === "ended"} />
          <button
            type="button"
            onClick={() => setOnTop((v) => !v)}
            aria-pressed={onTop}
            title={onTop ? "Always on top: on" : "Always on top: off"}
            className={cx(
              "inline-flex items-center rounded px-1.5 py-1 text-xs",
              onTop ? "text-indigo-600 dark:text-indigo-300" : "text-zinc-400",
              "hover:bg-zinc-100 dark:hover:bg-zinc-800",
              focusRing,
            )}
          >
            {onTop ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
          <GlassButton />
          <WindowButtons minimize={() => void win.minimize()} hide={requestClose} />
        </>
      }
    />
  );
}
