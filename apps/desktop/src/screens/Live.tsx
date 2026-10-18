import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CHANNEL, type OrbitSession, type User } from "@orbit/types";
import {
  Button,
  Contrast,
  CopilotScene,
  CreditCard,
  Headphones,
  CircleAlert,
  MenuButton,
  Mic,
  MoreHorizontal,
  SourceChip,
  Smartphone,
  useSourceTracker,
  Pin,
  PinOff,
  X,
  ApiError,
  CompanionShare,
  useAnswerRatings,
  LivePanel,
  DefenseWorkspace,
  answerAsText,
  base64ToBlob,
  cx,
  focusRing,
  loadHotkeys,
  loadResponseTiming,
  loadCodingLanguage,
  loadThinking,
  loadExperience,
  selectDisplayedAnswer,
  useAnswerHistory,
  useLiveSession,
  type MenuItem,
  type PanelMode,
  VISION_ENABLED,
  confirmDialog,
  safeLocal,
  useNaturalVoiceSource,
  VOICE_CHOICE_KEY,
} from "@orbit/ui";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, WEB_URL, api } from "../api";
import {
  REGION_CAPTURED_EVENT,
  base64ToBytes,
  captureScreen,
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
import { stepGlass } from "../glass";
import { reportLink } from "../web";
import { formatAccelerator, loadShortcuts } from "../globalShortcuts";
import type { DesktopLaunch } from "../launch";
import { SignInAgain } from "../SignInAgain";
import { WindowButtons } from "../TitleBar";
import { setLiveSession } from "../updates";
import { applyPanelMode, loadAlwaysOnTop, setAlwaysOnTop } from "../windowing";

const MODE_KEY = "orbit.desktop.panelMode";

/** What's wrong with audio, kept per source: the interviewer's audio coming up must not clear the mic's warning. */
type CaptureNotes = Partial<Record<"start" | "mic" | "system", string | null>>;

/** Why the session ended, when this window's End didn't end it. */
type EndedReason = "minutes" | "time_limit" | "elsewhere" | "ended";

/** The live client's code for a session ended from another window or device (packages/ui live/client.ts). */
const SESSION_ENDED = "session_ended";

const ENDED_COPY: Record<EndedReason, { title: string; body: string }> = {
  minutes: {
    title: "You're out of interview minutes",
    body:
      "So the session has ended. Your transcript and report are saved in History. Buy a pack to keep going: minutes " +
      "land in your account as soon as the payment is approved.",
  },
  time_limit: {
    title: "This session reached its time limit",
    body: "So it has ended. Your transcript and report are saved in History. Start a new session to keep going.",
  },
  elsewhere: {
    title: "This session was ended elsewhere",
    body:
      "It was ended from another window or device, so there's nothing to reconnect to. Its transcript and report are " +
      "saved in History.",
  },
  ended: {
    title: "This session has ended",
    body: "Its transcript and report are saved in History.",
  },
};

export function LiveScreen({
  session,
  launch,
  onExit,
  onViewReview,
  signInExpired,
  email,
  onSignedInAgain,
}: {
  session: OrbitSession;
  launch: DesktopLaunch;
  onExit: () => void;
  /** This session's transcript and review (History). */
  onViewReview: () => void;
  /** A request was refused (401): the sign-in expired. The session stays up and asks to sign in again. */
  signInExpired: boolean;
  email: string | null;
  onSignedInAgain: (user: User) => void;
}) {
  const [mode, setMode] = useState<PanelMode>(() => (safeLocal.getItem(MODE_KEY) as PanelMode | null) ?? "compact");
  const [onTop, setOnTop] = useState(loadAlwaysOnTop);
  const [hotkeys] = useState(loadHotkeys);
  const [captureNotes, setCaptureNotes] = useState<CaptureNotes>({});
  // Whether each source is actually heard (SourceChip), from the frames' levels on this device; its advice joins the
  // capture notes.
  const sources = useSourceTracker();
  const [sourceAdvice, setSourceAdvice] = useState<{ mic: string | null; system: string | null }>({ mic: null, system: null });
  const [shotNote, setShotNote] = useState<string | null>(null);

  const ratings = useAnswerRatings(api, session.id);
  // The mock interviewer reads questions with the natural voice when the server offers it (Settings picks which).
  const naturalVoice = useNaturalVoiceSource(
    api,
    safeLocal.getItem(VOICE_CHOICE_KEY),
    session.type === "mock" && (session.language ?? "en") === "en", // the natural voices are English
  );
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
      ...(loadExperience() !== "auto" ? { experience: loadExperience() } : {}),
    },
  });

  // ── Window behaviour ──────────────────────────────────────────────────
  // Sized for the saved mode as the session opens (Setup leaves the window compact), and on every switch.
  useEffect(() => {
    safeLocal.setItem(MODE_KEY, mode);
    void applyPanelMode(mode);
  }, [mode]);
  useEffect(() => {
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
  const audioAmplitude = useRef(0);
  const [deviceHealth, setDeviceHealth] = useState<{ mic: "active" | "recovering" | "muted"; system: "active" | "recovering" | "muted" }>({ mic: "recovering", system: launch.systemAudio ? "recovering" : "muted" });
  const startAudio = useCallback(async () => {
    const id = newCaptureId();
    captureId.current = id;
    const current = () => captureId.current === id;
    const note = (key: keyof CaptureNotes, text: string | null) => {
      if (current()) setCaptureNotes((n) => ({ ...n, [key]: text }));
    };
    setCaptureNotes({});
    setDeviceHealth({ mic: "recovering", system: launch.systemAudio ? "recovering" : "muted" });
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
            sources.feed(ev.channel === AUDIO_CHANNEL.mic ? "mic" : "system", ev.rms);
            if (ev.channel === AUDIO_CHANNEL.mic) audioAmplitude.current = ev.rms;
            if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudioBytes(ev.channel, base64ToBytes(ev.pcm));
            return;
          }
          const key = ev.channel === AUDIO_CHANNEL.mic ? "mic" : "system";
          if (ev.kind === "status") {
            setDeviceHealth((previous) => ({ ...previous, [key]: ev.state === "lost" ? "recovering" : "active" }));
            // Device (or the meeting app) came back / switched: clear the "disconnected" note after a moment.
            const text = deviceStatusText(ev);
            note(key, text);
            if (text && (ev.state === "restored" || ev.state === "switched")) {
              window.setTimeout(() => setCaptureNotes((n) => (n[key] === text ? { ...n, [key]: null } : n)), 4000);
            }
          } else {
            setDeviceHealth((previous) => ({ ...previous, [key]: "muted" }));
            note(key, friendlyAudioError(ev.message));
          }
        },
      );
      if (current()) setDeviceHealth({ mic: info.micError ? "muted" : "active", system: !launch.systemAudio || info.systemError ? "muted" : "active" });
      if (launch.systemAudio && info.systemError) {
        note("system", `${friendlyAudioError(info.systemError)} Until then Orbit hears your microphone only.`);
      }
      if (info.micError) note("mic", `${friendlyAudioError(info.micError)} The interviewer is still heard.`);
    } catch (err) {
      if (current()) setDeviceHealth({ mic: "muted", system: "muted" });
      note("start", friendlyAudioError(err));
    }
  }, [client, launch.micDeviceId, launch.systemAudio, launch.systemProcessId, launch.systemProcessExe, launch.systemDevice, sources]);

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
  const ended = live.state === "ended";
  const end = async () => {
    // Ending finalizes the session + report; the compact always-on-top window makes End easy to misclick.
    if (!(await confirmDialog({ title: "End this session?", body: "The transcript and report are saved to History.", confirmLabel: "End session", danger: true }))) return;
    setEnding(true);
    actions.end();
  };
  // Only End here goes back home by itself. Ended any other way, the screen stays and says why, instead of dropping
  // the user on Home a moment later with no explanation: out of minutes, the time limit, ended from another window or
  // device. A mock round that finished keeps its own end screen (the round summary) with the way to the review.
  const limit = live.usage?.limitReached ? live.usage.reason : null;
  const endedWhy: EndedReason | null =
    !ended || ending
      ? null
      : limit
        ? limit === "session"
          ? "time_limit"
          : "minutes"
        : live.connectionInfo?.code === SESSION_ENDED
          ? "elsewhere"
          : session.type === "mock"
            ? null
            : "ended";
  const mockOver = ended && !ending && !endedWhy;
  const buyMinutes = useCallback(() => void openUrl(`${WEB_URL}/billing`), []);
  useEffect(() => {
    if (!ending && !ended) return;
    void stopCapture(captureId.current);
    if (ended) {
      if (!ending) return; // the ended screen (below) takes it from here
      const t = setTimeout(onExit, 800);
      return () => clearTimeout(t);
    }
    // End pressed but the server hasn't confirmed: end it over HTTP, then leave.
    const t = setTimeout(() => {
      api.endSession(session.id).catch(() => undefined).finally(onExit);
    }, 3000);
    return () => clearTimeout(t);
  }, [ending, ended, onExit, session.id]);

  const win = getCurrentWindow();
  // Capture stops when the session ends: what it last said no longer matters.
  const captureLines = ended
    ? []
    : [...new Set([captureNotes.start, captureNotes.mic ?? sourceAdvice.mic, captureNotes.system ?? sourceAdvice.system]
        .filter((t): t is string => Boolean(t)))];
  // The socket that carries audio and answers needs no sign-in once open, so the session carries on; reconnecting
  // (and screenshots, ratings…) needs it again.
  const disconnected = live.connection === "closed" && !ended;
  const notice =
    mockOver || signInExpired || captureLines.length > 0 || shotNote ? (
      <div className="space-y-px">
        {mockOver && (
          <div className="flex items-center gap-2 bg-indigo-50 px-4 py-1.5 text-xs text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
            <span className="flex-1">This round is over.</span>
            <button type="button" onClick={onExit} className={cx("font-medium underline", focusRing)}>
              Back to home
            </button>
          </div>
        )}
        {signInExpired && (
          <SignInAgain
            email={email}
            message={
              disconnected
                ? "Your sign-in has expired, so Orbit can't reconnect. Sign in again to carry on with this session."
                : "Your sign-in has expired. The session carries on, but sign in again so Orbit can reconnect if the connection drops."
            }
            onSignedIn={(user) => {
              onSignedInAgain(user);
              if (disconnected) client.connect();
            }}
          />
        )}
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

  if (endedWhy) {
    const copy = ENDED_COPY[endedWhy];
    const outOfMinutes = endedWhy === "minutes";
    return (
      <div className="flex h-full flex-col">
        <div data-tauri-drag-region="" className="flex h-10 shrink-0 items-stretch justify-end">
          <WindowButtons minimize={() => void win.minimize()} hide={requestClose} />
        </div>
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-8 text-center">
          <CopilotScene quiet className="w-40" />
          <h1 className="font-display text-lg font-semibold tracking-tight">{copy.title}</h1>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-300">{copy.body}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {outOfMinutes && (
              <Button onClick={buyMinutes}>
                <CreditCard className="h-4 w-4" />
                Buy minutes
              </Button>
            )}
            <Button variant={outOfMinutes ? "secondary" : "primary"} onClick={onViewReview}>
              View review
            </Button>
            <Button variant="secondary" onClick={onExit}>
              Back to home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // The connection gone for good: the devices still hear, but nothing reaches Orbit, so it isn't "active".
  const captureHealth = disconnected
    ? "offline"
    : Object.values(deviceHealth).includes("recovering")
      ? "recovering"
      : Object.values(deviceHealth).includes("active")
        ? "active"
        : "muted";
  const compact = mode === "compact";
  const keys = loadShortcuts();
  // Compact: the window's own options fold into one menu, so the status, the clock, Expand and End keep their room
  // (the header used to cut "Listening" to "Li…"); expanded keeps the phone's button out in the header too.
  const report: MenuItem = {
    label: "Report a problem",
    icon: CircleAlert,
    // Opens the browser's contact form on a report; the session carries on here.
    onSelect: () => void openUrl(reportLink(WEB_URL)),
  };
  const windowMenu = (
    <MenuButton
      label="Window options"
      icon={MoreHorizontal}
      variant="ghost"
      size="sm"
      align="end"
      menuClassName="glass-solid"
      items={[
        { label: onTop ? "Always on top: on" : "Always on top: off", icon: onTop ? Pin : PinOff, onSelect: () => setOnTop((v) => !v) },
        { label: "More see-through", icon: Contrast, hint: formatAccelerator(keys.moreTransparent), onSelect: () => stepGlass(-0.1) },
        { label: "Less see-through", icon: Contrast, hint: formatAccelerator(keys.lessTransparent), onSelect: () => stepGlass(0.1) },
        ...(compact
          ? [
              {
                label: "Follow on your phone",
                icon: Smartphone,
                disabled: ended,
                // The phone's QR code lives in the expanded header (CompanionShare): open it there.
                onSelect: () => {
                  setMode("expanded");
                  window.setTimeout(() => document.querySelector<HTMLButtonElement>("[data-companion] button")?.click(), 400);
                },
              },
            ]
          : []),
        report,
      ]}
    />
  );

  return (
    <LivePanel
      audioAmplitude={() => audioAmplitude.current}
      // Only a problem gets its own pill: when capture is fine, the Mic and Interviewer chips already say so (the
      // header said "Capture active" twice over).
      {...(captureHealth !== "active" ? { captureHealth } : {})}
      mockInterview={session.type === "mock"}
      videoInterview={Boolean(session.video)}
      naturalVoice={naturalVoice}
      practiceLanguage={session.language}
      answerLanguage={session.answer_language ?? session.language}
      ratings={ratings}
      onInterviewerSpeaking={onInterviewerSpeaking}
      live={live}
      actions={actions}
      mode={mode}
      onModeChange={setMode}
      onEnd={end}
      onReconnect={() => client.connect()}
      onEndOtherSession={async (id) => {
        await api.endSession(id);
      }}
      onBuyMinutes={buyMinutes}
      onViewReport={onViewReview}
      onScreenshot={VISION_ENABLED ? screenshot : undefined}
      screenshotUnavailableReason="Screenshot analysis isn’t enabled yet."
      loadWalkthrough={(answerId) => api.spokenWalkthrough(session.id, answerId)}
      hotkeys={hotkeys}
      title={session.title}
      dragRegion
      notice={<>{notice}{session.type !== "mock" && <DefenseWorkspace api={api} sessionId={session.id} capture={async () => base64ToBlob((await captureScreen()).pngBase64)} />}</>}
      windowControls={<WindowButtons compact={compact} minimize={() => void win.minimize()} hide={requestClose} />}
      headerEnd={
        <>
          {/* Compact: hidden, but still listening, so a silent source's advice reaches the capture notes. */}
          <span className={cx("flex items-center gap-1.5 text-[11px]", compact && "hidden")}>
            <SourceChip tracker={sources} channel="mic" icon={Mic} label="Mic" on={deviceHealth.mic === "active"} paused={live.state === "paused"}
                        onAdvice={(mic) => setSourceAdvice((a) => (a.mic === mic ? a : { ...a, mic }))} />
            <SourceChip tracker={sources} channel="system" icon={Headphones} label="Interviewer" on={launch.systemAudio && deviceHealth.system === "active"}
                        paused={live.state === "paused"} onAdvice={(system) => setSourceAdvice((a) => (a.system === system ? a : { ...a, system }))} />
          </span>
          {compact ? (
            windowMenu
          ) : (
            <>
              <span data-companion="">
                <CompanionShare api={api} sessionId={session.id} webUrl={WEB_URL} disabled={ended} />
              </span>
              {windowMenu}
            </>
          )}
        </>
      }
    />
  );
}
