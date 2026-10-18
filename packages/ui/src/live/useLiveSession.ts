import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  MockVoiceEvent,
  AnswerLength,
  AnswerSize,
  AnswerStyle,
  ClientEventMap,
  CodingLanguage,
  ExperienceLevel,
  LiveSettings,
  ResponseTiming,
  Speaker,
  ThinkingLevel,
} from "@orbit/types";
import { LiveClient, type LiveClientOptions } from "./client";
import { saveCodingLanguage, saveExperience, saveResponseTiming, saveThinking } from "./preferences";
import { initialLiveState, liveReducer, type LiveViewState } from "./reducer";

export interface LiveActions {
  /** Manual answer. With no text, the server answers the question it's listening to (which may span a
   * pause), else the latest interviewer utterance. `once`: this answer only, a size or plainer words (the card's
   * Shorter / Longer / Simpler), without changing the session's settings. */
  answer: (questionText?: string, once?: AnswerOnce) => void;
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
  setExperience: (level: ExperienceLevel) => void;
  /** Preferred code language; with `regenerateFor`, re-answers that question in it right away. */
  setCodingLanguage: (lang: CodingLanguage, regenerateFor?: string) => void;
  /** Mock interview: done answering — the interviewer asks the next question now. */
  mockNext: () => void;
  /** Mock interview: send a typed answer (the interviewer moves on after it). */
  mockAnswer: (text: string) => void;
  /** The AI video interview: what this device's voice did with one of her lines (D76). */
  mockVoice: (event: MockVoiceEvent, lineId: string | null, detail?: string) => void;
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

export interface AnswerOnce {
  size?: AnswerSize;
  simpler?: boolean;
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
/** The server refuses a typed mock answer longer than this (events.MockAnswer). */
export const MOCK_ANSWER_CHARS = 4000;

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
      answer: (questionText, once) => client.send("answer.request", answerRequest(questionText, once)),
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
      mockVoice: (event, lineId, detail) =>
        client.send("mock.voice", { event, line_id: lineId, ...(detail ? { detail: detail.slice(0, 120) } : {}) }),
      mockAnswer: (text) => {
        const trimmed = text.trim().slice(0, MOCK_ANSWER_CHARS);
        if (trimmed) client.send("mock.answer", { text: trimmed });
      },
      viewAnswer: (answer_id) => dispatch({ type: "local/view", answer_id }),
      setThinking: (thinking) => {
        saveThinking(thinking);
        updateSettings({ thinking });
      },
      setExperience: (experience) => {
        saveExperience(experience);
        updateSettings({ experience });
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
 * An `answer.request`'s data. Only explicit text is sent: the server knows the full (possibly paused-and-continued)
 * question, while the latest transcript turn may be just its second half. The one-off size / plainer words are left
 * out unless asked for, so a plain "Answer" is exactly what older servers expect.
 */
export function answerRequest(questionText?: string, once?: AnswerOnce): ClientEventMap["answer.request"] {
  const text = questionText?.trim();
  return {
    ...(text ? { question_text: text } : {}),
    ...(once?.size ? { size: once.size } : {}),
    ...(once?.simpler ? { simpler: true } : {}),
  };
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
