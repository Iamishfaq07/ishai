import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Button,
  SegmentedControl,
  SpeechEnvelope,
  VoiceTap,
  VoiceVisualizer,
  analyserActivity,
  type VoiceActivity,
  type VoiceMood,
  type VoiceMotion,
} from "@orbit/ui";

const MOODS: Array<[VoiceMood, string]> = [
  ["joining", "Joining: the bars rise in from flat"],
  ["speaking", "Speaking: her voice, in the accent"],
  ["listening", "Listening: a calm, low wave"],
  ["hearing", "Hearing you: your voice, in light ink"],
  ["thinking", "Thinking: a shimmer runs across"],
  ["paused", "Mic paused: flat and dimmed"],
];

const SAMPLE = "Tell me about a time you disagreed with a teammate on a technical decision, and how you settled it.";

/**
 * A fake voice for the gallery, in Web Audio: a buzz at a speaking pitch through two formant filters, its loudness
 * following a speech envelope (syllables, words, pauses). It feeds an analyser only, so nothing reaches the speakers.
 * Two of them: Saba's (higher) and "yours" (lower), each with its own rhythm.
 */
function useFakeAudio(on: boolean): { saba: AnalyserNode; you: AnalyserNode } | null {
  const [nodes, setNodes] = useState<{ saba: AnalyserNode; you: AnalyserNode } | null>(null);
  useEffect(() => {
    if (!on) return;
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const voices = ([
      [205, 1],
      [118, 2],
    ] as const).map(([pitch, seed]) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = pitch;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      for (const [hz, q] of [
        [650, 3],
        [1250, 5],
        [2600, 6],
      ] as const) {
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = hz;
        f.Q.value = q;
        osc.connect(f).connect(gain);
      }
      gain.connect(analyser); // and no further: silent
      osc.start();
      return { osc, gain, analyser, envelope: new SpeechEnvelope(seed), pitch };
    });
    const timer = window.setInterval(() => {
      const now = performance.now();
      for (const v of voices) {
        v.envelope.auto(now);
        const level = v.envelope.level(now);
        v.gain.gain.setTargetAtTime(level * 0.9, ctx.currentTime, 0.012);
        v.osc.frequency.setTargetAtTime(v.pitch * (0.92 + 0.16 * level), ctx.currentTime, 0.05);
      }
    }, 15);
    setNodes({ saba: voices[0]!.analyser, you: voices[1]!.analyser });
    return () => {
      window.clearInterval(timer);
      voices.forEach((v) => v.osc.stop());
      void ctx.close();
      setNodes(null);
    };
  }, [on]);
  return nodes;
}

/** The device voice's word timing, faked: SAMPLE's words at a speaking pace, a pause, and again. */
function useFakeWords(): VoiceTap {
  const tap = useMemo(() => new VoiceTap(), []);
  useEffect(() => {
    let timers: number[] = [];
    const speak = () => {
      const u = {};
      tap.deviceStart(u, SAMPLE, 0);
      let t = 120;
      for (const m of SAMPLE.matchAll(/\S+/g)) {
        const at = m.index;
        const len = m[0].length;
        timers.push(window.setTimeout(() => tap.boundary(u, at, len), t));
        t += 120 + 42 * len + (/[.?!]$/.test(m[0]) ? 380 : /,$/.test(m[0]) ? 200 : 0);
      }
      timers.push(window.setTimeout(() => tap.deviceEnd(u), t + 150));
      timers.push(window.setTimeout(speak, t + 1600));
    };
    speak();
    return () => {
      timers.forEach((x) => window.clearTimeout(x));
      timers = [];
      tap.stop();
    };
  }, [tap]);
  return tap;
}

function SpokenWord({ voice }: { voice: VoiceActivity }) {
  const word = useSyncExternalStore(
    (l) => voice.subscribe(l),
    () => voice.word(),
    () => null,
  );
  return (
    <p className="text-xs text-zinc-300">
      Word timing: <span className="font-medium text-white">{word ? SAMPLE.slice(word.start, word.end) : "(between sentences)"}</span>
    </p>
  );
}

/**
 * Saba's voice visualizer (the AI video interview, VoiceVisualizer) in each of its moods, on the room's dark panel,
 * with fake sources: the device voice's word timing, or a fake audio voice through a real analyser.
 */
export function VoiceVisualizers() {
  const [source, setSource] = useState<"words" | "audio">("words");
  const [motion, setMotion] = useState<"app" | VoiceMotion>("app");
  const [audioOn, setAudioOn] = useState(false);
  const audio = useFakeAudio(audioOn);
  const words = useFakeWords();
  const sabaAudio = useMemo(() => (audio ? analyserActivity(audio.saba) : null), [audio]);
  const saba: VoiceActivity = source === "audio" && sabaAudio ? sabaAudio : words;
  const preview = motion === "app" ? {} : { motion };
  return (
    <section aria-labelledby="g-voice" className="space-y-4">
      <h2 id="g-voice" className="font-display text-lg font-semibold">
        Voice visualizer (video interview)
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Saba's voice from"
          size="sm"
          value={source}
          onChange={(v) => {
            setSource(v);
            if (v === "audio") setAudioOn(true);
          }}
          options={[
            { value: "words", label: "Word timing (device voice)" },
            { value: "audio", label: "Audio (natural voice)" },
          ]}
        />
        <SegmentedControl
          label="Motion"
          size="sm"
          value={motion}
          onChange={setMotion}
          options={[
            { value: "app", label: "App setting" },
            { value: "full", label: "Full" },
            { value: "reduced", label: "Gentle" },
            { value: "static", label: "Still" },
          ]}
        />
        {!audioOn && (
          <Button size="sm" variant="secondary" onClick={() => setAudioOn(true)}>
            Start the fake audio
          </Button>
        )}
      </div>
      <div className="video-room dark rounded-3xl bg-zinc-950 p-3 text-zinc-100 sm:p-4" data-voice-gallery="">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MOODS.map(([mood, label]) => (
            <li key={mood} data-mood-tile={mood} className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-900 p-4 ring-1 ring-white/10">
              <VoiceVisualizer mood={mood} voice={saba} {...(audio ? { mic: audio.you } : {})} {...preview} />
              <div className="flex w-full items-center justify-between gap-3">
                <p className="text-xs text-zinc-300">{label}</p>
                <VoiceVisualizer mood={mood} voice={saba} {...(audio ? { mic: audio.you } : {})} size="sm" {...preview} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <SpokenWord voice={words} />
          <p className="text-xs text-zinc-400">
            {audio ? "Fake audio runs into analysers only: nothing plays." : "Hearing you needs the fake audio (your voice is a second fake)."}
          </p>
        </div>
      </div>
    </section>
  );
}
