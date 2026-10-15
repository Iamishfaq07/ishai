import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AUDIO_CHANNEL, type OrbitSession } from "@orbit/types";
import {
  ArrowLeft,
  ApiError,
  CompanionShare,
  CreditCard,
  useAnswerRatings,
  Headphones,
  LivePanel,
  DefenseWorkspace,
  Mic,
  SourceChip,
  useSourceTracker,
  OrbitLogo,
  ScreenshotPreview,
  cx,
  focusRing,
  loadHotkeys,
  loadResponseTiming,
  loadCodingLanguage,
  loadThinking,
  loadExperience,
  useLiveSession,
  VISION_ENABLED,
  type PanelMode,
  confirmDialog,
} from "@orbit/ui";
import { Button, ErrorNote, Spinner } from "../components/ui";
import { LIVE_URL, api } from "../lib/api";
import {
  captureScreenFrame,
  captureStream,
  openDisplayAudio,
  openMicrophone,
  sharedSurface,
  supportsDisplayAudio,
  supportsScreenCapture,
  type AudioCapture,
  type SharedSurface,
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
        <Spinner label="Preparing session" state="connecting" big />
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
  const ratings = useAnswerRatings(api, session.id);
  const { live, actions, client } = useLiveSession({
    apiBaseUrl: LIVE_URL,
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
  // Whether each source is actually heard (SourceChip), measured from the frames' levels on this device.
  const sources = useSourceTracker();
  const [sourceAdvice, setSourceAdvice] = useState<{ mic: string | null; system: string | null }>({ mic: null, system: null });
  const [micStarting, setMicStarting] = useState(false);
  // Mocks and phone / room sessions listen through the microphone only. Resuming from Home or Sessions carries no
  // launch state (the default asks for tab audio), so the session type decides here.
  const systemAudio = launch.systemAudio && session.type !== "mock" && session.type !== "phone";
  const [sysState, setSysState] = useState<"off" | "needs_share" | "on" | "error">(systemAudio ? "needs_share" : "off");
  const [sysError, setSysError] = useState<string | null>(null);
  const [sysStarting, setSysStarting] = useState(false);
  // What was shared: the whole screen's audio makes Zoom mute the user's microphone, so that gets a warning.
  const [sysSurface, setSysSurface] = useState<SharedSurface | null>(null);

  // Bumped on every start/stop so a slow getUserMedia from an earlier attempt (double-tapped Retry, a remount)
  // can't install a second capture that keeps streaming duplicate audio.
  const micGenRef = useRef(0);
  const stopMic = useCallback(() => {
    micGenRef.current++;
    micRef.current?.stop();
    micRef.current = null;
  }, []);
  const startMic = useCallback(async () => {
    const gen = ++micGenRef.current;
    setMicError(null);
    setMicStarting(true);
    micRef.current?.stop();
    micRef.current = null;
    try {
      const stream = await openMicrophone(launch.micDeviceId);
      const capture = await captureStream(stream, (f) => {
        sources.feed("mic", f.rms);
        if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudio(AUDIO_CHANNEL.mic, f.pcm);
      });
      if (gen !== micGenRef.current) {
        capture.stop();
        return;
      }
      micRef.current = capture;
      setMicStarting(false);
      setMicOn(true);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (gen !== micGenRef.current) return;
        capture.stop();
        micRef.current = null;
        setMicOn(false);
        setMicError("Microphone disconnected.");
      });
    } catch (err) {
      if (gen !== micGenRef.current) return;
      setMicStarting(false);
      setMicOn(false);
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setMicError(
        denied
          ? "Microphone permission denied. Allow it from the address bar, then retry."
          : `Microphone unavailable: ${errorText(err)}`,
      );
    }
  }, [client, launch.micDeviceId, sources]);

  useEffect(() => {
    void startMic();
    return () => {
      stopMic();
      setMicOn(false);
    };
  }, [startMic, stopMic]);
  useEffect(() => {
    const recover = () => {
      if (!micRef.current && !pausedRef.current) void startMic();
    };
    navigator.mediaDevices?.addEventListener("devicechange", recover);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", recover);
  }, [startMic]);

  // The same guard for tab audio: a share picker answered after a second click, after End, or after leaving the
  // page must not start a capture that nothing stops.
  const sysGenRef = useRef(0);
  const stopSystemAudio = useCallback(() => {
    sysGenRef.current++;
    sysRef.current?.stop();
    sysRef.current = null;
  }, []);
  const startSystemAudio = async () => {
    const gen = ++sysGenRef.current;
    setSysError(null);
    sysRef.current?.stop();
    sysRef.current = null;
    setSysStarting(true);
    try {
      const stream = await openDisplayAudio();
      if (gen !== sysGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const capture = await captureStream(stream, (f) => {
        sources.feed("system", f.rms);
        if (!pausedRef.current && !interviewerSpeakingRef.current) client.sendAudio(AUDIO_CHANNEL.system, f.pcm);
      });
      if (gen !== sysGenRef.current) {
        capture.stop();
        return;
      }
      sysRef.current = capture;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (gen !== sysGenRef.current) return;
        sysRef.current?.stop();
        sysRef.current = null;
        setSysSurface(null);
        setSysState("needs_share");
      });
      setSysSurface(sharedSurface(stream));
      setSysState("on");
    } catch (err) {
      if (gen !== sysGenRef.current) return;
      setSysError(errorText(err));
      setSysState("error");
    } finally {
      if (gen === sysGenRef.current) setSysStarting(false);
    }
  };

  useEffect(() => stopSystemAudio, [stopSystemAudio]);

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
        throw new Error("Screenshot analysis isn’t enabled on this server yet. Paste the problem into Chat instead.", {
          cause: err,
        });
      }
      throw err;
    }
  };

  // ── End session ────────────────────────────────────────────────────────
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const ended = live.state === "ended";
  const endSession = async () => {
    if (!(await confirmDialog({ title: "End this session?", body: "The transcript and report are saved to History.", confirmLabel: "End session", danger: true }))) return;
    setEndError(null);
    setEnding(true);
    actions.end();
  };
  useEffect(() => {
    if (!ending && !ended) return;
    stopMic();
    stopSystemAudio();
    if (ended) {
      // Ended with End here: on to the transcript and review. Ended any other way (minutes ran out, the time limit,
      // the mock round finished, ended elsewhere), the page stays and says why, with what to do next (below).
      if (!ending) return;
      const t = setTimeout(() => navigate(`/sessions/${session.id}`), 600);
      return () => clearTimeout(t);
    }
    // Fallback if the socket is down: end through REST. If that fails too, stay here — leaving would look like it
    // ended while the session kept using minutes.
    const t = setTimeout(() => {
      void api
        .endSession(session.id)
        .then(() => navigate(`/sessions/${session.id}`))
        .catch(() => {
          setEnding(false);
          setEndError("The session is still running, so it can keep using minutes. Check your connection and end it again.");
        });
    }, 3000);
    return () => clearTimeout(t);
  }, [ending, ended, navigate, session.id, stopMic, stopSystemAudio]);
  // Why it ended, when End here didn't end it. A mock round that finished keeps its own end screen instead (the round
  // summary, and the way to the review).
  const limit = live.usage?.limitReached ? live.usage.reason : null;
  const endedWhy: EndedReason | null = !ended || ending
    ? null
    : limit === "monthly"
      ? "minutes"
      : limit === "session"
        ? "time_limit"
        : session.type === "mock"
          ? null
          : "elsewhere";

  const notice = (
    <>
      {endError && <Notice tone="error">{endError}</Notice>}
      {micError && (
        <Notice tone="error" action={{ label: "Retry", onClick: () => void startMic() }}>
          {micError}
        </Notice>
      )}
      {(sysState === "needs_share" || sysState === "error") && live.state !== "ended" && (
        <Notice
          tone={sysState === "error" ? "error" : "info"}
          action={{ label: sysStarting ? "Sharing…" : "Share tab audio", onClick: () => void startSystemAudio(), disabled: sysStarting }}
        >
          {sysState === "error"
            ? sysError
            : "To hear the interviewer, share the meeting tab and turn on “Share tab audio”. Only audio is used."}
        </Notice>
      )}
      {sysState === "on" && sysSurface === "monitor" && live.state !== "ended" && (
        <Notice tone="info">
          You’re sharing your whole screen’s audio, and Zoom mutes your microphone while that’s on: if it muted you,
          click Unmute in Zoom. To avoid it, use the Orbit desktop app for the Zoom or Teams app (it listens to the
          meeting app directly, no screen share), or, if your meeting is in a browser tab, share that tab instead.
        </Notice>
      )}
      {shotError && <Notice tone="error">{shotError}</Notice>}
      {live.state !== "ended" && sourceAdvice.mic && <Notice tone="info">{sourceAdvice.mic}</Notice>}
      {live.state !== "ended" && sysState === "on" && sourceAdvice.system && <Notice tone="info">{sourceAdvice.system}</Notice>}
    </>
  );

  const panel = (
    <LivePanel
      analyser={micRef.current?.analyser}
      captureHealth={micStarting || sysStarting ? "recovering" : micOn || sysState === "on" ? "active" : "muted"}
      screenCaptureHealth={shot ? "active" : "muted"}
      mockInterview={session.type === "mock"}
      ratings={ratings}
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
      // A new tab: leaving this one would drop the live session (and its audio capture).
      onBuyMinutes={() => window.open("/billing", "_blank", "noopener")}
      onViewReport={() => navigate(`/sessions/${session.id}`)}
      onScreenshot={VISION_ENABLED && supportsScreenCapture() ? () => void takeScreenshot() : undefined}
      screenshotUnavailableReason={!VISION_ENABLED ? "Screenshot analysis isn’t enabled yet." : "This browser can’t capture the screen."}
      hotkeys={hotkeys}
      title={session.title}
      headerEnd={<CompanionShare api={api} sessionId={session.id} webUrl={window.location.origin} disabled={live.state === "ended"} />}
      loadWalkthrough={(answerId) => api.spokenWalkthrough(session.id, answerId)}
      notice={<>{notice}{session.type !== "mock" && <DefenseWorkspace api={api} sessionId={session.id} {...(supportsScreenCapture() ? { capture: captureScreenFrame } : {})} />}</>}
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
    <div className="flex h-full flex-col">
      <nav aria-label="Session" className="flex items-center gap-3 px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Link
          to="/"
          className={cx("inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <OrbitLogo size={16} animated={false} />
          <span className="hidden font-display font-medium min-[360px]:inline">orbit</span>
        </Link>
        <span className="ml-auto flex items-center gap-2">
          <SourceChip tracker={sources} channel="mic" icon={Mic} label="Mic" on={micOn} paused={live.state === "paused"}
                      onAdvice={(mic) => setSourceAdvice((a) => (a.mic === mic ? a : { ...a, mic }))} />
          <SourceChip tracker={sources} channel="system" icon={Headphones} label="Interviewer" on={sysState === "on"} paused={live.state === "paused"}
                      onAdvice={(system) => setSourceAdvice((a) => (a.system === system ? a : { ...a, system }))} />
        </span>
      </nav>
      <div className={cx("min-h-0 flex-1 px-2 pb-2 sm:px-4 sm:pb-4", mode === "compact" && "flex items-start justify-center")}>
        <div
          className={cx(
            "h-full overflow-hidden rounded-2xl border border-zinc-200 shadow-xl shadow-black/5 dark:border-white/[0.08] dark:shadow-[0_0_0_1px_rgb(var(--accent-500)/0.08),0_30px_80px_-30px_rgb(var(--accent-600)/0.45)]",
            mode === "compact" ? "w-[380px] max-h-[560px]" : "mx-auto max-w-6xl",
          )}
        >
          {endedWhy ? <EndedScreen reason={endedWhy} session={session} /> : panel}
        </div>
      </div>
    </div>
  );
}

type EndedReason = "minutes" | "time_limit" | "elsewhere";

const ENDED_COPY: Record<EndedReason, { title: string; body: string }> = {
  minutes: {
    title: "You’re out of interview minutes",
    body:
      "So the session has ended. Its transcript and review are saved under Sessions. Buy a pack to keep going: " +
      "minutes land in your account as soon as the payment is approved.",
  },
  time_limit: {
    title: "This session reached its time limit",
    body: "So it has ended. Its transcript and review are saved under Sessions. Start a new session to keep going.",
  },
  elsewhere: {
    title: "This session has ended",
    body:
      "It was ended from another window or device, so there’s nothing to reconnect to. Its transcript and review are " +
      "saved under Sessions.",
  },
};

/** Why the session ended when this page didn't end it, and what to do next (it used to jump to the review unexplained). */
function EndedScreen({ reason, session }: { reason: EndedReason; session: OrbitSession }) {
  const navigate = useNavigate();
  const copy = ENDED_COPY[reason];
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 bg-white px-6 py-10 text-center dark:bg-zinc-950"
    >
      <OrbitLogo size={36} />
      <h1 className="font-display text-lg font-semibold tracking-tight">{copy.title}</h1>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-300">{copy.body}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {reason === "minutes" && (
          // This tab is free now (the session is over): no need for a new one.
          <Button onClick={() => navigate("/billing")}>
            <CreditCard className="h-4 w-4" />
            Buy minutes
          </Button>
        )}
        <Button variant={reason === "minutes" ? "secondary" : "primary"} onClick={() => navigate(`/sessions/${session.id}`)}>
          View transcript & review
        </Button>
        {reason === "time_limit" && (
          <Button variant="secondary" onClick={() => navigate(session.type === "mock" ? "/mock" : "/start")}>
            Start a new session
          </Button>
        )}
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
  action?: { label: string; onClick: () => void; disabled?: boolean };
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
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={cx("shrink-0 rounded-md bg-white/70 px-2 py-1 font-medium disabled:opacity-50 dark:bg-white/10", focusRing)}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
