import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  AnswerLength,
  AnswerStyle,
  CodingLanguage,
  LiveSettings,
  ResponseTiming,
  Speaker,
  ThinkingLevel,
} from "@orbit/types";
import { LiveClient, type LiveClientOptions } from "./client";
import { saveCodingLanguage, saveResponseTiming, saveThinking } from "./preferences";
import { initialLiveState, liveReducer, type LiveViewState } from "./reducer";

export interface LiveActions {
  /** Manual answer. With no text, the server answers the question it's listening to (which may span a
   * pause), else the latest interviewer utterance. */
  answer: (questionText?: string) => void;
  clear: () => void;
  /** Stop writing the current answer, keeping what's on screen. */
  stop: () => void;
  pin: (answerId: string, pinned: boolean) => void;
  chat: (text: string) => void;
  setLength: (length: AnswerLength) => void;
  setStyle: (style: AnswerStyle) => void;
  setAutoAnswer: (on: boolean) => void;
  setResponseTiming: (timing: ResponseTiming) => void;
  setThinking: (level: ThinkingLevel) => void;
  /** Preferred code language; with `regenerateFor`, re-answers that question in it right away. */
  setCodingLanguage: (lang: CodingLanguage, regenerateFor?: string) => void;
  /** Mock interview: done answering — the interviewer asks the next question now. */
  mockNext: () => void;
  /** Browse an earlier answer; null returns to the live one. */
  viewAnswer: (answerId: string | null) => void;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  end: () => void;
  simulate: (fixture: string, speed?: number) => void;
  correctSpeaker: (turnId: string, speaker: Speaker) => void;
  dismissError: () => void;
}

export interface UseLiveSessionOptions extends Omit<LiveClientOptions, "onOpen"> {
  initialSettings?: Partial<LiveSettings>;
  /** Set false to build the client without connecting yet (e.g. awaiting permissions). */
  autoConnect?: boolean;
}

export interface UseLiveSessionResult {
  live: LiveViewState;
  actions: LiveActions;
  client: LiveClient;
}

let chatCounter = 0;

export function useLiveSession(options: UseLiveSessionOptions): UseLiveSessionResult {
  const { apiBaseUrl, sessionId, initialSettings, autoConnect = true } = options;
  const [live, dispatch] = useReducer(liveReducer, initialSettings, initialLiveState);

  // Latest state/options through refs, so reconnects resend current state without rebuilding the client.
  const liveRef = useRef(live);
  liveRef.current = live;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const client = useMemo(
    () =>
      new LiveClient({
        createSocket: optionsRef.current.createSocket,
        backoffMs: optionsRef.current.backoffMs,
        maxBackoffMs: optionsRef.current.maxBackoffMs,
        maxAttempts: optionsRef.current.maxAttempts,
        apiBaseUrl,
        sessionId,
        getTicket: () => optionsRef.current.getTicket(),
        onOpen: (c) => resumeSession(c, liveRef.current),
      }),
    [apiBaseUrl, sessionId],
  );

  useEffect(() => {
    const offEvents = client.on(dispatch);
    const offStatus = client.onStatus((status, detail, info) =>
      dispatch({ type: "local/connection", status, ...(detail ? { detail } : {}), ...(info ? { info } : {}) }),
    );
    if (autoConnect) client.connect();
    return () => {
      offEvents();
      offStatus();
      client.close();
    };
  }, [client, autoConnect]);

  const updateSettings = useCallback(
    (patch: Partial<LiveSettings>) => {
      dispatch({ type: "local/settings", settings: patch });
      client.send("settings.update", patch);
    },
    [client],
  );

  const setPaused = useCallback(
    (paused: boolean) => {
      dispatch({ type: "local/pause", paused });
      client.send(paused ? "session.pause" : "session.resume", {});
    },
    [client],
  );

  const actions = useMemo<LiveActions>(
    () => ({
      answer: (questionText) => {
        // Only send explicit text: the server knows the full (possibly paused-and-continued) question,
        // while the latest transcript turn may be just its second half.
        const text = questionText?.trim();
        client.send("answer.request", text ? { question_text: text } : {});
      },
      clear: () => {
        dispatch({ type: "local/clear" });
        client.send("answer.clear", {});
      },
      stop: () => client.send("answer.stop", {}),
      pin: (answerId, pinned) => {
        dispatch({ type: "local/pin", answer_id: answerId, pinned });
        client.send("answer.pin", { answer_id: answerId, pinned });
      },
      chat: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        chatCounter += 1;
        dispatch({ type: "local/chat_sent", id: `u-${Date.now()}-${chatCounter}`, text: trimmed, ts: Date.now() });
        client.send("chat.message", { text: trimmed });
      },
      setLength: (length) => updateSettings({ length }),
      setStyle: (style) => updateSettings({ style }),
      setAutoAnswer: (auto_answer) => updateSettings({ auto_answer }),
      setResponseTiming: (response_timing) => {
        saveResponseTiming(response_timing);
        updateSettings({ response_timing });
      },
      mockNext: () => client.send("mock.next", {}),
      viewAnswer: (answer_id) => dispatch({ type: "local/view", answer_id }),
      setThinking: (thinking) => {
        saveThinking(thinking);
        updateSettings({ thinking });
      },
      setCodingLanguage: (coding_language, regenerateFor) => {
        saveCodingLanguage(coding_language);
        updateSettings({ coding_language });
        if (regenerateFor) client.send("answer.request", { question_text: regenerateFor });
      },
      pause: () => setPaused(true),
      resume: () => setPaused(false),
      togglePause: () => setPaused(!liveRef.current.userPaused),
      end: () => client.send("session.end", {}),
      simulate: (fixture, speed) => client.send("dev.simulate", speed ? { fixture, speed } : { fixture }),
      correctSpeaker: (turnId, speaker) => {
        dispatch({ type: "local/speaker", turn_id: turnId, speaker });
        client.send("speaker.correct", { turn_id: turnId, speaker });
      },
      dismissError: () => dispatch({ type: "local/dismiss_error" }),
    }),
    [client, updateSettings, setPaused],
  );

  return { live, actions, client };
}

/**
 * What a (re)connect sends first: the settings the user asked for (the new connection's engine starts from the
 * session's saved ones) and, if they paused, the pause (it starts listening). Sent before the queued messages are
 * flushed, so a change made while disconnected that isn't rendered yet still arrives after these.
 */
export function resumeSession(client: Pick<LiveClient, "send">, live: LiveViewState): void {
  client.send("session.start", { settings: live.requestedSettings });
  if (live.userPaused && live.state !== "ended") client.send("session.pause", {});
}
