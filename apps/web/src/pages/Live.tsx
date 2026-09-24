import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AUDIO_CHANNEL, type OrbitSession } from "@orbit/types";
import {
  ArrowLeft,
  ApiError,
  LivePanel,
  ScreenshotPreview,
  cx,
  focusRing,
  loadHotkeys,
  loadResponseTiming,
  loadCodingLanguage,
  loadThinking,
  useLiveSession,
  VISION_ENABLED,
  type PanelMode,
  confirmDialog,
} from "@orbit/ui";
import { ErrorNote, Spinner } from "../components/ui";
import { API_URL, api } from "../lib/api";
import {
  captureScreenFrame,
  captureStream,
  openDisplayAudio,
  openMicrophone,
  supportsDisplayAudio,
  type AudioCapture,
} from "../lib/audio";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { LiveLaunchState } from "./SessionSetup";

const MODE_KEY = "orbit.web.panelMode";

export function LivePage() {
  const { sessionId = "" } = useParams();
  const location = useLocation();
  const launch = (location.state as LiveLaunchState | null) ?? { systemAudio: supportsDisplayAudio() };
  const detail = useAsync(() => api.getSession(sessionId), [sessionId]);

  if (detail.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Preparing session" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorNote onRetry={detail.reload}>{errorText(detail.error ?? new Error("Session not found."))}</ErrorNote>
        <Link to="/" className="mt-4 inline-block text-sm text-indigo-600 underline">
          Back home
        </Link>
      </div>
    );
  }
  if (detail.data.session.status === "ended") {
    return (
      <div className="mx-auto max-w-md p-8 text-sm">
        <p>This session has ended.</p>
        <Link to={`/sessions/${sessionId}`} className="mt-2 inline-block text-indigo-600 underline">
          View transcript and summary
        </Link>
      </div>
    );
  }
  return <LiveRoom session={detail.data.session} launch={launch} />;
}

function LiveRoom({ session, launch }: { session: OrbitSession; launch: LiveLaunchState }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PanelMode>(() => (localStorage.getItem(MODE_KEY) as PanelMode | null) ?? "expanded");
  const [hotkeys] = useState(loadHotkeys);
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

  useEffect(() => localStorage.setItem(MODE_KEY, mode), [mode]);

  // ── Audio capture ──────────────────────────────────────────────────────
  const pausedRef = useRef(false);
  // Mock interviews: the mic is muted while the AI interviewer speaks (its voice comes out of the speakers).
  const interviewerSpeakingRef = useRef(false);
  const onInterviewerSpeaking = useCallback((speaking: boolean) => {
    interviewerSpeakingRef.current = speaking;
  }, []);
  pausedRef.current = live.state === "paused" || live.state === "ended";
  const micRef = useRef<AudioCapture | null>(null);
  const sysRef = useRef<AudioCapture | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [sysState, setSysState] = useState<"off" | "needs_share" | "on" | "error">(launch.systemAudio ? "needs_share" : "off");
  const [sysError, setSysError] = useState<string | null>(null);

  const startMic = useCallback(async () => {
    setMicError(null);
    micRef.current?.stop();
    try {
      const stream = await openMicrophone(launch.micDeviceId);
      micRef.current = await captureStream(stream, (f) => {
        if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudio(AUDIO_CHANNEL.mic, f.pcm);
      });
      setMicOn(true);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setMicOn(false);
        setMicError("Microphone disconnected.");
      });
    } catch (err) {
      setMicOn(false);
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setMicError(
        denied
          ? "Microphone permission denied. Allow it from the address bar, then retry."
          : `Microphone unavailable: ${errorText(err)}`,
      );
    }
  }, [client, launch.micDeviceId]);

  useEffect(() => {
    void startMic();
    return () => {
      micRef.current?.stop();
      micRef.current = null;
      setMicOn(false);
    };
  }, [startMic]);

  const startSystemAudio = async () => {
    setSysError(null);
    sysRef.current?.stop();
    try {
      const stream = await openDisplayAudio();
      sysRef.current = await captureStream(stream, (f) => {
        if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudio(AUDIO_CHANNEL.system, f.pcm);
      });
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        sysRef.current?.stop();
        sysRef.current = null;
        setSysState("needs_share");
      });
      setSysState("on");
    } catch (err) {
      setSysError(errorText(err));
      setSysState("error");
    }
  };

  useEffect(
    () => () => {
      sysRef.current?.stop();
      sysRef.current = null;
    },
    [],
  );

  // ── Screenshot ─────────────────────────────────────────────────────────
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const takeScreenshot = async () => {
    setShotError(null);
    try {
      setShot(await captureScreenFrame());
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return; // user cancelled the picker
      setShotError(`Screenshot failed: ${errorText(err)}`);
    }
  };
  const analyzeShot = async () => {
    if (!shot) return;
    try {
      await api.uploadScreenshot(session.id, shot);
      setShot(null);
    } catch (err) {
      if (err instanceof ApiError && err.isNotImplemented) {
        throw new Error("Screenshot analysis isn’t enabled on this server yet. Paste the problem into Chat instead.");
      }
      throw err;
    }
  };

  // ── End session ────────────────────────────────────────────────────────
  const [ending, setEnding] = useState(false);
  const endSession = async () => {
    if (!(await confirmDialog({ title: "End this session?", body: "The transcript and report are saved to History.", confirmLabel: "End session", danger: true }))) return;
    setEnding(true);
    actions.end();
  };
  useEffect(() => {
    if (!ending && live.state !== "ended") return;
    micRef.current?.stop();
    sysRef.current?.stop();
    if (live.state === "ended") {
      const t = setTimeout(() => navigate(`/sessions/${session.id}`), 600);
      return () => clearTimeout(t);
    }
    // Fallback if the socket is down: end through REST.
    const t = setTimeout(() => {
      api
        .endSession(session.id)
        .catch(() => undefined)
        .finally(() => navigate(`/sessions/${session.id}`));
    }, 3000);
    return () => clearTimeout(t);
  }, [ending, live.state, navigate, session.id]);

  const notice = (
    <>
      {micError && (
        <Notice tone="error" action={{ label: "Retry", onClick: () => void startMic() }}>
          {micError}
        </Notice>
      )}
      {(sysState === "needs_share" || sysState === "error") && live.state !== "ended" && (
        <Notice tone={sysState === "error" ? "error" : "info"} action={{ label: "Share tab audio", onClick: () => void startSystemAudio() }}>
          {sysState === "error"
            ? sysError
            : "To hear the interviewer, share the meeting tab and turn on “Share tab audio”. Only audio is used."}
        </Notice>
      )}
      {shotError && <Notice tone="error">{shotError}</Notice>}
    </>
  );

  const panel = (
    <LivePanel
      mockInterview={session.type === "mock"}
      onInterviewerSpeaking={onInterviewerSpeaking}
      live={live}
      actions={actions}
      mode={mode}
      onModeChange={setMode}
      onEnd={endSession}
      onReconnect={() => client.connect()}
          onEndOtherSession={async (id) => {
            await api.endSession(id);
          }}
      onScreenshot={VISION_ENABLED && supportsDisplayAudio() ? () => void takeScreenshot() : undefined}
      screenshotUnavailableReason={!VISION_ENABLED ? "Screenshot analysis isn’t enabled yet." : "This browser can’t capture the screen."}
      hotkeys={hotkeys}
      title={session.title}
      notice={notice}
      overlay={
        shot ? (
          <ScreenshotPreview
            image={shot}
            onAnalyze={analyzeShot}
            onRetake={() => {
              setShot(null);
              void takeScreenshot();
            }}
            onCancel={() => setShot(null)}
          />
        ) : undefined
      }
    />
  );

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-black">
      <div className="flex items-center gap-3 px-4 py-2 text-xs text-zinc-500">
        <Link to="/" className={cx("inline-flex items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Orbit
        </Link>
        <span className="ml-auto">
          Mic {micOn ? "on" : "off"} · Interviewer audio {sysState === "on" ? "on" : "off"}
        </span>
      </div>
      <div className={cx("min-h-0 flex-1 px-4 pb-4", mode === "compact" && "flex items-start justify-center")}>
        <div
          className={cx(
            "h-full overflow-hidden rounded-2xl border border-zinc-200 shadow-xl shadow-black/5 dark:border-zinc-800",
            mode === "compact" ? "w-[380px] max-h-[560px]" : "mx-auto max-w-6xl",
          )}
        >
          {panel}
        </div>
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
  action,
}: {
  tone: "info" | "error";
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 px-4 py-2 text-xs",
        tone === "error"
          ? "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
          : "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100",
      )}
    >
      <span className="flex-1">{children}</span>
      {action && (
        <button type="button" onClick={action.onClick} className={cx("shrink-0 rounded-md bg-white/70 px-2 py-1 font-medium dark:bg-white/10", focusRing)}>
          {action.label}
        </button>
      )}
    </div>
  );
}
