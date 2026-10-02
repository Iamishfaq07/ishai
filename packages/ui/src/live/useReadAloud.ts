import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { READ_ALOUD_RATES, speechChunks } from "./readAloud";
import { pickVoice } from "./useInterviewerVoice";

/**
 * "Read aloud" for an answer, on the platform's built-in speech engine (Windows voices in WebView2 / the browser):
 * local, free, and only ever started by the user. It plays through the speakers, so the page stops sending
 * audio while it's `playing` (see LivePanel `onInterviewerSpeaking`) — Orbit never transcribes its own voice.
 */
export type ReadAloudStatus = "idle" | "playing" | "paused";

export interface ReadAloud {
  supported: boolean;
  status: ReadAloudStatus;
  /** What is being read (to show the controls on the right answer). */
  key: string | null;
  rate: number;
  setRate: (rate: number) => void;
  voices: Array<{ id: string; name: string }>;
  voiceId: string | null;
  setVoiceId: (id: string) => void;
  play: (key: string, text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const RATE_KEY = "orbit.readAloud.rate";
const VOICE_KEY = "orbit.readAloud.voice";

function stored(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — still applies now
  }
}

export function useReadAloud(lang = "en"): ReadAloud {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [key, setKey] = useState<string | null>(null);
  const [rate, setRateState] = useState(() => {
    const r = Number(stored(RATE_KEY));
    return (READ_ALOUD_RATES as readonly number[]).includes(r) ? r : 1;
  });
  const [all, setAll] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceId, setVoiceIdState] = useState<string | null>(() => stored(VOICE_KEY));
  // Read at speak time so speed / voice changes apply from the next sentence.
  const settings = useRef({ rate, voice: undefined as SpeechSynthesisVoice | undefined });
  const run = useRef(0); // bumped on every play/stop: events from a cancelled run are ignored

  useEffect(() => {
    if (!synth) return;
    const load = () => setAll(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [synth]);

  // On-device voices only, so the answer text never leaves the machine ("Online (Natural)" voices are a Microsoft
  // cloud service). Online voices are offered, labelled, only when no local voice exists for the language.
  const base = lang.split("-")[0]!.toLowerCase();
  const voices = useMemo(() => {
    const matching = all.filter((v) => v.lang.toLowerCase().startsWith(base));
    const local = matching.filter((v) => v.localService);
    return local.length > 0 ? local : matching;
  }, [all, base]);
  const voice = voices.find((v) => v.voiceURI === voiceId) ?? (voices.length > 0 ? pickVoice(voices, lang) : undefined);
  settings.current = { rate, voice };
  const voiceOptions = useMemo(
    () => voices.map((v) => ({ id: v.voiceURI, name: v.localService ? v.name : `${v.name} (online)` })),
    [voices],
  );

  const stop = useCallback(() => {
    run.current += 1;
    synth?.cancel();
    setStatus("idle");
    setKey(null);
  }, [synth]);

  const play = useCallback(
    (k: string, text: string) => {
      if (!synth) return;
      const chunks = speechChunks(text);
      synth.cancel();
      const id = ++run.current;
      if (chunks.length === 0) {
        setStatus("idle");
        return;
      }
      const speak = (i: number) => {
        if (run.current !== id) return;
        if (i >= chunks.length) {
          setStatus("idle");
          setKey(null);
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        const { rate: r, voice: v } = settings.current;
        if (v) u.voice = v;
        u.lang = v?.lang ?? lang;
        u.rate = r;
        u.onend = () => speak(i + 1);
        u.onerror = (e) => {
          // "interrupted"/"canceled" come from our own stop(); anything else ends the reading.
          if (run.current === id && e.error !== "interrupted" && e.error !== "canceled") {
            setStatus("idle");
            setKey(null);
          }
        };
        synth.speak(u);
      };
      setKey(k);
      setStatus("playing"); // mute capture from the moment speech is requested, not when audio starts
      speak(0);
    },
    [synth, lang],
  );

  const pause = useCallback(() => {
    if (!synth || status !== "playing") return;
    synth.pause();
    setStatus("paused");
  }, [synth, status]);

  const resume = useCallback(() => {
    if (!synth || status !== "paused") return;
    setStatus("playing");
    synth.resume();
  }, [synth, status]);

  useEffect(() => () => synth?.cancel(), [synth]);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    store(RATE_KEY, String(r));
  }, []);
  const setVoiceId = useCallback((id: string) => {
    setVoiceIdState(id);
    store(VOICE_KEY, id);
  }, []);

  // One object while nothing changes, so the (memoized) answer card doesn't re-render on every live update.
  const voiceUri = voice?.voiceURI ?? null;
  return useMemo(
    () => ({
      supported: Boolean(synth),
      status,
      key,
      rate,
      setRate,
      voices: voiceOptions,
      voiceId: voiceUri,
      setVoiceId,
      play,
      pause,
      resume,
      stop,
    }),
    [synth, status, key, rate, setRate, voiceOptions, voiceUri, setVoiceId, play, pause, resume, stop],
  );
}
