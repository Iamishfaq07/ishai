import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AnswerLength, AnswerStyle, LiveSettings, ResponseTiming, Speaker, ThinkingLevel } from "@orbit/types";
import { LiveClient, type LiveClientOptions } from "./client";
import { saveResponseTiming, saveThinking } from "./preferences";
import { initialLiveState, liveReducer, type LiveViewState } from "./reducer";

export interface LiveActions {
  /** Manual answer. With no text, the server answers the question it's listening to (which may span a
   * pause), else the latest interviewer utterance. */
  answer: (questionText?: string) => void;
  clear: () => void;
  pin: (answerId: string, pinned: boolean) => void;
  chat: (text: string) => void;
  setLength: (length: AnswerLength) => void;
  setStyle: (style: AnswerStyle) => void;
  setAutoAnswer: (on: boolean) => void;
  setResponseTiming: (timing: ResponseTiming) => void;
  setThinking: (level: ThinkingLevel) => void;
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

  // Latest settings/options through refs, so reconnects resend current state without rebuilding the client.
  const settingsRef = useRef(live.settings);
  settingsRef.current = live.settings;
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
        onOpen: (c) => c.send("session.start", { settings: settingsRef.current }),
      }),
    [apiBaseUrl, sessionId],
  );

  useEffect(() => {
    const offEvents = client.on(dispatch);
    const offStatus = client.onStatus((status, detail) =>
      dispatch({ type: "local/connection", status, ...(detail ? { detail } : {}) }),
    );
    if (autoConnect) client.connect();
    return () => {
      offEvents();
      offStatus();
      client.close();
    };
  }, [client, autoConnect]);

  const liveRef = useRef(live);
  liveRef.current = live;

  const updateSettings = useCallback(
    (patch: Partial<LiveSettings>) => {
      dispatch({ type: "local/settings", settings: patch });
      client.send("settings.update", patch);
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
      viewAnswer: (answer_id) => dispatch({ type: "local/view", answer_id }),
      setThinking: (thinking) => {
        saveThinking(thinking);
        updateSettings({ thinking });
      },
      pause: () => client.send("session.pause", {}),
      resume: () => client.send("session.resume", {}),
      togglePause: () =>
        client.send(liveRef.current.state === "paused" ? "session.resume" : "session.pause", {}),
      end: () => client.send("session.end", {}),
      simulate: (fixture, speed) => client.send("dev.simulate", speed ? { fixture, speed } : { fixture }),
      correctSpeaker: (turnId, speaker) => {
        dispatch({ type: "local/speaker", turn_id: turnId, speaker });
        client.send("speaker.correct", { turn_id: turnId, speaker });
      },
      dismissError: () => dispatch({ type: "local/dismiss_error" }),
    }),
    [client, updateSettings],
  );

  return { live, actions, client };
}
