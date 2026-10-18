import { useRef, useState } from "react";
import { DEVICE_VOICE, Spot, LoadGate, VOICE_CHOICE_KEY, playResponse, safeLocal, toast } from "@orbit/ui";
import { Button, Card, Field, Select } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const SAMPLE = "Thanks for joining. To start, tell me about a project you're proud of, and what you did yourself.";

/** Settings → Interviewer voice: the mock interviewer's natural AI voice (when the server has it) or the device's. */
export function InterviewerVoiceCard() {
  const status = useAsync(() => api.voiceStatus(), [], "voice-status");
  const [choice, setChoice] = useState<string>(() => safeLocal.getItem(VOICE_CHOICE_KEY) ?? "");
  const [playing, setPlaying] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const s = status.data;
  // One natural voice: anything but "device" means it (older saved choices like "uk" included).
  const natural = s?.voices[0];
  const selected = !natural || choice === DEVICE_VOICE ? DEVICE_VOICE : natural.id;

  const pick = (value: string) => {
    setChoice(value);
    safeLocal.setItem(VOICE_CHOICE_KEY, value);
  };

  const preview = async () => {
    if (playing) {
      stopper.current?.abort();
      window.speechSynthesis?.cancel();
      setPlaying(false);
      return;
    }
    const controller = new AbortController();
    stopper.current = controller;
    setPlaying(true);
    try {
      if (selected === DEVICE_VOICE) {
        const u = new SpeechSynthesisUtterance(SAMPLE);
        u.onend = () => setPlaying(false);
        u.onerror = () => setPlaying(false);
        window.speechSynthesis.speak(u);
        return;
      }
      await playResponse(await api.speak(SAMPLE, selected, controller.signal), controller.signal);
      status.reload();
    } catch (err) {
      if (!controller.signal.aborted) toast({ message: errorText(err), tone: "error" });
    }
    if (selected !== DEVICE_VOICE) setPlaying(false);
  };

  return (
    <Card id="interviewer-voice" className="scroll-mt-24">
      <h2 className="mb-1 flex items-center gap-3 font-semibold">
        <Spot kind="voice" />
        Interviewer voice
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        How the mock interviewer reads its questions. The question is always on screen too, and you can mute the voice during a mock.
      </p>
      <LoadGate loading={status.loading && !s} variant="line" count={1} label="Checking voices">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Voice" htmlFor="interviewer-voice-select">
            <Select id="interviewer-voice-select" value={selected} onChange={(e) => pick(e.target.value)}>
              {natural && <option value={natural.id}>Natural AI voice ({natural.label})</option>}
              <option value={DEVICE_VOICE}>This device's voice</option>
            </Select>
          </Field>
          <Button variant="secondary" onClick={() => void preview()}>
            {playing ? "Stop" : "Play a sample"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {s?.available
            ? `The natural voice is made by Deepgram from the question text only, never from what you say.${
                s.chars_left !== null ? ` ${s.chars_left.toLocaleString("en-IN")} characters left today (about ${Math.floor(s.chars_left / 120)} questions); after that, this device's voice takes over.` : ""
              }`
            : "The natural AI voice isn't available on this server, so this device's own voice reads the questions."}
        </p>
      </LoadGate>
    </Card>
  );
}
