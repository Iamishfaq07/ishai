import { useEffect, useRef, useState } from "react";

interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type BrowserSpeech = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

/** Optional browser dictation. Nothing is submitted until the candidate reviews the text and presses Save. */
export function useBusinessDictation(text: string, onText: (value: string) => void, revision?: number) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const speech = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  callback.current = onText;
  const browsers = typeof window === "undefined" ? null : window as unknown as BrowserSpeech;
  const Engine = browsers?.SpeechRecognition ?? browsers?.webkitSpeechRecognition;
  useEffect(() => {
    setListening(false);
    return () => {
      const current = speech.current;
      if (current) {
        current.onresult = current.onerror = current.onend = null;
        current.abort(); speech.current = null;
      }
    };
  }, [revision]);
  const start = () => {
    if (!Engine) return;
    setError("");
    const current = new Engine();
    let active = true;
    const prefix = text.trim();
    current.lang = "en-US"; current.continuous = true; current.interimResults = true;
    current.onresult = (event) => {
      if (!active || speech.current !== current) return;
      const spoken = Array.from(event.results).map((r) => r[0].transcript).join(" ").trim();
      callback.current(`${prefix}${prefix && spoken ? " " : ""}${spoken}`.slice(0, 6000));
    };
    current.onerror = () => {
      if (speech.current !== current) return;
      active = false;
      setError("Dictation stopped. Your text is still here; type your answer or try again."); setListening(false);
    };
    current.onend = () => {
      active = false;
      if (speech.current === current) { setListening(false); speech.current = null; }
    };
    speech.current = current;
    try { current.start(); setListening(true); }
    catch { setListening(false); speech.current = null; setError("Dictation is unavailable. You can type your answer."); }
  };
  return { supported: !!Engine, listening, error, start, stop: () => speech.current?.stop() };
}
